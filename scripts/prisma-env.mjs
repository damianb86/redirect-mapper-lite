import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

const appEnv = process.env.APP_ENV || "development";
const isProduction = appEnv === "production";
const schema =
  process.env.PRISMA_SCHEMA ||
  (isProduction ? "prisma/schema.prisma" : "prisma/schema.dev.prisma");

if (!isProduction) {
  process.env.DATABASE_URL = process.env.DEV_DATABASE_URL || "file:./dev.sqlite";
}

const args = process.argv.slice(2);
const command = args[0] || "generate";
const commandArgs = args.slice(1);

function runPrisma(prismaArgs) {
  const result = spawnSync("npx", ["prisma", ...prismaArgs, "--schema", schema], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (command === "setup") {
  runPrisma(["generate"]);
  if (isProduction) {
    runPrisma(["migrate", "deploy"]);
  } else {
    runPrisma(["db", "push", "--skip-generate"]);
  }
} else {
  runPrisma([command, ...commandArgs]);
}
