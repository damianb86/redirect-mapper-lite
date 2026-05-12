// Server-only: DB queries + billing resolution. Never imported by client bundles.
import prisma from "./db.server";
import { authenticate, STANDARD_PLAN } from "./shopify.server";
import { FREE_PLAN_REDIRECT_LIMIT } from "./plan";
import type { PlanId, PlanInfo } from "./plan";
import { addLogContext, logger } from "./logger.server";
import { shouldUseTestBilling } from "./billing.server";

export type { PlanId, PlanInfo };

export async function getPlanInfo(request: Request): Promise<PlanInfo> {
  const { admin, session, billing } = await authenticate.admin(request);
  addLogContext({ shop: session.shop });
  const isTest = await shouldUseTestBilling(admin, session.shop);

  const { appSubscriptions } = await billing.check({
    plans: [STANDARD_PLAN],
    isTest,
  });

  const isStandard = appSubscriptions.some(
    (sub: { name: string }) => sub.name === STANDARD_PLAN,
  );
  const plan: PlanId = isStandard ? "standard" : "free";

  const activeSubscription = isStandard
    ? appSubscriptions.find((sub: { name: string }) => sub.name === STANDARD_PLAN)
    : undefined;

  const redirectsUsed = await prisma.cleanupRedirect.count({
    where: { shop: session.shop, shopifyRedirectId: { not: null } },
  });

  logger.info("billing.plan.resolved", {
    shop: session.shop,
    isTest,
    plan,
    subscriptions: appSubscriptions.map((sub: { id?: string; name?: string; test?: boolean; status?: string }) => ({
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
    subscriptionId: (activeSubscription as { id?: string } | undefined)?.id ?? null,
  };
}
