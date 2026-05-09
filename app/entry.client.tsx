import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

const SENSITIVE_QUERY_KEY = /(authorization|cookie|password|secret|token|accessToken|refreshToken|apiKey|apiSecret|hmac|signature|code|state|session|id_token)/i;

function truncate(value: string | undefined, maxLength = 3000) {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}

function safePath() {
  try {
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        url.searchParams.set(key, "[Redacted]");
      }
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return window.location.pathname;
  }
}

function errorFields(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncate(error.message),
      stack: truncate(error.stack),
    };
  }

  let message = "Unknown client error";
  try {
    message = typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    message = String(error);
  }

  return {
    message: truncate(message),
  };
}

function reportClientError(
  event: string,
  fields: Record<string, unknown> = {},
) {
  try {
    const body = JSON.stringify({
      event,
      path: safePath(),
      userAgent: navigator.userAgent,
      ts: new Date().toISOString(),
      ...fields,
    });

    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        "/client-logs",
        new Blob([body], { type: "application/json" }),
      );
      if (sent) return;
    }

    void fetch("/client-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // Logging must never create a second client-side failure.
  }
}

window.addEventListener("error", (event) => {
  reportClientError("client.error", {
    message: truncate(event.message),
    source: truncate(event.filename),
    line: event.lineno,
    column: event.colno,
    error: errorFields(event.error),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientError("client.unhandled_rejection", {
    error: errorFields(event.reason),
  });
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    {
      onRecoverableError(error, errorInfo) {
        reportClientError("react.recoverable_error", {
          error: errorFields(error),
          componentStack: truncate(errorInfo.componentStack),
        });
      },
    },
  );
});
