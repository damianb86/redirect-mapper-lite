import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { logger, runWithLogContext, sanitizeUrl } from "./logger.server";

type RequestHandler<T> = () => Promise<T> | T;

function getHeader(request: Request, name: string) {
  return request.headers.get(name) ?? undefined;
}

function getClientIp(request: Request) {
  const forwardedFor = getHeader(request, "x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim();
  return getHeader(request, "x-real-ip");
}

function inferShop(url: URL) {
  return (
    url.searchParams.get("shop") ||
    url.searchParams.get("shopify_domain") ||
    undefined
  );
}

function resultStatus(result: unknown) {
  return result instanceof Response ? result.status : 200;
}

function responseLocation(errorOrResult: unknown) {
  if (!(errorOrResult instanceof Response)) return undefined;
  return sanitizeUrl(errorOrResult.headers.get("location"));
}

function logLevelForStatus(status: number) {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export async function withRequestLogging<T>(
  request: Request,
  route: string,
  handler: RequestHandler<T>,
): Promise<T> {
  const url = new URL(request.url);
  const requestId = getHeader(request, "x-request-id") || randomUUID();
  const context = {
    requestId,
    route,
    method: request.method,
    path: url.pathname,
    shop: inferShop(url),
  };
  const startedAt = performance.now();

  return runWithLogContext(context, async () => {
    logger.debug("request.started", {
      host: getHeader(request, "host"),
      query: sanitizeUrl(url),
      userAgent: getHeader(request, "user-agent"),
      referer: sanitizeUrl(getHeader(request, "referer")),
      ip: getClientIp(request),
    });

    try {
      const result = await handler();
      const status = resultStatus(result);
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const level = logLevelForStatus(status);

      logger[level]("request.completed", {
        status,
        durationMs,
        location: responseLocation(result),
      });

      return result;
    } catch (error) {
      const status = error instanceof Response ? error.status : 500;
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const level = logLevelForStatus(status);

      if (error instanceof Response && status < 400) {
        logger[level]("request.redirected", {
          status,
          durationMs,
          location: responseLocation(error),
        });

        throw error;
      }

      logger[level]("request.failed", {
        status,
        durationMs,
        location: responseLocation(error),
        error: error instanceof Response
          ? {
              type: "Response",
              status: error.status,
              statusText: error.statusText,
            }
          : logger.serializeError(error),
      });

      throw error;
    }
  });
}
