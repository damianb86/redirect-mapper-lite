import prisma from "./db.server";
import { sendContactEmail } from "./email.server";
import { logger } from "./logger.server";

type AdminClient = {
  graphql(query: string): Promise<Response>;
};

type ShopDetails = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  myshopifyDomain?: string | null;
  primaryDomain?: { host?: string | null; url?: string | null } | null;
  plan?: {
    publicDisplayName?: string | null;
    partnerDevelopment?: boolean | null;
    shopifyPlus?: boolean | null;
  } | null;
  currencyCode?: string | null;
  ianaTimezone?: string | null;
  billingAddress?: {
    city?: string | null;
    province?: string | null;
    countryCodeV2?: string | null;
  } | null;
};

type UninstallPayload = {
  id?: number | string;
  name?: string;
  email?: string;
  customer_email?: string;
  domain?: string;
  myshopify_domain?: string;
  shop_owner?: string;
  plan_name?: string;
  plan_display_name?: string;
  country_name?: string;
  country_code?: string;
  currency?: string;
  iana_timezone?: string;
};

const SHOP_DETAILS_QUERY = `#graphql
  query AppLifecycleShopDetails {
    shop {
      id
      name
      email
      contactEmail
      myshopifyDomain
      primaryDomain {
        host
        url
      }
      plan {
        publicDisplayName
        partnerDevelopment
        shopifyPlus
      }
      currencyCode
      ianaTimezone
      billingAddress {
        city
        province
        countryCodeV2
      }
    }
  }
` as string;

async function getLatestLifecycleEvents(shop: string) {
  const [install, uninstall] = await Promise.all([
    prisma.contactRequest.findFirst({
      where: { shop, type: "app_install" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contactRequest.findFirst({
      where: { shop, type: "app_uninstall" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { install, uninstall };
}

function formatMaybe(value: unknown) {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value);
}

function formatShopDetails(details: ShopDetails | null) {
  if (!details) {
    return ["Shop details: unavailable"];
  }

  const address = details.billingAddress;
  const location = [address?.city, address?.province, address?.countryCodeV2]
    .filter(Boolean)
    .join(", ");

  return [
    `Shop ID: ${formatMaybe(details.id)}`,
    `Shop name: ${formatMaybe(details.name)}`,
    `MyShopify domain: ${formatMaybe(details.myshopifyDomain)}`,
    `Primary domain: ${formatMaybe(details.primaryDomain?.url ?? details.primaryDomain?.host)}`,
    `Account email: ${formatMaybe(details.email)}`,
    `Contact email: ${formatMaybe(details.contactEmail)}`,
    `Plan: ${formatMaybe(details.plan?.publicDisplayName)}`,
    `Partner development: ${formatMaybe(details.plan?.partnerDevelopment)}`,
    `Shopify Plus: ${formatMaybe(details.plan?.shopifyPlus)}`,
    `Currency: ${formatMaybe(details.currencyCode)}`,
    `Timezone: ${formatMaybe(details.ianaTimezone)}`,
    `Location: ${formatMaybe(location)}`,
  ];
}

function formatUninstallPayload(payload: UninstallPayload | null) {
  if (!payload) {
    return ["Webhook payload details: unavailable"];
  }

  return [
    `Shop ID: ${formatMaybe(payload.id)}`,
    `Shop name: ${formatMaybe(payload.name)}`,
    `Domain: ${formatMaybe(payload.domain)}`,
    `MyShopify domain: ${formatMaybe(payload.myshopify_domain)}`,
    `Shop owner: ${formatMaybe(payload.shop_owner)}`,
    `Email: ${formatMaybe(payload.email)}`,
    `Customer email: ${formatMaybe(payload.customer_email)}`,
    `Plan: ${formatMaybe(payload.plan_display_name ?? payload.plan_name)}`,
    `Country: ${formatMaybe(payload.country_name ?? payload.country_code)}`,
    `Currency: ${formatMaybe(payload.currency)}`,
    `Timezone: ${formatMaybe(payload.iana_timezone)}`,
  ];
}

async function loadShopDetails(admin: AdminClient, shop: string) {
  try {
    const response = await admin.graphql(SHOP_DETAILS_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: ShopDetails | null };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    return json.data?.shop ?? null;
  } catch (error) {
    logger.warn("app_lifecycle.shop_details_failed", {
      shop,
      error: logger.serializeError(error),
    });
    return null;
  }
}

export async function notifyAppInstalled({
  admin,
  shop,
  sessionId,
  isOnline,
  scope,
}: {
  admin: AdminClient;
  shop: string;
  sessionId: string;
  isOnline: boolean;
  scope?: string;
}) {
  try {
    const { install, uninstall } = await getLatestLifecycleEvents(shop);
    const shouldNotify = !install || Boolean(uninstall && uninstall.createdAt > install.createdAt);

    if (!shouldNotify) {
      logger.info("app_lifecycle.install_email.skipped", { shop, reason: "already_notified" });
      return;
    }

    const details = await loadShopDetails(admin, shop);
    const message = [
      "Redirect Pulse was installed or authorized by a new store.",
      "",
      `Shop: ${shop}`,
      `Session ID: ${sessionId}`,
      `Online session: ${isOnline}`,
      `Scopes: ${formatMaybe(scope)}`,
      "",
      ...formatShopDetails(details),
    ].join("\n");

    await sendContactEmail({
      type: "App lifecycle: Install",
      subject: `New install — ${shop}`,
      shop,
      message,
    });

    await prisma.contactRequest.create({
      data: {
        shop,
        type: "app_install",
        subject: "App installed",
        message,
      },
    });

    logger.info("app_lifecycle.install_email.sent", { shop });
  } catch (error) {
    logger.error("app_lifecycle.install_email.failed", {
      shop,
      error: logger.serializeError(error),
    });
  }
}

export async function notifyAppUninstalled({
  shop,
  payload,
  hadSession,
}: {
  shop: string;
  payload: unknown;
  hadSession: boolean;
}) {
  try {
    const { install, uninstall } = await getLatestLifecycleEvents(shop);
    const shouldNotify = !uninstall || Boolean(install && install.createdAt > uninstall.createdAt);

    if (!shouldNotify) {
      logger.info("app_lifecycle.uninstall_email.skipped", { shop, reason: "already_notified" });
      return;
    }

    const uninstallPayload =
      payload && typeof payload === "object" ? (payload as UninstallPayload) : null;
    const message = [
      "Redirect Pulse was uninstalled from a store.",
      "",
      `Shop: ${shop}`,
      `Had active session: ${hadSession}`,
      "",
      ...formatUninstallPayload(uninstallPayload),
    ].join("\n");

    await sendContactEmail({
      type: "App lifecycle: Uninstall",
      subject: `App uninstalled — ${shop}`,
      shop,
      message,
    });

    await prisma.contactRequest.create({
      data: {
        shop,
        type: "app_uninstall",
        subject: "App uninstalled",
        message,
      },
    });

    logger.info("app_lifecycle.uninstall_email.sent", { shop });
  } catch (error) {
    logger.error("app_lifecycle.uninstall_email.failed", {
      shop,
      error: logger.serializeError(error),
    });
  }
}
