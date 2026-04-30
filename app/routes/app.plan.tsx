import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, STANDARD_PLAN } from "../shopify.server";
import { getPlanInfo } from "../plan.server";
import { FREE_PLAN_REDIRECT_LIMIT } from "../plan";
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
} from "@shopify/polaris";
import { useState } from "react";

// ─── Loader ───────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return getPlanInfo(request);
};

// ─── Action ───────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "subscribe") {
    try {
      // On success this throws a redirect Response — it never returns normally.
      await billing.request({
        plan: STANDARD_PLAN,
        isTest: true,
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app/plan`,
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

      console.error("[billing] subscribe error:", err);

      return {
        ok: false,
        billingUnavailable: isDev,
        message: isDev
          ? "Billing is not available on development stores. In production this will redirect to the Shopify payment page."
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
        isTest: true,
        prorate: true,
      });
    } catch (err) {
      if (err instanceof Response) throw err;
      console.error("[billing] cancel error:", err);
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
};

// ─── Plan cards ───────────────────────────────────────────────

type PlanCard = {
  id: "free" | "standard";
  name: string;
  price: string;
  period: string;
  recommended?: boolean;
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
    recommended: true,
    features: [
      "Unlimited redirects",
      "Priority support",
    ],
  },
];

// ─── Component ────────────────────────────────────────────────

export default function Plan() {
  const { plan, redirectsUsed, redirectLimit, subscriptionId } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [cancelOpen, setCancelOpen] = useState(false);

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

        <Banner tone={overLimit ? "warning" : "info"} title={bannerTitle}>
          {bannerBody}
        </Banner>

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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {PLANS.map((planCard) => {
            const isCurrent = planCard.id === plan;
            return (
              <div
                key={planCard.id}
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: planCard.recommended
                    ? "2px solid #303030"
                    : "1px solid var(--p-color-border-secondary, #ebebeb)",
                  padding: 20,
                  position: "relative",
                  boxShadow: planCard.recommended
                    ? "0 3px 6px -3px rgba(0,0,0,.04), 0 8px 20px -4px rgba(0,0,0,.05)"
                    : "0 1px 0 rgba(0,0,0,.05)",
                }}
              >
                {planCard.recommended && !isCurrent ? (
                  <div style={{ position: "absolute", top: -10, left: 16 }}>
                    <Badge tone="success">Most popular</Badge>
                  </div>
                ) : null}
                {isCurrent ? (
                  <div style={{ position: "absolute", top: -10, left: 16 }}>
                    <Badge>Current plan</Badge>
                  </div>
                ) : null}

                <BlockStack gap="300">
                  <Text variant="headingLg" as="h3">{planCard.name}</Text>

                  <InlineStack gap="100" blockAlign="baseline">
                    <Text variant="headingXl" as="p">{planCard.price}</Text>
                    <Text variant="bodyMd" tone="subdued" as="span">{planCard.period}</Text>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="150">
                    {planCard.features.map((feature) => (
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
                    ))}
                  </BlockStack>

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
                </BlockStack>
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
                Your subscription will be cancelled immediately with a prorated refund for the unused days.
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
