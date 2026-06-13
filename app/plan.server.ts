// Server-only: DB queries + billing resolution. Never imported by client bundles.
import prisma from "./db.server";
import { authenticate, STANDARD_PLAN } from "./shopify.server";
import { FREE_PLAN_REDIRECT_LIMIT } from "./plan";
import type { PlanId, PlanInfo } from "./plan";
import { addLogContext, logger } from "./logger.server";
import { shouldUseTestBilling } from "./billing.server";

export type { PlanId, PlanInfo };

const DAY_MS = 24 * 60 * 60 * 1000;

const APP_BILLING_STATE_QUERY = `#graphql
  query AppBillingState {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        test
        status
        trialDays
        createdAt
        currentPeriodEnd
      }
      allSubscriptions(first: 10, reverse: true) {
        nodes {
          id
          name
          test
          status
          trialDays
          createdAt
          currentPeriodEnd
        }
      }
    }
  }
` as string;

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>;
type AdminClient = AdminContext["admin"];
type BillingClient = AdminContext["billing"];

export type BillingSubscription = {
  id?: string;
  name?: string;
  test?: boolean;
  status?: string;
  trialDays?: number;
  createdAt?: string | null;
  currentPeriodEnd?: string | null;
};

type AppSubscriptionWebhookPayload = {
  app_subscription?: {
    admin_graphql_api_id?: string;
    id?: string | number;
    name?: string;
    status?: string;
    test?: boolean;
    created_at?: string;
    updated_at?: string;
  };
};

type PlanInfoOptions = {
  settleBillingApproval?: boolean;
};

export type BillingPlanSnapshot = {
  plan: PlanId;
  subscriptionId: string | null;
  billingAccessUntil: Date | null;
  billingSource: PlanInfo["billingSource"];
  billingSubscriptionStatus: string | null;
  reactivationTrialDays: number;
  activeSubscription: BillingSubscription | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDate(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToIso(date: Date | null) {
  return date ? date.toISOString() : null;
}

function isFutureDate(date: Date | null, now = new Date()) {
  return Boolean(date && date.getTime() > now.getTime());
}

function remainingTrialDays(until: Date | null, now = new Date()) {
  if (!isFutureDate(until, now)) return 0;
  return Math.max(1, Math.ceil((until!.getTime() - now.getTime()) / DAY_MS));
}

function normalizeStatus(status?: string | null) {
  return status?.trim().toUpperCase() || null;
}

function standardSubscription(subscriptions: BillingSubscription[]) {
  return subscriptions.find((sub) => sub.name === STANDARD_PLAN);
}

function latestStandardSubscription(subscriptions: BillingSubscription[]) {
  const standards = subscriptions.filter((sub) => sub.name === STANDARD_PLAN);
  return standards.sort((a, b) => {
    const aDate = parseDate(a.createdAt)?.getTime() ?? 0;
    const bDate = parseDate(b.createdAt)?.getTime() ?? 0;
    return bDate - aDate;
  })[0];
}

async function fetchShopifyBillingState(admin: AdminClient, shop: string) {
  try {
    const response = await admin.graphql(APP_BILLING_STATE_QUERY);
    const json = (await response.json()) as {
      data?: {
        currentAppInstallation?: {
          activeSubscriptions?: BillingSubscription[] | null;
          allSubscriptions?: { nodes?: BillingSubscription[] | null } | null;
        } | null;
      };
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    return {
      activeSubscriptions:
        json.data?.currentAppInstallation?.activeSubscriptions ?? [],
      allSubscriptions:
        json.data?.currentAppInstallation?.allSubscriptions?.nodes ?? [],
    };
  } catch (error) {
    logger.warn("billing.state_query_failed", {
      shop,
      error: logger.serializeError(error),
    });
    return { activeSubscriptions: [], allSubscriptions: [] };
  }
}

async function resolveBillingSubscriptions(billing: BillingClient, isTest: boolean) {
  const filtered = await billing.check({
    plans: [STANDARD_PLAN],
    isTest,
  });
  const filteredSubscriptions = filtered.appSubscriptions as BillingSubscription[];
  const filteredStandard = standardSubscription(filteredSubscriptions);

  if (filteredStandard) {
    return {
      appSubscriptions: filteredSubscriptions,
      activeSubscription: filteredStandard,
      checkSource: "filtered",
    };
  }

  // Shopify's SDK documents that billing.check() without options returns
  // active payments regardless of test mode or plan filters. Use it as a
  // defensive fallback for approval returns where Shopify has accepted a test
  // charge but the local test-mode decision is temporarily wrong or stale.
  const unfiltered = await billing.check();
  const unfilteredSubscriptions = unfiltered.appSubscriptions as BillingSubscription[];
  const unfilteredStandard = standardSubscription(unfilteredSubscriptions);

  return {
    appSubscriptions: unfilteredStandard ? unfilteredSubscriptions : filteredSubscriptions,
    activeSubscription: unfilteredStandard,
    checkSource: unfilteredStandard ? "unfiltered" : "filtered",
  };
}

async function upsertActiveEntitlement(
  shop: string,
  subscription: BillingSubscription,
) {
  const status = normalizeStatus(subscription.status) ?? "ACTIVE";
  const currentPeriodEnd = parseDate(subscription.currentPeriodEnd);

  return prisma.shopBillingEntitlement.upsert({
    where: { shop },
    update: {
      plan: "standard",
      shopifySubscriptionId: subscription.id ?? null,
      shopifyStatus: status,
      currentPeriodEnd,
      entitledUntil: currentPeriodEnd,
      cancelledAt: null,
      frozenAt: null,
      test: subscription.test ?? null,
    },
    create: {
      shop,
      plan: "standard",
      shopifySubscriptionId: subscription.id ?? null,
      shopifyStatus: status,
      currentPeriodEnd,
      entitledUntil: currentPeriodEnd,
      test: subscription.test ?? null,
    },
  });
}

async function markFrozenEntitlement(
  shop: string,
  subscription?: BillingSubscription | null,
) {
  const now = new Date();
  return prisma.shopBillingEntitlement.upsert({
    where: { shop },
    update: {
      plan: "free",
      shopifySubscriptionId: subscription?.id ?? undefined,
      shopifyStatus: "FROZEN",
      entitledUntil: now,
      frozenAt: now,
      test: subscription?.test ?? undefined,
    },
    create: {
      shop,
      plan: "free",
      shopifySubscriptionId: subscription?.id ?? null,
      shopifyStatus: "FROZEN",
      entitledUntil: now,
      frozenAt: now,
      test: subscription?.test ?? null,
    },
  });
}

async function markCancelledEntitlement(
  shop: string,
  subscriptionId: string | null,
  accessUntil: Date | null,
) {
  const now = new Date();
  const existing = await prisma.shopBillingEntitlement.findUnique({ where: { shop } });
  const entitledUntil = accessUntil ?? existing?.entitledUntil ?? null;
  const currentPeriodEnd = accessUntil ?? existing?.currentPeriodEnd ?? null;

  return prisma.shopBillingEntitlement.upsert({
    where: { shop },
    update: {
      plan: isFutureDate(entitledUntil, now) ? "standard" : "free",
      shopifySubscriptionId: subscriptionId ?? existing?.shopifySubscriptionId ?? null,
      shopifyStatus: "CANCELLED",
      currentPeriodEnd,
      entitledUntil,
      cancelledAt: existing?.cancelledAt ?? now,
    },
    create: {
      shop,
      plan: isFutureDate(entitledUntil, now) ? "standard" : "free",
      shopifySubscriptionId: subscriptionId,
      shopifyStatus: "CANCELLED",
      currentPeriodEnd,
      entitledUntil,
      cancelledAt: now,
    },
  });
}

async function markPassiveSubscriptionStatus(
  shop: string,
  status: string,
  subscriptionId?: string | null,
  test?: boolean | null,
) {
  const existing = await prisma.shopBillingEntitlement.findUnique({ where: { shop } });
  if (!existing) {
    return prisma.shopBillingEntitlement.create({
      data: {
        shop,
        plan: "free",
        shopifySubscriptionId: subscriptionId ?? null,
        shopifyStatus: status,
        test: test ?? null,
      },
    });
  }

  return prisma.shopBillingEntitlement.update({
    where: { shop },
    data: {
      shopifySubscriptionId: subscriptionId ?? existing.shopifySubscriptionId,
      shopifyStatus: status,
      test: test ?? existing.test,
    },
  });
}

export async function resolveBillingPlanSnapshot(
  admin: AdminClient,
  billing: BillingClient,
  shop: string,
  isTest: boolean,
): Promise<BillingPlanSnapshot> {
  const now = new Date();
  const { appSubscriptions, activeSubscription, checkSource } =
    await resolveBillingSubscriptions(billing, isTest);
  const shopifyState = await fetchShopifyBillingState(admin, shop);
  const graphActiveStandard = standardSubscription(shopifyState.activeSubscriptions);
  const activeStandard = activeSubscription ?? graphActiveStandard ?? null;
  const latestStandard =
    latestStandardSubscription(shopifyState.allSubscriptions) ?? activeStandard;
  const latestStatus = normalizeStatus(latestStandard?.status);

  if (latestStatus === "FROZEN") {
    const entitlement = await markFrozenEntitlement(shop, latestStandard);
    logger.info("billing.plan.resolved", {
      shop,
      isTest,
      checkSource,
      planSource: "free",
      plan: "free",
      subscriptions: appSubscriptions.map((sub) => ({
        id: sub.id ?? null,
        name: sub.name ?? null,
        test: sub.test ?? null,
        status: sub.status ?? null,
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
      })),
      latestStatus,
    });

    return {
      plan: "free",
      subscriptionId: null,
      billingAccessUntil: entitlement.entitledUntil,
      billingSource: "free",
      billingSubscriptionStatus: "FROZEN",
      reactivationTrialDays: 0,
      activeSubscription: null,
    };
  }

  if (activeStandard) {
    const entitlement = await upsertActiveEntitlement(shop, activeStandard);
    const accessUntil = entitlement.entitledUntil;

    logger.info("billing.plan.resolved", {
      shop,
      isTest,
      checkSource,
      planSource: "shopify",
      plan: "standard",
      accessUntil: dateToIso(accessUntil),
      subscriptions: appSubscriptions.map((sub) => ({
        id: sub.id ?? null,
        name: sub.name ?? null,
        test: sub.test ?? null,
        status: sub.status ?? null,
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
      })),
    });

    return {
      plan: "standard",
      subscriptionId: activeStandard.id ?? null,
      billingAccessUntil: accessUntil,
      billingSource: "shopify",
      billingSubscriptionStatus: normalizeStatus(activeStandard.status) ?? "ACTIVE",
      reactivationTrialDays: 0,
      activeSubscription: activeStandard,
    };
  }

  if (latestStatus === "CANCELLED") {
    await markCancelledEntitlement(
      shop,
      latestStandard?.id ?? null,
      parseDate(latestStandard?.currentPeriodEnd),
    );
  } else if (latestStatus) {
    await markPassiveSubscriptionStatus(
      shop,
      latestStatus,
      latestStandard?.id ?? null,
      latestStandard?.test ?? null,
    );
  }

  const entitlement = await prisma.shopBillingEntitlement.findUnique({
    where: { shop },
  });
  const accessUntil = entitlement?.entitledUntil ?? null;
  const hasPaidAccess =
    entitlement?.plan === "standard" &&
    entitlement.shopifyStatus !== "FROZEN" &&
    isFutureDate(accessUntil, now);
  const plan: PlanId = hasPaidAccess ? "standard" : "free";

  logger.info("billing.plan.resolved", {
    shop,
    isTest,
    checkSource,
    planSource: hasPaidAccess ? "entitlement" : "free",
    plan,
    accessUntil: dateToIso(accessUntil),
    latestStatus,
    subscriptions: appSubscriptions.map((sub) => ({
      id: sub.id ?? null,
      name: sub.name ?? null,
      test: sub.test ?? null,
      status: sub.status ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
    })),
  });

  return {
    plan,
    subscriptionId: null,
    billingAccessUntil: accessUntil,
    billingSource: hasPaidAccess ? "entitlement" : "free",
    billingSubscriptionStatus: entitlement?.shopifyStatus ?? latestStatus,
    reactivationTrialDays: hasPaidAccess ? remainingTrialDays(accessUntil, now) : 0,
    activeSubscription: null,
  };
}

async function resolvePlanSnapshot(request: Request) {
  const { admin, session, billing } = await authenticate.admin(request);
  addLogContext({ shop: session.shop });
  const isTest = await shouldUseTestBilling(admin, session.shop);
  const billingSnapshot = await resolveBillingPlanSnapshot(
    admin,
    billing,
    session.shop,
    isTest,
  );

  const redirectsUsed = await prisma.cleanupRedirect.count({
    where: { shop: session.shop, shopifyRedirectId: { not: null } },
  });

  return {
    plan: billingSnapshot.plan,
    redirectsUsed,
    redirectLimit:
      billingSnapshot.plan === "free" ? FREE_PLAN_REDIRECT_LIMIT : null,
    subscriptionId: billingSnapshot.subscriptionId,
    billingAccessUntil: dateToIso(billingSnapshot.billingAccessUntil),
    billingSource: billingSnapshot.billingSource,
    billingSubscriptionStatus: billingSnapshot.billingSubscriptionStatus,
    reactivationTrialDays: billingSnapshot.reactivationTrialDays,
  };
}

export async function markStandardSubscriptionCancelled(
  shop: string,
  subscriptionId: string,
  accessUntil: Date | null,
) {
  return markCancelledEntitlement(shop, subscriptionId, accessUntil);
}

export async function syncBillingEntitlementFromWebhook({
  shop,
  payload,
  admin,
}: {
  shop: string;
  payload: unknown;
  admin?: AdminClient;
}) {
  const appSubscription = (payload as AppSubscriptionWebhookPayload)
    .app_subscription;
  if (!appSubscription || appSubscription.name !== STANDARD_PLAN) return;

  const status = normalizeStatus(appSubscription.status);
  const subscriptionId =
    appSubscription.admin_graphql_api_id ??
    (appSubscription.id ? String(appSubscription.id) : null);

  if (status === "ACTIVE" && admin) {
    const shopifyState = await fetchShopifyBillingState(admin, shop);
    const activeStandard = standardSubscription(shopifyState.activeSubscriptions);
    if (activeStandard) {
      await upsertActiveEntitlement(shop, activeStandard);
      return;
    }
  }

  if (status === "FROZEN") {
    await markFrozenEntitlement(shop, {
      id: subscriptionId ?? undefined,
      name: appSubscription.name,
      status,
      test: appSubscription.test,
    });
    return;
  }

  if (status === "CANCELLED") {
    await markCancelledEntitlement(shop, subscriptionId, null);
    return;
  }

  if (status) {
    await markPassiveSubscriptionStatus(
      shop,
      status,
      subscriptionId,
      appSubscription.test ?? null,
    );
  }
}

export async function getPlanInfo(
  request: Request,
  options: PlanInfoOptions = {},
): Promise<PlanInfo> {
  const url = new URL(request.url);
  const isBillingReturn = url.searchParams.get("billing") === "approved";
  const chargeId = url.searchParams.get("charge_id");
  let snapshot = await resolvePlanSnapshot(request);
  let attempts = 1;

  if (
    options.settleBillingApproval &&
    isBillingReturn &&
    snapshot.billingSource !== "shopify"
  ) {
    const maxAttempts = 4;
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      await sleep(1500);
      attempts += 1;
      snapshot = await resolvePlanSnapshot(request);
      if (snapshot.billingSource === "shopify") break;
    }
  }

  const billingConfirmed =
    isBillingReturn && snapshot.billingSource === "shopify";

  if (isBillingReturn) {
    logger.info("billing.approval_return.resolved", {
      chargeId,
      plan: snapshot.plan,
      source: snapshot.billingSource,
      status: billingConfirmed ? "confirmed" : "pending",
      attempts,
      settled: Boolean(options.settleBillingApproval),
    });
  }

  return {
    ...snapshot,
    billingReturnStatus: !isBillingReturn
      ? "none"
      : billingConfirmed
        ? "confirmed"
        : "pending",
    billingReturnChargeId: chargeId,
  };
}
