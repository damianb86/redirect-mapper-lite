import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, STANDARD_PLAN } from "../shopify.server";
import { getPlanInfo } from "../plan.server";
import { FREE_PLAN_REDIRECT_LIMIT } from "../plan";
import { shouldUseTestBilling } from "../billing.server";
import { addLogContext, logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  Divider,
  ProgressBar,
  Modal,
  Spinner,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

// ─── Loader ───────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return withRequestLogging(request, "app.plan.loader", () =>
    getPlanInfo(request, {
      settleBillingApproval:
        url.searchParams.get("billing") === "approved" &&
        !url.pathname.endsWith(".data"),
    }),
  );
};

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost || url.host}`;
}

function shopAdminHandle(shop: string) {
  return shop.replace(/\.myshopify\.com$/i, "");
}

function billingReturnUrl(request: Request, shop: string) {
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (apiKey) {
    const returnUrl = new URL(
      `https://admin.shopify.com/store/${shopAdminHandle(shop)}/apps/${apiKey}/app/plan`,
    );
    returnUrl.searchParams.set("billing", "approved");
    return returnUrl.toString();
  }

  const returnUrl = new URL("/app/plan", requestOrigin(request));
  returnUrl.searchParams.set("shop", shop);
  returnUrl.searchParams.set(
    "host",
    Buffer.from(`admin.shopify.com/store/${shopAdminHandle(shop)}`).toString("base64"),
  );
  returnUrl.searchParams.set("billing", "approved");
  return returnUrl.toString();
}

// ─── Action ───────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "app.plan.action", async () => {
    const { admin, billing, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "");
    const isTest = await shouldUseTestBilling(admin, session.shop);

  if (intent === "subscribe") {
    try {
      // On success this throws a redirect Response — it never returns normally.
      await billing.request({
        plan: STANDARD_PLAN,
        isTest,
        returnUrl: billingReturnUrl(request, session.shop),
      });
    } catch (err) {
      // Let redirect responses pass through (that's the success case).
      if (err instanceof Response) throw err;

      // Dev stores and partner test stores cannot be charged by Shopify.
      // Show a friendly message instead of crashing.
      const isDev =
        err instanceof Error &&
        (err.message.includes("billing") ||
          err.message.includes("cannot be charged") ||
          err.message.includes("Error while billing"));

      logger.error("billing.subscribe.failed", { error: logger.serializeError(err) });

      return {
        ok: false,
        billingUnavailable: isDev,
        message: isDev
          ? "Billing is not available on development stores. In production this will redirect to Shopify charge approval."
          : "Could not start the subscription. Please try again or contact support.",
      };
    }
  }

  if (intent === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    if (!subscriptionId) {
      return { ok: false, billingUnavailable: false, message: "No active subscription found." };
    }
    try {
      await billing.cancel({
        subscriptionId,
        isTest,
        prorate: true,
      });
    } catch (err) {
      if (err instanceof Response) throw err;
      logger.error("billing.cancel.failed", { error: logger.serializeError(err) });
      return {
        ok: false,
        billingUnavailable: false,
        message: "Could not cancel the subscription. Please try again or contact support.",
      };
    }
    return {
      ok: true,
      billingUnavailable: false,
      message: "Subscription cancelled. You are now on the Free plan.",
      shop: session.shop,
    };
  }

    return { ok: false, billingUnavailable: false, message: "Unknown intent." };
  });
};

// ─── Plan cards ───────────────────────────────────────────────

type PlanCard = {
  id: "free" | "standard";
  name: string;
  price: string;
  period: string;
  features: string[];
};

const PLANS: PlanCard[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    features: [
      `Up to ${FREE_PLAN_REDIRECT_LIMIT} redirects`,
      "Manual rules",
      "CSV export",
      "Cleanup history",
    ],
  },
  {
    id: "standard",
    name: "Standard",
    price: "$3.99",
    period: "/ month",
    features: [
      "Unlimited redirects",
      "Priority support",
    ],
  },
];

// ─── Component ────────────────────────────────────────────────

export default function Plan() {
  const {
    plan,
    redirectsUsed,
    redirectLimit,
    subscriptionId,
    billingReturnStatus,
    billingReturnChargeId,
  } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [billingApprovalRefreshDone, setBillingApprovalRefreshDone] = useState(false);
  const billingApproved =
    searchParams.get("billing") === "approved" && billingReturnStatus !== "none";
  const billingApprovalPending =
    billingApproved && billingReturnStatus === "pending" && plan === "free";

  const hasLimit = redirectLimit !== null;
  const usageProgress = hasLimit
    ? Math.min(100, Math.round((redirectsUsed / redirectLimit) * 100))
    : 0;
  const overLimit = hasLimit ? redirectsUsed >= redirectLimit : false;
  const usageLabel = hasLimit
    ? `${redirectsUsed} / ${redirectLimit} redirects`
    : `${redirectsUsed} redirects (unlimited)`;

  const bannerTitle =
    plan === "free" ? "You're on the Free plan" : "You're on the Standard plan";
  const bannerBody =
    plan === "free"
      ? overLimit
        ? `You've reached the ${redirectLimit}-redirect limit. Upgrade to Standard for unlimited redirects and priority support.`
        : `${redirectsUsed} of ${redirectLimit} redirects used. Upgrade to Standard for unlimited redirects and priority support.`
      : "Thanks for being on Standard. You have unlimited redirects and priority support.";

  const isSubmitting = fetcher.state !== "idle";
  const actionResult = fetcher.data;
  const featureRowCount = Math.max(...PLANS.map((planCard) => planCard.features.length));

  useEffect(() => {
    setBillingApprovalRefreshDone(false);
    if (!billingApproved || billingReturnStatus !== "pending" || plan === "standard") {
      return undefined;
    }

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      revalidator.revalidate();
      if (attempts >= 12) {
        setBillingApprovalRefreshDone(true);
        window.clearInterval(interval);
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [billingApproved, billingReturnStatus, plan, revalidator]);

  useEffect(() => {
    if (!billingApproved || billingReturnStatus !== "confirmed" || plan !== "standard") return;
    const next = new URLSearchParams(searchParams);
    next.set("billing", "confirmed");
    next.delete("charge_id");
    navigate(`?${next.toString()}`, { replace: true });
  }, [billingApproved, billingReturnStatus, navigate, plan, searchParams]);

  const subscribe = () => {
    const fd = new FormData();
    fd.set("intent", "subscribe");
    fetcher.submit(fd, { method: "post" });
  };

  const confirmCancel = () => {
    const fd = new FormData();
    fd.set("intent", "cancel");
    fd.set("subscriptionId", subscriptionId ?? "");
    fetcher.submit(fd, { method: "post" });
    setCancelOpen(false);
  };

  const retryBillingApprovalCheck = () => {
    setBillingApprovalRefreshDone(false);
    revalidator.revalidate();
  };

  return (
    <Page title="Plan">
      <BlockStack gap="400">
        {actionResult?.ok === false && fetcher.state === "idle" ? (
          <Banner
            tone={actionResult.billingUnavailable ? "warning" : "critical"}
            title={actionResult.billingUnavailable ? "Billing not available in dev stores" : "Something went wrong"}
          >
            {actionResult.message}
          </Banner>
        ) : null}

        {actionResult?.ok === true && fetcher.state === "idle" ? (
          <Banner tone="success">{actionResult.message}</Banner>
        ) : null}

        {billingApprovalPending ? (
          <div
            style={{
              background: billingApprovalRefreshDone
                ? "linear-gradient(135deg, #fff8e8 0%, #fffdf8 100%)"
                : "linear-gradient(135deg, #eefbf7 0%, #f7fffb 100%)",
              border: `1px solid ${
                billingApprovalRefreshDone ? "#f0c36d" : "#9acfc4"
              }`,
              borderLeft: `5px solid ${
                billingApprovalRefreshDone ? "#b98900" : "#1f7a68"
              }`,
              borderRadius: 14,
              boxShadow: "0 12px 28px rgba(18, 60, 50, 0.08)",
              padding: 22,
            }}
          >
            <InlineStack gap="400" blockAlign="start" wrap={false}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: billingApprovalRefreshDone ? "#fff0c2" : "#dff7ef",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {billingApprovalRefreshDone ? (
                  <Text as="span" variant="headingLg">
                    !
                  </Text>
                ) : (
                  <Spinner size="small" accessibilityLabel="Confirming Shopify billing approval" />
                )}
              </div>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">
                    {billingApprovalRefreshDone
                      ? "Shopify is still processing the subscription"
                      : "Confirming your Standard plan"}
                  </Text>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    {billingApprovalRefreshDone
                      ? "Shopify returned from the approval screen, but the active subscription is not available yet. This can happen briefly after approval."
                      : `Shopify returned from the approval screen${
                          billingReturnChargeId ? ` for charge ${billingReturnChargeId}` : ""
                        }. We are checking the active subscription before updating your plan.`}
                  </Text>
                </BlockStack>

                {billingApprovalRefreshDone ? (
                  <InlineStack gap="200">
                    <Button onClick={retryBillingApprovalCheck}>Check again</Button>
                  </InlineStack>
                ) : (
                  <BlockStack gap="150">
                    <ProgressBar progress={72} tone="primary" size="small" />
                    <Text variant="bodySm" tone="subdued" as="p">
                      Keep this page open while Shopify confirms the subscription.
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </InlineStack>
          </div>
        ) : null}

        {billingReturnStatus === "confirmed" && plan === "standard" ? (
          <Banner tone="success" title="Standard plan activated">
            Shopify confirmed the subscription and your app is now on Standard.
          </Banner>
        ) : null}

        {!billingApprovalPending ? (
          <Banner tone={overLimit ? "warning" : "info"} title={bannerTitle}>
            {bannerBody}
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">Redirect usage</Text>
              <Text variant="bodyMd" fontWeight="semibold" as="span">{usageLabel}</Text>
            </InlineStack>
            {hasLimit ? (
              <ProgressBar
                progress={usageProgress}
                tone={overLimit ? "critical" : "primary"}
                size="medium"
              />
            ) : null}
            <Text variant="bodySm" tone="subdued" as="p">
              Counted from active redirects saved in your store.
            </Text>
          </BlockStack>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
          {PLANS.map((planCard) => {
            const isCurrent = planCard.id === plan;
            const featureRows = [
              ...planCard.features,
              ...Array.from({ length: featureRowCount - planCard.features.length }, () => ""),
            ];
            return (
              <div
                key={planCard.id}
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid var(--p-color-border-secondary, #ebebeb)",
                  padding: 20,
                  position: "relative",
                  boxShadow: "0 1px 0 rgba(0,0,0,.05)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {isCurrent ? (
                  <div style={{ position: "absolute", top: -10, left: 16 }}>
                    <Badge>Current plan</Badge>
                  </div>
                ) : null}

                <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                  <BlockStack gap="300">
                    <Text variant="headingLg" as="h3">{planCard.name}</Text>

                    <InlineStack gap="100" blockAlign="baseline">
                      <Text variant="headingXl" as="p">{planCard.price}</Text>
                      <Text variant="bodyMd" tone="subdued" as="span">{planCard.period}</Text>
                    </InlineStack>

                    <Divider />
                  </BlockStack>

                  <div>
                    <BlockStack gap="150">
                    {featureRows.map((feature, index) => (
                      feature ? (
                        <InlineStack key={feature} gap="150" blockAlign="start" wrap={false}>
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 20 20"
                            fill="#0c5132"
                            style={{ flexShrink: 0, marginTop: 2 }}
                          >
                            <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" />
                          </svg>
                          <Text variant="bodyMd" as="span">{feature}</Text>
                        </InlineStack>
                      ) : (
                        <div key={`empty-feature-${index}`} aria-hidden="true" style={{ height: 22 }} />
                      )
                    ))}
                    </BlockStack>
                  </div>

                  <div style={{ marginTop: "auto" }}>
                    {isCurrent && planCard.id === "standard" ? (
                      <BlockStack gap="200">
                        <Button fullWidth variant="secondary" disabled>
                          Current plan
                        </Button>
                        <Button
                          fullWidth
                          variant="plain"
                          tone="critical"
                          disabled={isSubmitting || !subscriptionId}
                          onClick={() => setCancelOpen(true)}
                        >
                          Cancel subscription
                        </Button>
                      </BlockStack>
                    ) : isCurrent ? (
                      <Button fullWidth variant="secondary" disabled>
                        Current plan
                      </Button>
                    ) : planCard.id === "standard" ? (
                      <Button
                        fullWidth
                        variant="primary"
                        loading={isSubmitting}
                        onClick={subscribe}
                      >
                        Upgrade to Standard — $3.99/mo
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Cancel confirmation modal */}
        <Modal
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          title="Cancel Standard subscription?"
          primaryAction={{
            content: "Yes, cancel",
            destructive: true,
            loading: isSubmitting,
            onAction: confirmCancel,
          }}
          secondaryActions={[
            { content: "Keep subscription", onAction: () => setCancelOpen(false) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">
                Your subscription will be cancelled immediately with a prorated Shopify billing adjustment for the unused days.
              </Text>
              <Text variant="bodyMd" tone="subdued" as="p">
                Your account will revert to the Free plan (up to {FREE_PLAN_REDIRECT_LIMIT} redirects).
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
