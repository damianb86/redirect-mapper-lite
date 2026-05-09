import compression from "compression";
import express from "express";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler } from "@react-router/express";

const APP_NAME = process.env.APP_NAME || "redirect-mapper-lite";
const LOG_DIR = process.env.LOG_DIR?.trim();
const LOG_TO_FILE = process.env.LOG_TO_FILE !== "false" && Boolean(LOG_DIR);
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|accessToken|refreshToken|apiKey|apiSecret|hmac|signature|code|state|session|id_token)/i;

let fileStream = null;

function getFileStream() {
  if (!LOG_TO_FILE || !LOG_DIR) return null;
  if (fileStream) return fileStream;
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  fileStream = createWriteStream(path.join(LOG_DIR, `${APP_NAME}.jsonl`), {
    flags: "a",
  });
  return fileStream;
}

function sanitizeUrl(input) {
  if (!input) return undefined;

  try {
    const url = new URL(input, "http://app.local");
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

function writeLog(level, event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    app: APP_NAME,
    event,
    ...fields,
  }) + "\n";

  if (level === "error" || level === "warn") process.stderr.write(line);
  else process.stdout.write(line);
  getFileStream()?.write(line);
}

const buildPath = path.resolve("build/server/index.js");
const build = await import(pathToFileURL(buildPath).href);
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST;

app.disable("x-powered-by");
app.use(compression());

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    writeLog(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "access.request", {
      method: req.method,
      path: sanitizeUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userAgent: req.get("user-agent"),
      referer: sanitizeUrl(req.get("referer")),
      ip: req.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip,
    });
  });
  next();
});

app.use(
  path.posix.join(build.publicPath, "assets"),
  express.static(path.join(build.assetsBuildDirectory, "assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(build.publicPath, express.static(build.assetsBuildDirectory));
app.use(express.static("public", { maxAge: "1h" }));

app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
  }),
);

const server = host
  ? app.listen(port, host, onListen)
  : app.listen(port, onListen);

function onListen() {
  writeLog("info", "server.listening", {
    port,
    host: host || "0.0.0.0",
    nodeEnv: process.env.NODE_ENV,
  });
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    writeLog("info", "server.shutdown", { signal });
    server.close((error) => {
      if (error) {
        writeLog("error", "server.shutdown_failed", {
          error: { name: error.name, message: error.message, stack: error.stack },
        });
      }
      process.exit(error ? 1 : 0);
    });
  });
}
