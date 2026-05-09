import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { logger, sanitizeUrl } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 4000;

function truncate(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : value;
}

function sanitizePath(value: unknown) {
  if (typeof value !== "string") return undefined;

  try {
    return sanitizeUrl(new URL(value, "https://client.local"));
  } catch {
    return undefined;
  }
}

function errorPayload(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const error = value as Record<string, unknown>;
  return {
    name: truncate(error.name),
    message: truncate(error.message),
    stack: truncate(error.stack),
  };
}

function clientPayload(value: unknown) {
  if (!value || typeof value !== "object") {
    return { event: "client.invalid_payload" };
  }

  const payload = value as Record<string, unknown>;
  return {
    event: truncate(payload.event) ?? "client.error",
    path: sanitizePath(payload.path),
    source: sanitizePath(payload.source),
    message: truncate(payload.message),
    componentStack: truncate(payload.componentStack),
    line: typeof payload.line === "number" ? payload.line : undefined,
    column: typeof payload.column === "number" ? payload.column : undefined,
    clientTs: truncate(payload.ts),
    clientUserAgent: truncate(payload.userAgent),
    error: errorPayload(payload.error),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "client.logs.loader", async () => {
    return Response.json({ ok: true });
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "client.logs.action", async () => {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      logger.warn("client.log.rejected", {
        reason: "payload_too_large",
        bytes: text.length,
      });
      return new Response(null, { status: 204 });
    }

    let rawPayload: unknown = null;
    try {
      rawPayload = text ? JSON.parse(text) : null;
    } catch (error) {
      logger.warn("client.log.rejected", {
        reason: "invalid_json",
        error: logger.serializeError(error),
      });
      return new Response(null, { status: 204 });
    }

    const payload = clientPayload(rawPayload);
    if (payload.event === "react.recoverable_error") {
      logger.warn("client.react.recoverable_error", { client: payload });
    } else {
      logger.error("client.error", { client: payload });
    }

    return new Response(null, { status: 204 });
  });
};
