// Server-only: DB queries + billing resolution. Never imported by client bundles.
import prisma from "./db.server";
import { authenticate, STANDARD_PLAN } from "./shopify.server";
import { FREE_PLAN_REDIRECT_LIMIT } from "./plan";
import type { PlanId, PlanInfo } from "./plan";

export type { PlanId, PlanInfo };

export async function getPlanInfo(request: Request): Promise<PlanInfo> {
  const { session, billing } = await authenticate.admin(request);

  const { appSubscriptions } = await billing.check({
    plans: [STANDARD_PLAN],
    isTest: true,
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

  return {
    plan,
    redirectsUsed,
    redirectLimit: plan === "free" ? FREE_PLAN_REDIRECT_LIMIT : null,
    subscriptionId: (activeSubscription as { id?: string } | undefined)?.id ?? null,
  };
}
