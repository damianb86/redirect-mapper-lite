import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { addLogContext, logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";
import {
  AiWizardConfigurationError,
  createAiWizardPlan,
  type AiWizardRequest,
} from "../services/ai-wizard.server";

const MAX_GOAL_LENGTH = 2000;
const DEBUG_REDACT_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|accessToken|refreshToken|apiKey|apiSecret|hmac|signature)/i;
const DEBUG_MAX_STRING_LENGTH = 12000;

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncateDebugString(value: string) {
  return value.length > DEBUG_MAX_STRING_LENGTH
    ? `${value.slice(0, DEBUG_MAX_STRING_LENGTH)}...[truncated]`
    : value;
}

function serializeDebugHeaders(headers: Headers) {
  return Object.fromEntries(
    [...headers.entries()].map(([key, value]) => [
      key,
      DEBUG_REDACT_KEY_PATTERN.test(key)
        ? "[Redacted]"
        : truncateDebugString(value),
    ]),
  );
}

function serializeDebugValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 8) return "[Truncated]";
  if (typeof value === "string") return truncateDebugString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();

  if (typeof Response !== "undefined" && value instanceof Response) {
    return {
      status: value.status,
      statusText: value.statusText,
      url: value.url,
      headers: serializeDebugHeaders(value.headers),
    };
  }

  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    const errorPayload: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    if (value.cause) {
      errorPayload.cause = serializeDebugValue(value.cause, seen, depth + 1);
    }

    for (const key of Object.getOwnPropertyNames(value)) {
      if (["name", "message", "stack", "cause"].includes(key)) continue;
      const nestedValue = (value as unknown as Record<string, unknown>)[key];
      errorPayload[key] = DEBUG_REDACT_KEY_PATTERN.test(key)
        ? "[Redacted]"
        : serializeDebugValue(nestedValue, seen, depth + 1);
    }

    return errorPayload;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDebugValue(item, seen, depth + 1));
  }

  const payload: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const nestedValue = (value as Record<string, unknown>)[key];
    payload[key] = DEBUG_REDACT_KEY_PATTERN.test(key)
      ? "[Redacted]"
      : serializeDebugValue(nestedValue, seen, depth + 1);
  }
  return payload;
}

function aiWizardDebugPayload({
  error,
  request,
  shop,
}: {
  error: unknown;
  request: AiWizardRequest | null;
  shop: string;
}) {
  return {
    timestamp: new Date().toISOString(),
    route: "app.ai-wizard.action",
    shop,
    request: request
      ? {
          userGoal: request.userGoal,
          hasPreviousPlan: Boolean(request.previousPlan),
          previousPlanNextStep: request.previousPlan?.nextStep ?? null,
        }
      : null,
    error: serializeDebugValue(error),
  };
}

function parsePreviousPlan(value: unknown): AiWizardRequest["previousPlan"] {
  if (!value) return null;
  if (typeof value === "object") {
    return value as AiWizardRequest["previousPlan"];
  }
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as AiWizardRequest["previousPlan"])
      : null;
  } catch {
    return null;
  }
}

function aiWizardDisabled() {
  return ["1", "true", "yes"].includes(
    (process.env.AI_WIZARD_DISABLED ?? "").trim().toLowerCase(),
  );
}

async function readAiWizardRequest(request: Request): Promise<AiWizardRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as {
      userGoal?: unknown;
      goal?: unknown;
      previousPlan?: unknown;
    } | null;
    return {
      userGoal: asString(payload?.userGoal ?? payload?.goal).slice(0, MAX_GOAL_LENGTH),
      previousPlan: parsePreviousPlan(payload?.previousPlan),
    };
  }

  const formData = await request.formData();
  return {
    userGoal: asString(formData.get("userGoal") ?? formData.get("goal")).slice(
      0,
      MAX_GOAL_LENGTH,
    ),
    previousPlan: parsePreviousPlan(formData.get("previousPlan")),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "app.ai-wizard.loader", async () => {
    const { session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const disabled = aiWizardDisabled();

    return {
      ok: true,
      enabled: !disabled && Boolean(process.env.OPENAI_API_KEY),
      disabled,
      defaultModel: process.env.AI_WIZARD_MODEL || "gpt-5-mini",
      fallbackModel: process.env.AI_WIZARD_FALLBACK_MODEL || "gpt-5.5",
      safety: {
        appliesAutomatically: false,
        requiresReview: true,
        requiresExplicitConfirmation: true,
      },
    };
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "app.ai-wizard.action", async () => {
    const { admin, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    let wizardRequest: AiWizardRequest | null = null;

    try {
      if (aiWizardDisabled()) {
        return {
          ok: false,
          code: "ai_disabled",
          message: "The AI cleanup wizard is disabled. You can continue with manual setup.",
        };
      }

      wizardRequest = await readAiWizardRequest(request);
      if (!wizardRequest.userGoal) {
        return {
          ok: false,
          code: "missing_goal",
          message: "Describe what you want to clean up.",
        };
      }

      return await createAiWizardPlan({
        admin,
        shop: session.shop,
        request: wizardRequest,
      });
    } catch (error) {
      if (error instanceof AiWizardConfigurationError) {
        logger.warn("ai_wizard.config_missing", {
          error: logger.serializeError(error),
        });
        return {
          ok: false,
          code: "ai_not_configured",
          message: error.message,
        };
      }

      const debug = aiWizardDebugPayload({
        error,
        request: wizardRequest,
        shop: session.shop,
      });
      logger.error("ai_wizard.action.failed", {
        error: logger.serializeError(error),
        debug,
      });
      return {
        ok: false,
        code: "ai_wizard_failed",
        message: "The AI cleanup plan could not be generated. Try again or use the manual cleanup flow.",
        debug,
      };
    }
  });
};

// No default export -> resource route (never rendered as a page)
