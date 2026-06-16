#!/usr/bin/env node
import { readFileSync } from "node:fs";

const envFile = process.argv[2];

if (!envFile) {
  console.error("Usage: print-shell-env.mjs <env-file>");
  process.exit(1);
}

const contents = readFileSync(envFile, "utf8");

for (const rawLine of contents.split(/\n/)) {
  const line = rawLine.replace(/\r$/, "").trim();
  if (!line || line.startsWith("#")) continue;

  const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
  const separatorIndex = assignment.indexOf("=");
  if (separatorIndex <= 0) continue;

  const key = assignment.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

  const rawValue = assignment.slice(separatorIndex + 1).trim();
  const value = unquoteEnvValue(rawValue);
  process.stdout.write(`export ${key}=${shellQuote(value)}\n`);
}

function unquoteEnvValue(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  return value;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
