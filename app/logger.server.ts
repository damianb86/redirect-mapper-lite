import { AsyncLocalStorage } from "node:async_hooks";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = {
  requestId?: string;
  route?: string;
  method?: string;
  path?: string;
  shop?: string;
};

type LogFields = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const APP_NAME = process.env.APP_NAME || "redirect-mapper-lite";
const LOG_LEVEL = normalizeLevel(process.env.LOG_LEVEL);
const LOG_DIR = process.env.LOG_DIR?.trim();
const LOG_TO_FILE = process.env.LOG_TO_FILE !== "false" && Boolean(LOG_DIR);
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|accessToken|refreshToken|apiKey|apiSecret|hmac|signature|code|state|session)/i;

const logContext = new AsyncLocalStorage<LogContext>();
let fileStream: ReturnType<typeof createWriteStream> | null = null;
const HANDLERS_KEY = Symbol.for("redirect-mapper-lite.logger.handlers-installed");

function normalizeLevel(level: string | undefined): LogLevel {
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
}

function shouldLog(level: LogLevel) {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[LOG_LEVEL];
}

function getFileStream() {
  if (!LOG_TO_FILE || !LOG_DIR) return null;
  if (fileStream) return fileStream;

  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  fileStream = createWriteStream(path.join(LOG_DIR, `${APP_NAME}.jsonl`), {
    flags: "a",
  });

  fileStream.on("error", (error) => {
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        app: APP_NAME,
        event: "logger.file_write_failed",
        error: serializeError(error),
      }) + "\n",
    );
  });

  return fileStream;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (value instanceof Error) return serializeError(value);
  if (value instanceof URL) return sanitizeUrl(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const safe: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[Redacted]"
      : redact(nestedValue, depth + 1);
  }
  return safe;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? redact(error.cause) : undefined,
    };
  }

  return {
    message:
      typeof error === "string"
        ? error
        : inspect(error, { depth: 4, breakLength: 140 }),
  };
}

export function sanitizeUrl(input: string | URL | null | undefined) {
  if (!input) return undefined;

  try {
    const url = typeof input === "string" ? new URL(input) : new URL(input.toString());
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, "[Redacted]");
      }
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return String(input);
  }
}

export function runWithLogContext<T>(context: LogContext, callback: () => T) {
  return logContext.run(context, callback);
}

export function getLogContext() {
  return logContext.getStore() ?? {};
}

export function addLogContext(context: LogContext) {
  const current = logContext.getStore();
  if (current) {
    Object.assign(current, context);
  }
}

function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
  if (!shouldLog(level)) return;
  const safeFields = redact(fields) as Record<string, unknown>;

  const entry = {
    ts: new Date().toISOString(),
    level,
    app: APP_NAME,
    event,
    ...getLogContext(),
    ...safeFields,
  };
  const line = JSON.stringify(entry) + "\n";

  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }

  getFileStream()?.write(line);
}

export const logger = {
  debug(event: string, fields?: LogFields) {
    writeLog("debug", event, fields);
  },
  info(event: string, fields?: LogFields) {
    writeLog("info", event, fields);
  },
  warn(event: string, fields?: LogFields) {
    writeLog("warn", event, fields);
  },
  error(event: string, fields?: LogFields) {
    writeLog("error", event, fields);
  },
  serializeError,
};

const globalWithHandlers = globalThis as typeof globalThis & {
  [HANDLERS_KEY]?: boolean;
};

if (!globalWithHandlers[HANDLERS_KEY]) {
  globalWithHandlers[HANDLERS_KEY] = true;

  process.on("unhandledRejection", (reason) => {
    logger.error("process.unhandled_rejection", {
      error: logger.serializeError(reason),
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("process.uncaught_exception", {
      error: logger.serializeError(error),
    });
  });
}
