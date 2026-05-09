import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { addLogContext } from "../logger.server";
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
  Tabs,
  TextField,
  Select,
  Divider,
  Thumbnail,
  EmptyState,
  Modal,
  Checkbox,
  ProgressBar,
  Tooltip,
  Icon,
} from "@shopify/polaris";
import {
  ClipboardChecklistIcon,
  DeleteIcon,
  DomainRedirectIcon,
  ExportIcon,
  InfoIcon,
  PlusCircleIcon,
  ProductIcon,
  SearchListIcon,
  StatusActiveIcon,
  UndoIcon,
  ViewIcon,
} from "@shopify/polaris-icons";

type CleanupStatus = "ACTIVE" | "PARTIAL" | "FAILED" | "ROLLED_BACK" | "PARTIAL_ROLLBACK";
type RedirectStatus = "ACTIVE" | "FAILED" | "ROLLED_BACK" | "ROLLBACK_FAILED";

const URL_REDIRECT_DELETE = `#graphql
  mutation UrlRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors {
        field
        message
      }
    }
  }
` as string;

const PRODUCT_REACTIVATE = `#graphql
  mutation ProductReactivate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
` as string;

function userErrorMessage(
  errors: { field?: string[] | null; message: string }[] | undefined,
) {
  return errors?.map((error) => error.message).join("; ") || null;
}

function modeLabel(mode: string) {
  if (mode === "redirects") return "Redirect only";
  if (mode === "archive") return "Archive + redirect";
  if (mode === "delete") return "Delete + redirect";
  return mode;
}

function cleanupStatusLabel(status: string) {
  if (status === "ACTIVE") return "Active";
  if (status === "PARTIAL") return "Partially applied";
  if (status === "FAILED") return "Failed";
  if (status === "ROLLED_BACK") return "Rolled back";
  if (status === "PARTIAL_ROLLBACK") return "Partially rolled back";
  return status;
}

function redirectStatusLabel(status: string) {
  if (status === "ACTIVE") return "Active";
  if (status === "FAILED") return "Failed";
  if (status === "ROLLED_BACK") return "Rolled back";
  if (status === "ROLLBACK_FAILED") return "Rollback failed";
  return status;
}

function statusTone(status: string) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "ROLLED_BACK") return "info" as const;
  if (status === "PARTIAL" || status === "PARTIAL_ROLLBACK") return "warning" as const;
  if (status === "FAILED" || status === "ROLLBACK_FAILED") return "critical" as const;
  return undefined;
}

function confidenceTone(confidence?: string | null) {
  if (confidence === "High") return "success" as const;
  if (confidence === "Medium") return "info" as const;
  if (confidence === "Low") return "warning" as const;
  return undefined;
}

function formatWhen(value: string) {
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (isToday) return `Today, ${time}`;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function inTimeWindow(value: string, window: string) {
  if (window === "all") return true;
  const days = Number(window.replace("d", ""));
  if (!Number.isFinite(days)) return true;
  const createdAt = new Date(value).getTime();
  return Date.now() - createdAt <= days * 24 * 60 * 60 * 1000;
}

function csvEscape(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(
  rows: {
    productName: string;
    sourcePath: string;
    targetPath: string;
    ruleLabel?: string | null;
    confidence?: string | null;
    status: string;
  }[],
  filename: string,
) {
  const header = ["Product", "Source", "Target", "Rule", "Confidence", "Status"];
  const csv = [
    header.map(csvEscape).join(","),
    ...rows.map((row) =>
      [
        row.productName,
        row.sourcePath,
        row.targetPath,
        row.ruleLabel,
        row.confidence,
        redirectStatusLabel(row.status),
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "app.history.loader", async () => {
    const { session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const shop = session.shop;

  const [cleanups, redirects, activeRedirects, rolledBackRedirects, failedRedirects] =
    await Promise.all([
      prisma.cleanupRun.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        include: {
          redirects: {
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      prisma.cleanupRedirect.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        include: {
          cleanup: {
            select: {
              id: true,
              mode: true,
              createdAt: true,
              actorName: true,
            },
          },
        },
      }),
      prisma.cleanupRedirect.count({ where: { shop, status: "ACTIVE" } }),
      prisma.cleanupRedirect.count({ where: { shop, status: "ROLLED_BACK" } }),
      prisma.cleanupRedirect.count({ where: { shop, status: { in: ["FAILED", "ROLLBACK_FAILED"] } } }),
    ]);

    return {
    shop,
    stats: {
      cleanups: cleanups.length,
      activeRedirects,
      rolledBackRedirects,
      failedRedirects,
    },
    cleanups: cleanups.map((cleanup) => ({
      ...cleanup,
      status: cleanup.status as CleanupStatus,
      createdAt: cleanup.createdAt.toISOString(),
      completedAt: cleanup.completedAt?.toISOString() ?? null,
      rolledBackAt: cleanup.rolledBackAt?.toISOString() ?? null,
      redirects: cleanup.redirects.map((redirect) => ({
        ...redirect,
        status: redirect.status as RedirectStatus,
        createdAt: redirect.createdAt.toISOString(),
        rolledBackAt: redirect.rolledBackAt?.toISOString() ?? null,
      })),
    })),
    redirects: redirects.map((redirect) => ({
      ...redirect,
      status: redirect.status as RedirectStatus,
      createdAt: redirect.createdAt.toISOString(),
      rolledBackAt: redirect.rolledBackAt?.toISOString() ?? null,
      cleanup: {
        ...redirect.cleanup,
        createdAt: redirect.cleanup.createdAt.toISOString(),
      },
    })),
    };
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "app.history.action", async () => {
    const { admin, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const formData = await request.formData();
    const intent = formData.get("intent");
    const now = new Date();

  const deleteRedirect = async (shopifyRedirectId: string) => {
    const response = await admin.graphql(URL_REDIRECT_DELETE, {
      variables: { id: shopifyRedirectId },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;
    const message = userErrorMessage(json.data?.urlRedirectDelete?.userErrors);
    return {
      ok: !message,
      message: message ?? undefined,
    };
  };

  const reactivateProduct = async (productId: string) => {
    try {
      const response = await admin.graphql(PRODUCT_REACTIVATE, {
        variables: { product: { id: productId, status: "ACTIVE" } },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await response.json()) as any;
      const message = userErrorMessage(json.data?.productUpdate?.userErrors);
      return { ok: !message, message: message ?? undefined };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Product reactivate failed.",
      };
    }
  };

  const reactivateProducts = async (productIds: string[]) => {
    let reactivated = 0;
    let failed = 0;
    for (const productId of Array.from(new Set(productIds))) {
      const result = await reactivateProduct(productId);
      if (result.ok) reactivated += 1;
      else failed += 1;
    }
    return { reactivated, failed };
  };

  if (intent === "delete-cleanup") {
    const cleanupId = String(formData.get("cleanupId") ?? "");
    const cleanup = await prisma.cleanupRun.findFirst({
      where: { id: cleanupId, shop: session.shop },
      select: { id: true, redirectsCreated: true },
    });

    if (!cleanup) {
      return {
        action: "delete-cleanup" as const,
        ok: false,
        message: "Cleanup record not found.",
        rolledBack: 0,
        failed: 0,
        failedDetails: [],
      };
    }

    await prisma.cleanupRun.delete({ where: { id: cleanup.id } });

    return {
      action: "delete-cleanup" as const,
      ok: true,
      message: `Cleanup record deleted. ${cleanup.redirectsCreated} stored redirect rows were removed from history.`,
      rolledBack: 0,
      failed: 0,
      failedDetails: [],
    };
  }

  if (intent === "rollback-cleanup") {
    const cleanupId = String(formData.get("cleanupId") ?? "");
    const shouldReactivate = formData.get("reactivateProducts") === "1";
    const cleanup = await prisma.cleanupRun.findFirst({
      where: { id: cleanupId, shop: session.shop },
      include: {
        redirects: {
          where: { status: "ACTIVE" },
        },
      },
    });

    if (!cleanup) {
      return { action: "rollback" as const, ok: false, message: "Cleanup not found.", rolledBack: 0, failed: 0, failedDetails: [] };
    }

    let rolledBack = 0;
    let failed = 0;
    const reactivatableProductIds: string[] = [];
    const failedDetails: { product: string; source: string; shopifyId: string | null; reason: string }[] = [];

    for (const redirect of cleanup.redirects) {
      if (!redirect.shopifyRedirectId) {
        failed += 1;
        const reason = "Missing Shopify redirect ID — the redirect may have been deleted manually in Shopify.";
        failedDetails.push({ product: redirect.productName, source: redirect.sourcePath, shopifyId: null, reason });
        await prisma.cleanupRedirect.update({
          where: { id: redirect.id },
          data: { status: "ROLLBACK_FAILED", errorMessage: reason },
        });
        continue;
      }

      try {
        const result = await deleteRedirect(redirect.shopifyRedirectId);
        if (result.ok) {
          rolledBack += 1;
          if (redirect.productId) reactivatableProductIds.push(redirect.productId);
          await prisma.cleanupRedirect.update({
            where: { id: redirect.id },
            data: { status: "ROLLED_BACK", rolledBackAt: now, errorMessage: null },
          });
        } else {
          failed += 1;
          const reason = result.message ?? "Shopify urlRedirectDelete returned an error.";
          failedDetails.push({ product: redirect.productName, source: redirect.sourcePath, shopifyId: redirect.shopifyRedirectId, reason });
          await prisma.cleanupRedirect.update({
            where: { id: redirect.id },
            data: { status: "ROLLBACK_FAILED", errorMessage: reason },
          });
        }
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error
          ? `${error.name}: ${error.message}`
          : "Unknown exception during Shopify API call.";
        failedDetails.push({ product: redirect.productName, source: redirect.sourcePath, shopifyId: redirect.shopifyRedirectId, reason });
        await prisma.cleanupRedirect.update({
          where: { id: redirect.id },
          data: { status: "ROLLBACK_FAILED", errorMessage: reason },
        });
      }
    }

    const activeRemaining = await prisma.cleanupRedirect.count({
      where: { cleanupId, shop: session.shop, status: "ACTIVE" },
    });
    await prisma.cleanupRun.update({
      where: { id: cleanupId },
      data: {
        status: activeRemaining === 0 ? "ROLLED_BACK" : "PARTIAL_ROLLBACK",
        rolledBackAt: activeRemaining === 0 ? now : undefined,
      },
    });

    let reactivated = 0;
    let reactivateFailed = 0;
    if (shouldReactivate && cleanup.mode === "archive" && reactivatableProductIds.length) {
      const result = await reactivateProducts(reactivatableProductIds);
      reactivated = result.reactivated;
      reactivateFailed = result.failed;
    }

    const messages = [
      failed === 0
        ? `${rolledBack} redirects rolled back.`
        : `${rolledBack} redirects rolled back. ${failed} failed.`,
    ];
    if (shouldReactivate && cleanup.mode === "archive") {
      messages.push(
        reactivateFailed === 0
          ? `${reactivated} products reactivated.`
          : `${reactivated} products reactivated. ${reactivateFailed} failed.`,
      );
    }

    return {
      action: "rollback" as const,
      ok: failed === 0 && reactivateFailed === 0,
      message: messages.join(" "),
      rolledBack,
      failed,
      failedDetails,
    };
  }

  if (intent === "rollback-redirect") {
    const redirectId = String(formData.get("redirectId") ?? "");
    const shouldReactivate = formData.get("reactivateProducts") === "1";
    const redirect = await prisma.cleanupRedirect.findFirst({
      where: { id: redirectId, shop: session.shop },
      include: { cleanup: { select: { mode: true } } },
    });

    if (!redirect) {
      return { action: "rollback" as const, ok: false, message: "Redirect not found.", rolledBack: 0, failed: 0, failedDetails: [] };
    }

    if (!redirect.shopifyRedirectId) {
      const reason = "Missing Shopify redirect ID — the redirect may have been deleted manually in Shopify.";
      await prisma.cleanupRedirect.update({
        where: { id: redirect.id },
        data: { status: "ROLLBACK_FAILED", errorMessage: reason },
      });
      return { action: "rollback" as const, ok: false, message: reason, rolledBack: 0, failed: 1, failedDetails: [] };
    }

    const result = await deleteRedirect(redirect.shopifyRedirectId);
    const errorReason = result.ok
      ? null
      : (result.message ?? "Shopify urlRedirectDelete returned an error without a message.");

    await prisma.cleanupRedirect.update({
      where: { id: redirect.id },
      data: result.ok
        ? { status: "ROLLED_BACK", rolledBackAt: now, errorMessage: null }
        : { status: "ROLLBACK_FAILED", errorMessage: errorReason },
    });

    const activeRemaining = await prisma.cleanupRedirect.count({
      where: { cleanupId: redirect.cleanupId, shop: session.shop, status: "ACTIVE" },
    });
    await prisma.cleanupRun.update({
      where: { id: redirect.cleanupId },
      data: {
        status: activeRemaining === 0 ? "ROLLED_BACK" : "PARTIAL_ROLLBACK",
        rolledBackAt: activeRemaining === 0 ? now : undefined,
      },
    });

    let reactivateMessage = "";
    let reactivateOk = true;
    if (
      shouldReactivate &&
      result.ok &&
      redirect.productId &&
      redirect.cleanup?.mode === "archive"
    ) {
      const reactivateResult = await reactivateProduct(redirect.productId);
      reactivateOk = reactivateResult.ok;
      reactivateMessage = reactivateResult.ok
        ? " Product reactivated."
        : ` Product reactivate failed: ${reactivateResult.message ?? "unknown error"}.`;
    }

    return {
      action: "rollback" as const,
      ok: result.ok && reactivateOk,
      message:
        (result.ok ? "Redirect rolled back." : (errorReason ?? "Rollback failed.")) +
        reactivateMessage,
      rolledBack: result.ok ? 1 : 0,
      failed: result.ok ? 0 : 1,
      failedDetails: result.ok ? [] : [{
        product: redirect.productName,
        source: redirect.sourcePath,
        shopifyId: redirect.shopifyRedirectId,
        reason: errorReason ?? "Unknown error.",
      }],
    };
  }

    return { action: "unsupported" as const, ok: false, message: "Unsupported history action.", rolledBack: 0, failed: 0, failedDetails: [] };
  });
};

export default function History() {
  const navigate = useNavigate();
  const rollbackFetcher = useFetcher<typeof action>();
  const { cleanups, redirects, stats } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [rollbackTarget, setRollbackTarget] = useState<
    | { type: "cleanup"; id: string; label: string; mode: string }
    | { type: "redirect"; id: string; label: string; mode: string }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    label: string;
    redirects: number;
    activeRedirects: number;
  } | null>(null);
  const [reactivateProducts, setReactivateProducts] = useState(false);

  const selectedCleanupId = searchParams.get("cleanup");
  const selectedCleanup = cleanups.find((cleanup) => cleanup.id === selectedCleanupId) ?? null;
  const pendingIntent = rollbackFetcher.formData?.get("intent");
  const isDeletingCleanup =
    rollbackFetcher.state !== "idle" && pendingIntent === "delete-cleanup";
  const isRollingBack =
    rollbackFetcher.state !== "idle" && pendingIntent !== "delete-cleanup";
  const isHistoryActionRunning = rollbackFetcher.state !== "idle";

  const tabs = [
    { id: "cleanups", content: "Cleanups" },
    { id: "redirects", content: "All redirects" },
  ];

  const timeOptions = [
    { label: "All time", value: "all" },
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Last 90 days", value: "90d" },
  ];

  const statusOptions = [
    { label: "All statuses", value: "all" },
    { label: "Active", value: "ACTIVE" },
    { label: "Partially applied", value: "PARTIAL" },
    { label: "Rolled back", value: "ROLLED_BACK" },
    { label: "Failed", value: "FAILED" },
  ];

  const actorOptions = [
    { label: "All users", value: "all" },
    ...Array.from(new Set(cleanups.map((cleanup) => cleanup.actorName).filter(Boolean))).map(
      (actor) => ({
        label: String(actor),
        value: String(actor),
      }),
    ),
  ];

  const query = searchValue.trim().toLowerCase();
  const cleanupMatchesQuery = (cleanup: (typeof cleanups)[number]) => {
    if (!query) return true;
    return [
      cleanup.id,
      modeLabel(cleanup.mode),
      cleanup.actorName ?? "",
      cleanup.redirects.map((redirect) => redirect.productName).join(" "),
      cleanup.redirects.map((redirect) => `${redirect.sourcePath} ${redirect.targetPath}`).join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  };

  const redirectMatchesQuery = (redirect: (typeof redirects)[number]) => {
    if (!query) return true;
    return [
      redirect.productName,
      redirect.sourcePath,
      redirect.targetPath,
      redirect.ruleLabel ?? "",
      redirect.cleanup.id,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  };

  const filteredCleanups = cleanups.filter((cleanup) => {
    const statusMatches = statusFilter === "all" || cleanup.status === statusFilter;
    const actorMatches = actorFilter === "all" || cleanup.actorName === actorFilter;
    return (
      inTimeWindow(cleanup.createdAt, timeFilter) &&
      statusMatches &&
      actorMatches &&
      cleanupMatchesQuery(cleanup)
    );
  });

  const filteredRedirects = redirects.filter((redirect) => {
    const statusMatches = statusFilter === "all" || redirect.status === statusFilter;
    const actorMatches = actorFilter === "all" || redirect.cleanup.actorName === actorFilter;
    return (
      inTimeWindow(redirect.createdAt, timeFilter) &&
      statusMatches &&
      actorMatches &&
      redirectMatchesQuery(redirect)
    );
  });

  const shownRedirectRows = filteredRedirects;
  const hasActiveSelectedCleanupRedirects =
    selectedCleanup?.redirects.some((redirect) => redirect.status === "ACTIVE") ?? false;

  const resetFilters = () => {
    setSearchValue("");
    setTimeFilter("all");
    setStatusFilter("all");
    setActorFilter("all");
  };

  const viewCleanup = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("cleanup", id);
    setSearchParams(next);
    window.setTimeout(() => {
      document
        .getElementById("cleanup-details-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const confirmRollback = () => {
    if (!rollbackTarget) return;
    const formData = new FormData();
    formData.set(
      "intent",
      rollbackTarget.type === "cleanup" ? "rollback-cleanup" : "rollback-redirect",
    );
    formData.set(rollbackTarget.type === "cleanup" ? "cleanupId" : "redirectId", rollbackTarget.id);
    if (reactivateProducts && rollbackTarget.mode === "archive") {
      formData.set("reactivateProducts", "1");
    }
    rollbackFetcher.submit(formData, { method: "post" });
    setRollbackTarget(null);
    setReactivateProducts(false);
  };

  const closeRollbackModal = () => {
    setRollbackTarget(null);
    setReactivateProducts(false);
  };

  const confirmDeleteCleanup = () => {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.set("intent", "delete-cleanup");
    formData.set("cleanupId", deleteTarget.id);
    rollbackFetcher.submit(formData, { method: "post" });
    if (deleteTarget.id === selectedCleanupId) {
      const next = new URLSearchParams(searchParams);
      next.delete("cleanup");
      setSearchParams(next);
    }
    setDeleteTarget(null);
  };

  const closeDeleteModal = () => setDeleteTarget(null);

  const statCards = [
    {
      n: String(stats.cleanups),
      label: "Cleanups saved",
      icon: ClipboardChecklistIcon,
      accent: "#0f7c8f",
      soft: "#e5f7fa",
    },
    {
      n: String(stats.activeRedirects),
      label: "Redirects active",
      icon: DomainRedirectIcon,
      accent: "#0f6f5c",
      soft: "#e8f6f1",
      tone: "success" as const,
    },
    {
      n: String(stats.rolledBackRedirects),
      label: "Redirects rolled back",
      icon: UndoIcon,
      accent: "#c38727",
      soft: "#fff3df",
    },
  ];

  const filtersActive =
    searchValue || timeFilter !== "all" || statusFilter !== "all" || actorFilter !== "all";

  return (
    <Page
      title="Cleanup history"
      subtitle="Every applied cleanup and redirect saved from Shopify"
      primaryAction={{
        content: "New cleanup",
        icon: PlusCircleIcon,
        onAction: () => navigate("/app"),
      }}
      secondaryActions={[
        {
          content: "Export shown redirects",
          icon: ExportIcon,
          disabled: shownRedirectRows.length === 0,
          onAction: () => downloadCsv(shownRedirectRows, "cleanup-history-redirects.csv"),
        },
      ]}
    >
      <BlockStack gap="400">
        {isRollingBack ? (
          <Banner tone="info" title="Rollback in progress">
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">
                Deleting Shopify redirects{reactivateProducts ? " and reactivating products" : ""}. This can take a moment.
              </Text>
              <ProgressBar progress={65} tone="primary" size="small" />
            </BlockStack>
          </Banner>
        ) : null}

        {rollbackFetcher.data?.message ? (
          <Banner
            tone={rollbackFetcher.data.ok ? "success" : "critical"}
            title={
              rollbackFetcher.data.action === "delete-cleanup"
                ? rollbackFetcher.data.ok
                  ? "Cleanup record deleted"
                  : "Could not delete cleanup"
                : rollbackFetcher.data.ok
                  ? "Rollback complete"
                  : "Rollback failed"
            }
          >
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">{rollbackFetcher.data.message}</Text>
              {!rollbackFetcher.data.ok && rollbackFetcher.data.failedDetails?.length ? (
                <BlockStack gap="100">
                  {rollbackFetcher.data.failedDetails.map((detail, i) => (
                    <div
                      key={i}
                      style={{
                        background: "rgba(0,0,0,.04)",
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        fontSize: 12,
                        lineHeight: 1.6,
                      }}
                    >
                      <div><strong>Product:</strong> {detail.product}</div>
                      <div><strong>Source:</strong> {detail.source}</div>
                      {detail.shopifyId ? (
                        <div><strong>Shopify ID:</strong> {detail.shopifyId}</div>
                      ) : null}
                      <div><strong>Reason:</strong> {detail.reason}</div>
                    </div>
                  ))}
                </BlockStack>
              ) : null}
            </BlockStack>
          </Banner>
        ) : null}

        <div className="rml-history-stat-grid">
          {statCards.map((stat) => (
            <div
              className="rml-history-stat-card"
              key={stat.label}
              style={{
                "--rml-history-accent": stat.accent,
                "--rml-history-soft": stat.soft,
              } as CSSProperties}
            >
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <span className="rml-history-stat-icon" aria-hidden="true">
                  <Icon source={stat.icon} />
                </span>
                <BlockStack gap="050">
                  <Text variant="headingXl" tone={stat.tone} as="p">{stat.n}</Text>
                  <Text variant="bodySm" tone="subdued" as="p">{stat.label}</Text>
                </BlockStack>
              </InlineStack>
            </div>
          ))}
        </div>

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--p-color-border-secondary, #ebebeb)" }}>
              <InlineStack gap="200" blockAlign="center">
                <div style={{ flex: 1, minWidth: 240 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    placeholder="Search by product, URL, cleanup ID, or rule"
                    value={searchValue}
                    onChange={setSearchValue}
                    autoComplete="off"
                  />
                </div>
                <Select
                  label="Time"
                  labelHidden
                  options={timeOptions}
                  value={timeFilter}
                  onChange={setTimeFilter}
                />
                <Select
                  label="Status"
                  labelHidden
                  options={statusOptions}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
                <Select
                  label="User"
                  labelHidden
                  options={actorOptions}
                  value={actorFilter}
                  onChange={setActorFilter}
                />
                <Button disabled={!filtersActive} onClick={resetFilters}>
                  Reset
                </Button>
              </InlineStack>
            </div>

            {selectedTab === 0 ? (
              <CleanupsTable
                cleanups={filteredCleanups}
                selectedCleanupId={selectedCleanupId}
                isBusy={isHistoryActionRunning}
                onView={viewCleanup}
                onRollback={(cleanup) =>
                  setRollbackTarget({
                    type: "cleanup",
                    id: cleanup.id,
                    label: `cleanup ${cleanup.id.slice(0, 8)}`,
                    mode: cleanup.mode,
                  })
                }
                onDelete={(cleanup) =>
                  setDeleteTarget({
                    id: cleanup.id,
                    label: `cleanup ${cleanup.id.slice(0, 8)}`,
                    redirects: cleanup.redirects.length,
                    activeRedirects: cleanup.redirects.filter(
                      (redirect) => redirect.status === "ACTIVE",
                    ).length,
                  })
                }
              />
            ) : (
              <RedirectsTable
                redirects={shownRedirectRows}
                isRollingBack={isRollingBack}
                onRollback={(redirect) =>
                  setRollbackTarget({
                    type: "redirect",
                    id: redirect.id,
                    label: redirect.sourcePath,
                    mode: redirect.cleanup.mode,
                  })
                }
              />
            )}
          </Tabs>
        </Card>

        {selectedTab === 0 && selectedCleanup ? (
          <div className="rml-cleanup-detail-panel" id="cleanup-details-panel">
            <CleanupDetails
              cleanup={selectedCleanup}
              hasActiveRedirects={hasActiveSelectedCleanupRedirects}
              isRollingBack={isRollingBack}
              onRollbackCleanup={() =>
                setRollbackTarget({
                  type: "cleanup",
                  id: selectedCleanup.id,
                  label: `cleanup ${selectedCleanup.id.slice(0, 8)}`,
                  mode: selectedCleanup.mode,
                })
              }
              onRollbackRedirect={(redirect) =>
                setRollbackTarget({
                  type: "redirect",
                  id: redirect.id,
                  label: redirect.sourcePath,
                  mode: selectedCleanup.mode,
                })
              }
            />
          </div>
        ) : null}

        <Modal
          open={Boolean(rollbackTarget)}
          onClose={closeRollbackModal}
          title="Roll back redirects?"
          primaryAction={{
            content: "Roll back",
            destructive: true,
            loading: isRollingBack,
            onAction: confirmRollback,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: closeRollbackModal,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text variant="bodyMd" as="p">
                This will delete the Shopify redirect records for {rollbackTarget?.label}.
              </Text>
              {rollbackTarget?.mode === "archive" ? (
                <BlockStack gap="150">
                  <Text variant="bodyMd" as="p">
                    Do you also want to reactivate the archived products affected by this rollback?
                  </Text>
                  <Checkbox
                    label="Reactivate products too"
                    helpText="Sets affected products back to Active in Shopify."
                    checked={reactivateProducts}
                    onChange={setReactivateProducts}
                  />
                </BlockStack>
              ) : rollbackTarget?.mode === "delete" ? (
                <Text variant="bodyMd" tone="subdued" as="p">
                  Deleted products cannot be automatically restored.
                </Text>
              ) : null}
            </BlockStack>
          </Modal.Section>
        </Modal>

        <Modal
          open={Boolean(deleteTarget)}
          onClose={closeDeleteModal}
          title="Delete cleanup record?"
          primaryAction={{
            content: "Delete record",
            destructive: true,
            loading: isDeletingCleanup,
            onAction: confirmDeleteCleanup,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: closeDeleteModal,
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text variant="bodyMd" as="p">
                This deletes the saved history record for {deleteTarget?.label} and
                its stored redirect rows from Redirect Mapper Lite.
              </Text>
              {deleteTarget?.activeRedirects ? (
                <Banner tone="warning" title="Shopify redirects will stay active">
                  This removes the local record only. Roll back the cleanup first if
                  you also want to delete the live Shopify redirect records.
                </Banner>
              ) : null}
              <Text variant="bodySm" tone="subdued" as="p">
                Stored redirect rows to delete: {deleteTarget?.redirects ?? 0}.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

function CleanupsTable({
  cleanups,
  selectedCleanupId,
  isBusy,
  onView,
  onRollback,
  onDelete,
}: {
  cleanups: ReturnType<typeof useLoaderData<typeof loader>>["cleanups"];
  selectedCleanupId: string | null;
  isBusy: boolean;
  onView(id: string): void;
  onRollback(cleanup: ReturnType<typeof useLoaderData<typeof loader>>["cleanups"][number]): void;
  onDelete(cleanup: ReturnType<typeof useLoaderData<typeof loader>>["cleanups"][number]): void;
}) {
  if (!cleanups.length) {
    return (
      <EmptyState
        heading="No cleanups found"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>Try a different filter or apply a cleanup first.</p>
      </EmptyState>
    );
  }

  return (
    <>
      <div style={{
        display: "grid",
        gridTemplateColumns: "96px 1.2fr 1.2fr 1fr 132px",
        padding: "10px 12px",
        borderBottom: "1px solid var(--p-color-border-secondary, #ebebeb)",
        background: "var(--p-color-bg-surface-secondary, #fafafa)",
        gap: 8,
        alignItems: "center",
      }}>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">ID</Text>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">When</Text>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">Cleanup</Text>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">Status</Text>
        <span />
      </div>
      {cleanups.map((cleanup, index) => {
        const activeRedirects = cleanup.redirects.filter((redirect) => redirect.status === "ACTIVE").length;
        const selected = cleanup.id === selectedCleanupId;
        return (
          <div
            key={cleanup.id}
            className={`rml-cleanup-row${selected ? " rml-cleanup-row--selected" : ""}`}
            style={{
              borderBottom: index < cleanups.length - 1 ? "1px solid var(--p-color-border-secondary, #ebebeb)" : "none",
            }}
          >
            <Text variant="bodyMd" fontWeight="semibold" tone="subdued" as="span">
              #{cleanup.id.slice(0, 8)}
            </Text>
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="semibold" as="span">{formatWhen(cleanup.createdAt)}</Text>
              <Text variant="bodySm" tone="subdued" as="span">{cleanup.actorName ?? "Store staff"}</Text>
            </BlockStack>
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                {cleanup.redirectsCreated} redirects
              </Text>
              <Text variant="bodySm" tone="subdued" as="span">{modeLabel(cleanup.mode)}</Text>
            </BlockStack>
            <InlineStack gap="100" blockAlign="center">
              <span className="rml-history-status-badge">
                <Badge tone={statusTone(cleanup.status)}>{cleanupStatusLabel(cleanup.status)}</Badge>
              </span>
              {cleanup.lowConfidence ? <Badge tone="warning">{`${cleanup.lowConfidence} low`}</Badge> : null}
            </InlineStack>
            <InlineStack gap="150" align="end" wrap={false}>
              <Tooltip content="View cleanup details">
                <span className="rml-history-action rml-history-action--view">
                  <Button
                    icon={ViewIcon}
                    size="slim"
                    pressed={selected}
                    accessibilityLabel="View cleanup details"
                    onClick={() => onView(cleanup.id)}
                  />
                </span>
              </Tooltip>
              <Tooltip content="Roll back active Shopify redirects">
                <span className="rml-history-action rml-history-action--rollback">
                  <Button
                    icon={UndoIcon}
                    size="slim"
                    variant="secondary"
                    disabled={activeRedirects === 0 || isBusy}
                    accessibilityLabel="Roll back active Shopify redirects"
                    onClick={() => onRollback(cleanup)}
                  />
                </span>
              </Tooltip>
              <Tooltip content="Delete cleanup record">
                <span className="rml-history-action rml-history-action--delete">
                  <Button
                    icon={DeleteIcon}
                    size="slim"
                    tone="critical"
                    variant="secondary"
                    disabled={isBusy}
                    accessibilityLabel="Delete cleanup record"
                    onClick={() => onDelete(cleanup)}
                  />
                </span>
              </Tooltip>
            </InlineStack>
          </div>
        );
      })}
    </>
  );
}

function RedirectsTable({
  redirects,
  isRollingBack,
  onRollback,
}: {
  redirects: ReturnType<typeof useLoaderData<typeof loader>>["redirects"];
  isRollingBack: boolean;
  onRollback(redirect: ReturnType<typeof useLoaderData<typeof loader>>["redirects"][number]): void;
}) {
  if (!redirects.length) {
    return (
      <EmptyState
        heading="No redirects found"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>Try a different filter or apply a cleanup first.</p>
      </EmptyState>
    );
  }

  return (
    <>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1.2fr 1.2fr 110px 150px",
        padding: "10px 12px",
        borderBottom: "1px solid var(--p-color-border-secondary, #ebebeb)",
        background: "var(--p-color-bg-surface-secondary, #fafafa)",
        gap: 8,
        alignItems: "center",
      }}>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">Product</Text>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">Source</Text>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">Target</Text>
        <Text variant="bodySm" fontWeight="semibold" tone="subdued" as="span">Status</Text>
        <span />
      </div>
      {redirects.map((redirect, index) => (
        <div
          key={redirect.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1.2fr 1.2fr 110px 150px",
            padding: "12px",
            borderBottom: index < redirects.length - 1 ? "1px solid var(--p-color-border-secondary, #ebebeb)" : "none",
            alignItems: "center",
            gap: 8,
          }}
        >
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Thumbnail
              size="small"
              source={redirect.productImageUrl || "/favicon.ico"}
              alt={redirect.productImageAlt || redirect.productName}
            />
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="semibold" as="span">{redirect.productName}</Text>
              <InlineStack gap="100">
                {redirect.ruleLabel ? <Badge tone="info">{redirect.ruleLabel}</Badge> : null}
                {redirect.confidence ? (
                  <Badge tone={confidenceTone(redirect.confidence)}>{redirect.confidence}</Badge>
                ) : null}
              </InlineStack>
            </BlockStack>
          </InlineStack>
          <Text variant="bodySm" as="span">
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{redirect.sourcePath}</span>
          </Text>
          <Text variant="bodySm" as="span">
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{redirect.targetPath}</span>
          </Text>
          <BlockStack gap="100" inlineAlign="start">
            <span className="rml-history-status-badge">
              <Badge tone={statusTone(redirect.status)}>{redirectStatusLabel(redirect.status)}</Badge>
            </span>
            {redirect.status === "ROLLBACK_FAILED" && redirect.errorMessage ? (
              <div
                title={redirect.errorMessage}
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: 11,
                  color: "var(--p-color-text-critical, #c0392b)",
                  lineHeight: 1.4,
                  wordBreak: "break-word",
                  maxWidth: 200,
                }}
              >
                {redirect.errorMessage}
              </div>
            ) : null}
          </BlockStack>
          <InlineStack gap="150" align="end">
            <Tooltip content="Roll back this Shopify redirect">
              <span className="rml-history-action rml-history-action--rollback">
                <Button
                  icon={UndoIcon}
                  size="slim"
                  variant="secondary"
                  disabled={redirect.status !== "ACTIVE" || isRollingBack}
                  accessibilityLabel="Roll back this Shopify redirect"
                  onClick={() => onRollback(redirect)}
                />
              </span>
            </Tooltip>
          </InlineStack>
        </div>
      ))}
    </>
  );
}

function CleanupDetails({
  cleanup,
  hasActiveRedirects,
  isRollingBack,
  onRollbackCleanup,
  onRollbackRedirect,
}: {
  cleanup: ReturnType<typeof useLoaderData<typeof loader>>["cleanups"][number];
  hasActiveRedirects: boolean;
  isRollingBack: boolean;
  onRollbackCleanup(): void;
  onRollbackRedirect(redirect: ReturnType<typeof useLoaderData<typeof loader>>["cleanups"][number]["redirects"][number]): void;
}) {
  const activeRows = useMemo(
    () => cleanup.redirects.filter((redirect) => redirect.status === "ACTIVE"),
    [cleanup.redirects],
  );
  const detailStats = [
    {
      label: "Selected",
      value: cleanup.totalSelected,
      icon: ClipboardChecklistIcon,
      accent: "#0f7c8f",
      soft: "#e5f7fa",
    },
    {
      label: "Created",
      value: cleanup.redirectsCreated,
      icon: DomainRedirectIcon,
      accent: "#0f6f5c",
      soft: "#e8f6f1",
    },
    {
      label: "Products changed",
      value: cleanup.productsChanged,
      icon: ProductIcon,
      accent: "#507b35",
      soft: "#edf6e8",
    },
    {
      label: "Skipped",
      value: cleanup.skipped,
      icon: SearchListIcon,
      accent: "#68746f",
      soft: "#f1f5f3",
    },
    {
      label: "Low confidence",
      value: cleanup.lowConfidence,
      icon: InfoIcon,
      accent: "#c38727",
      soft: "#fff3df",
    },
    {
      label: "Active",
      value: activeRows.length,
      icon: StatusActiveIcon,
      accent: "#0f6f5c",
      soft: "#e8f6f1",
    },
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">Cleanup #{cleanup.id.slice(0, 8)}</Text>
            <Text variant="bodySm" tone="subdued" as="p">
              {formatWhen(cleanup.createdAt)} · {modeLabel(cleanup.mode)} · {cleanup.actorName ?? "Store staff"}
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button
              icon={ExportIcon}
              disabled={!cleanup.redirects.length}
              onClick={() => downloadCsv(cleanup.redirects, `cleanup-${cleanup.id.slice(0, 8)}-redirects.csv`)}
            >
              Export CSV
            </Button>
            <Tooltip content="Roll back active Shopify redirects">
              <span className="rml-history-action rml-history-action--rollback">
                <Button
                  icon={UndoIcon}
                  size="slim"
                  variant="secondary"
                  disabled={!hasActiveRedirects || isRollingBack}
                  accessibilityLabel="Roll back active Shopify redirects"
                  onClick={onRollbackCleanup}
                />
              </span>
            </Tooltip>
          </InlineStack>
        </InlineStack>

        <div className="rml-cleanup-detail-stat-grid">
          {detailStats.map((stat) => (
            <div
              className="rml-cleanup-detail-stat"
              key={stat.label}
              style={{
                "--rml-detail-accent": stat.accent,
                "--rml-detail-soft": stat.soft,
              } as CSSProperties}
            >
              <span className="rml-cleanup-detail-stat__icon" aria-hidden="true">
                <Icon source={stat.icon} />
              </span>
              <BlockStack gap="050">
                <Text variant="headingLg" as="p">{String(stat.value)}</Text>
                <Text variant="bodySm" tone="subdued" as="p">{stat.label}</Text>
              </BlockStack>
            </div>
          ))}
        </div>

        <Divider />

        <RedirectsTable
          redirects={cleanup.redirects.map((redirect) => ({
            ...redirect,
            cleanupId: cleanup.id,
            cleanup: {
              id: cleanup.id,
              mode: cleanup.mode,
              createdAt: cleanup.createdAt,
              actorName: cleanup.actorName,
            },
          }))}
          isRollingBack={isRollingBack}
          onRollback={onRollbackRedirect}
        />
      </BlockStack>
    </Card>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
