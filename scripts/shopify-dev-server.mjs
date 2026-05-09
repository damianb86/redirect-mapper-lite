import { spawn } from "node:child_process";

const env = { ...process.env };
const appEnv = env.APP_ENV || "development";

if (appEnv !== "production") {
  if (env.HOST) {
    env.SHOPIFY_APP_URL = env.HOST;
    env.DEV_SHOPIFY_APP_URL = env.HOST;
  } else if (env.DEV_SHOPIFY_APP_URL) {
    env.SHOPIFY_APP_URL = env.DEV_SHOPIFY_APP_URL;
  } else if (env.PROD_SHOPIFY_APP_URL && env.SHOPIFY_APP_URL === env.PROD_SHOPIFY_APP_URL) {
    delete env.SHOPIFY_APP_URL;
  }
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
