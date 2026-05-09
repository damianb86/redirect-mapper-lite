import { spawn } from "node:child_process";

const env = { ...process.env };
const appEnv = env.APP_ENV || "development";

if (appEnv !== "production" && env.HOST) {
  env.SHOPIFY_APP_URL = env.HOST;
}

const child = spawn("npm", ["exec", "react-router", "dev"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
