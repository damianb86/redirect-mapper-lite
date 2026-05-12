// Server-only: DB queries + billing resolution. Never imported by client bundles.
import prisma from "./db.server";
import { authenticate, STANDARD_PLAN } from "./shopify.server";
import { FREE_PLAN_REDIRECT_LIMIT } from "./plan";
import type { PlanId, PlanInfo } from "./plan";
import { addLogContext, logger } from "./logger.server";
import { shouldUseTestBilling } from "./billing.server";

export type { PlanId, PlanInfo };

type BillingSubscription = {
  id?: string;
  name?: string;
  test?: boolean;
  status?: string;
};

type PlanInfoOptions = {
  settleBillingApproval?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function standardSubscription(subscriptions: BillingSubscription[]) {
  return subscriptions.find((sub) => sub.name === STANDARD_PLAN);
}

async function resolveBillingSubscriptions(
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"],
  isTest: boolean,
) {
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
      source: "filtered",
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
    source: unfilteredStandard ? "unfiltered" : "filtered",
  };
}

async function resolvePlanSnapshot(request: Request) {
  const { admin, session, billing } = await authenticate.admin(request);
  addLogContext({ shop: session.shop });
  const isTest = await shouldUseTestBilling(admin, session.shop);
  const { appSubscriptions, activeSubscription, source } =
    await resolveBillingSubscriptions(billing, isTest);
  const isStandard = Boolean(activeSubscription);
  const plan: PlanId = isStandard ? "standard" : "free";

  const redirectsUsed = await prisma.cleanupRedirect.count({
    where: { shop: session.shop, shopifyRedirectId: { not: null } },
  });

  logger.info("billing.plan.resolved", {
    shop: session.shop,
    isTest,
    source,
    plan,
    subscriptions: appSubscriptions.map((sub) => ({
      id: sub.id ?? null,
      name: sub.name ?? null,
      test: sub.test ?? null,
      status: sub.status ?? null,
    })),
  });

  return {
    plan,
    redirectsUsed,
    redirectLimit: plan === "free" ? FREE_PLAN_REDIRECT_LIMIT : null,
    subscriptionId: activeSubscription?.id ?? null,
  };
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

  if (options.settleBillingApproval && isBillingReturn && snapshot.plan === "free") {
    const maxAttempts = 4;
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      await sleep(1500);
      attempts += 1;
      snapshot = await resolvePlanSnapshot(request);
      if (snapshot.plan === "standard") break;
    }
  }

  if (isBillingReturn) {
    logger.info("billing.approval_return.resolved", {
      chargeId,
      plan: snapshot.plan,
      status: snapshot.plan === "standard" ? "confirmed" : "pending",
      attempts,
      settled: Boolean(options.settleBillingApproval),
    });
  }

  return {
    ...snapshot,
    billingReturnStatus: !isBillingReturn
      ? "none"
      : snapshot.plan === "standard"
        ? "confirmed"
        : "pending",
    billingReturnChargeId: chargeId,
  };
}
