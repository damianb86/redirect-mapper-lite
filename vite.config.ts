import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const appEnv = process.env.APP_ENV || "development";

function normalizeUrl(value: string | undefined, fallback: string) {
  const url = value || fallback;
  return url.startsWith("http://") || url.startsWith("https://")
    ? url
    : `https://${url}`;
}

if (appEnv !== "production" && process.env.HOST) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const appUrl =
  appEnv === "production"
    ? normalizeUrl(
        process.env.PROD_SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL,
        "http://127.0.0.1",
      )
    : normalizeUrl(
        process.env.SHOPIFY_APP_URL || process.env.DEV_SHOPIFY_APP_URL,
        "http://127.0.0.1",
      );

const host = new URL(appUrl).hostname;

let hmrConfig;
if (host === "127.0.0.1" || host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
