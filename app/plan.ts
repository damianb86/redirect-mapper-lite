// Shared plan constants and types — safe to import from client code.

export const FREE_PLAN_REDIRECT_LIMIT = 100;
export const MAX_PRODUCTS_PER_CLEANUP_RUN = 100;

export type PlanId = "free" | "standard";

export type PlanInfo = {
  plan: PlanId;
  redirectsUsed: number;
  redirectLimit: number | null;
  subscriptionId: string | null;
  billingAccessUntil: string | null;
  billingSource: "shopify" | "entitlement" | "free";
  billingSubscriptionStatus: string | null;
  reactivationTrialDays: number;
  billingReturnStatus: "none" | "confirmed" | "pending";
  billingReturnChargeId: string | null;
};
