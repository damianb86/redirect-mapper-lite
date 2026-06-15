import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { notifyAppInstalled } from "./app-lifecycle-email.server";
import prisma from "./db.server";
import { logger } from "./logger.server";

export const STANDARD_PLAN = "Standard";

function normalizeAppUrl(value?: string) {
  if (!value) return "";
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

const appEnv = process.env.APP_ENV || "development";
const devCandidateUrl =
  process.env.HOST ||
  process.env.DEV_SHOPIFY_APP_URL ||
  (process.env.SHOPIFY_APP_URL &&
  process.env.SHOPIFY_APP_URL !== process.env.PROD_SHOPIFY_APP_URL
    ? process.env.SHOPIFY_APP_URL
    : "");
const appUrl =
  appEnv === "production"
    ? normalizeAppUrl(
        process.env.PROD_SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL,
      )
    : normalizeAppUrl(devCandidateUrl);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [STANDARD_PLAN]: {
      lineItems: [
        {
          amount: 3.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  hooks: {
    afterAuth: async ({ admin, session }) => {
      await notifyAppInstalled({
        admin,
        shop: session.shop,
        sessionId: session.id,
        isOnline: session.isOnline,
        scope: session.scope,
      });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

logger.info("app.initialized", {
  apiVersion: ApiVersion.April26,
  distribution: AppDistribution.AppStore,
  appEnv,
  nodeEnv: process.env.NODE_ENV,
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
