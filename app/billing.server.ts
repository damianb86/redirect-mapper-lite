import { logger } from "./logger.server";

const SHOP_PLAN_QUERY = `#graphql
  query ShopBillingMode {
    shop {
      plan {
        partnerDevelopment
        publicDisplayName
      }
    }
  }
` as string;

function envBillingTestOverride() {
  const value = process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

export async function shouldUseTestBilling(
  admin: { graphql(query: string): Promise<Response> },
  shop: string,
) {
  const override = envBillingTestOverride();
  if (override !== null) {
    logger.info("billing.mode.resolved", {
      shop,
      isTest: override,
      source: "SHOPIFY_BILLING_TEST",
    });
    return override;
  }

  if (process.env.NODE_ENV !== "production") {
    logger.info("billing.mode.resolved", {
      shop,
      isTest: true,
      source: "node_env",
      nodeEnv: process.env.NODE_ENV ?? null,
    });
    return true;
  }

  try {
    const response = await admin.graphql(SHOP_PLAN_QUERY);
    const json = (await response.json()) as {
      data?: {
        shop?: {
          plan?: {
            partnerDevelopment?: boolean | null;
            publicDisplayName?: string | null;
          } | null;
        } | null;
      };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    const plan = json.data?.shop?.plan;
    const isPartnerDevelopment = Boolean(plan?.partnerDevelopment);
    logger.info("billing.mode.resolved", {
      shop,
      isTest: isPartnerDevelopment,
      source: "shop_plan",
      partnerDevelopment: isPartnerDevelopment,
      plan: plan?.publicDisplayName ?? null,
    });
    return isPartnerDevelopment;
  } catch (error) {
    logger.warn("billing.mode_resolution_failed", {
      shop,
      isTest: false,
      source: "fallback",
      error: logger.serializeError(error),
    });
    return false;
  }
}
