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

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

    try {
      if (aiWizardDisabled()) {
        return {
          ok: false,
          code: "ai_disabled",
          message: "The AI cleanup wizard is disabled. You can continue with manual setup.",
        };
      }

      const wizardRequest = await readAiWizardRequest(request);
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

      logger.error("ai_wizard.action.failed", {
        error: logger.serializeError(error),
      });
      return {
        ok: false,
        code: "ai_wizard_failed",
        message: "The AI cleanup plan could not be generated. Try again or use the manual cleanup flow.",
      };
    }
  });
};

// No default export -> resource route (never rendered as a page)
