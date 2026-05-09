import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DEV } from "../dev";
import { addLogContext, logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

type ApplyMode = "redirects" | "archive" | "delete";
type RedirectConfidence = "High" | "Medium" | "Low";

type ApplyRedirectInput = {
  productId: string;
  productName: string;
  productImageUrl?: string;
  productImageAlt?: string;
  from: string;
  to: string;
  ruleLabel?: string;
  confidence?: RedirectConfidence;
  targetChoice?: string;
};

type ApplyPayload = {
  mode: ApplyMode;
  redirects: ApplyRedirectInput[];
  summary?: {
    totalSelected?: number;
    skipped?: number;
    conflicts?: number;
    lowConfidence?: number;
    planOverrideAllowed?: boolean;
  };
};

type ApplyItemResult = {
  productId: string;
  productName: string;
  from: string;
  to: string;
  ok: boolean;
  redirectId?: string;
  message?: string;
};

type ProductOperationResult = {
  productId: string;
  ok: boolean;
  operation?: string;
  message?: string;
};

type ShopifyApiDebugLog = {
  operation: "urlRedirectCreate" | "productUpdate" | "productDelete" | "applyPayload";
  productId?: string;
  productName?: string;
  from?: string;
  to?: string;
  variables?: unknown;
  response?: unknown;
  result?: unknown;
  error?: string;
};

const URL_REDIRECT_CREATE = `#graphql
  mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
	  }
	` as string;

const PRODUCT_ARCHIVE = `#graphql
  mutation ProductArchive($product: ProductUpdateInput!) {
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

const PRODUCT_DELETE = `#graphql
  mutation ProductDelete($input: ProductDeleteInput!, $synchronous: Boolean!) {
    productDelete(input: $input, synchronous: $synchronous) {
      deletedProductId
      productDeleteOperation {
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

function getActorName(
  user?: { first_name?: string; last_name?: string; email?: string } | null,
) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return name || user?.email || "Store staff";
}

function redirectKey(redirect: Pick<ApplyRedirectInput, "productId" | "from">) {
  return `${redirect.productId}:${redirect.from}`;
}

function logShopifyDev(logs: ShopifyApiDebugLog[], entry: ShopifyApiDebugLog) {
  if (!DEV) return;
  logs.push(entry);
  logger.debug("shopify.graphql.debug", entry as Record<string, unknown>);
}

function normalizePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
}

function normalizeTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).toString();
    } catch {
      return "";
    }
  }
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  // Shopify re-encodes the `target` field when storing the redirect.
  // If we send an already percent-encoded string (e.g. /search?q=Foo%20Bar),
  // Shopify double-encodes it (%20 → %2520) and the redirect points to a
  // broken URL. Decoding before sending lets Shopify apply its own encoding
  // correctly — exactly what Shopify admin does when you create a redirect there.
  try {
    return decodeURIComponent(path);
  } catch {
    // Malformed percent-sequence — send as-is and let Shopify validate.
    return path;
  }
}

function userErrorMessage(
  errors: { field?: string[] | null; message: string }[] | undefined,
) {
  return errors?.map((error) => error.message).join("; ") || null;
}

/**
 * Returns a human-readable error message from a raw Shopify GraphQL response.
 * Checks both top-level `errors` (GraphQL protocol errors) and `userErrors`
 * inside the mutation payload so that nothing is silently swallowed.
 */
function extractGqlError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any,
  dataPath: string[],
): string | null {
  // 1. Top-level protocol errors  (auth, network, validation before execution)
  if (json?.errors?.length) {
    return json.errors
      .map((e: { message?: string }) => e.message ?? "Unknown GraphQL error")
      .join("; ");
  }
  // 2. userErrors inside the mutation payload
  let node = json?.data;
  for (const key of dataPath) node = node?.[key];
  const userErrors = node?.userErrors as
    | { field?: string[] | null; message: string }[]
    | undefined;
  return userErrorMessage(userErrors);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "app.apply.action", async () => {
    const { admin, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const formData = await request.formData();
    const rawPayload = formData.get("payload");

  if (typeof rawPayload !== "string") {
    return {
      ok: false,
      message: "Missing apply payload.",
      redirects: [],
      products: [],
      dev: DEV ? { shopifyApiLogs: [] } : undefined,
    };
  }

  const payload = JSON.parse(rawPayload) as ApplyPayload;
  const redirects = payload.redirects
    .map((redirect) => ({
      ...redirect,
      from: normalizePath(redirect.from),
      to: normalizeTarget(redirect.to),
    }))
    .filter((redirect) => redirect.from && redirect.to);
  const sessionDetails = session as typeof session & {
    onlineAccessInfo?: {
      associated_user?: { first_name?: string; last_name?: string; email?: string };
    };
  };
  const actorName = getActorName(sessionDetails.onlineAccessInfo?.associated_user);

  const devLogs: ShopifyApiDebugLog[] = [];
  const redirectResultsByKey = new Map<string, ApplyItemResult>();
  const productResults: ProductOperationResult[] = [];
  const shouldRetireBeforeRedirects = payload.mode === "archive" || payload.mode === "delete";
  const uniqueProductIds = Array.from(new Set(redirects.map((redirect) => redirect.productId)));

  logShopifyDev(devLogs, {
    operation: "applyPayload",
    variables: {
      mode: payload.mode,
      receivedRedirects: payload.redirects.length,
      normalizedRedirects: redirects.length,
      shouldRetireBeforeRedirects,
    },
  });

  if (payload.mode === "archive") {
    for (const productId of uniqueProductIds) {
      const variables = { product: { id: productId, status: "ARCHIVED" } };
      try {
        const response = await admin.graphql(PRODUCT_ARCHIVE, { variables });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = (await response.json()) as any;
        const message = extractGqlError(json, ["productUpdate"]);
        const result: ProductOperationResult = {
          productId,
          ok: !message,
          operation: "archive",
          message: message ?? undefined,
        };
        productResults.push(result);
        logShopifyDev(devLogs, {
          operation: "productUpdate",
          productId,
          variables,
          response: json,
          result,
        });
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const result: ProductOperationResult = {
          productId,
          ok: false,
          operation: "archive",
          message: `Exception archiving product ${productId} — ${detail}`,
        };
        productResults.push(result);
        logShopifyDev(devLogs, {
          operation: "productUpdate",
          productId,
          variables,
          error: detail,
          result,
        });
      }
    }
  }

  if (payload.mode === "delete") {
    for (const productId of uniqueProductIds) {
      const variables = {
        input: { id: productId },
        synchronous: true,
      };
      try {
        const response = await admin.graphql(PRODUCT_DELETE, { variables });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = (await response.json()) as any;
        const message = extractGqlError(json, ["productDelete"]);
        const result: ProductOperationResult = {
          productId,
          ok: !message,
          operation: "delete",
          message: message ?? undefined,
        };
        productResults.push(result);
        logShopifyDev(devLogs, {
          operation: "productDelete",
          productId,
          variables,
          response: json,
          result,
        });
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const result: ProductOperationResult = {
          productId,
          ok: false,
          operation: "delete",
          message: `Exception deleting product ${productId} — ${detail}`,
        };
        productResults.push(result);
        logShopifyDev(devLogs, {
          operation: "productDelete",
          productId,
          variables,
          error: detail,
          result,
        });
      }
    }
  }

  const retiredProductIds = new Set(
    productResults.filter((result) => result.ok).map((result) => result.productId),
  );
  const productFailures = new Map(
    productResults
      .filter((result) => !result.ok)
      .map((result) => [result.productId, result.message ?? "Product update failed."]),
  );

  for (const redirect of redirects) {
    const key = redirectKey(redirect);
    if (shouldRetireBeforeRedirects && !retiredProductIds.has(redirect.productId)) {
      redirectResultsByKey.set(key, {
        productId: redirect.productId,
        productName: redirect.productName,
        from: redirect.from,
        to: redirect.to,
        ok: false,
        message:
          productFailures.get(redirect.productId) ??
          "Product could not be retired before creating the redirect.",
      });
      continue;
    }

    const variables = {
      urlRedirect: {
        path: redirect.from,
        target: redirect.to,
      },
    };

    try {
      const response = await admin.graphql(URL_REDIRECT_CREATE, { variables });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await response.json()) as any;

      const errorMessage = extractGqlError(json, ["urlRedirectCreate"]);
      const redirectId: string | undefined =
        json?.data?.urlRedirectCreate?.urlRedirect?.id;

      // Treat as failure if there's any error OR if Shopify didn't return an ID
      // (the latter catches silent rejections where userErrors is empty but the
      // redirect was never persisted on Shopify's side).
      const silentFail = !errorMessage && !redirectId;
      const finalError = errorMessage
        ?? (silentFail
          ? `Shopify accepted the request but returned no redirect ID. ` +
            `Raw response: ${JSON.stringify(json?.data?.urlRedirectCreate ?? json?.errors ?? json)}`
          : null);

      const result: ApplyItemResult = {
        productId: redirect.productId,
        productName: redirect.productName,
        from: redirect.from,
        to: redirect.to,
        ok: !finalError,
        redirectId,
        message: finalError ?? undefined,
      };
      redirectResultsByKey.set(key, result);
      logShopifyDev(devLogs, {
        operation: "urlRedirectCreate",
        productId: redirect.productId,
        productName: redirect.productName,
        from: redirect.from,
        to: redirect.to,
        variables,
        response: json,
        result,
      });
    } catch (error) {
      const detail = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      const result: ApplyItemResult = {
        productId: redirect.productId,
        productName: redirect.productName,
        from: redirect.from,
        to: redirect.to,
        ok: false,
        message: `Exception during Shopify API call — ${detail}`,
      };
      redirectResultsByKey.set(key, result);
      logShopifyDev(devLogs, {
        operation: "urlRedirectCreate",
        productId: redirect.productId,
        productName: redirect.productName,
        from: redirect.from,
        to: redirect.to,
        variables,
        error: detail,
        result,
      });
    }
  }

  const redirectResults = redirects.map((redirect) => redirectResultsByKey.get(redirectKey(redirect)) ?? {
    productId: redirect.productId,
    productName: redirect.productName,
    from: redirect.from,
    to: redirect.to,
    ok: false,
    message: "Redirect was not processed.",
  });
  const redirectErrors = redirectResults.filter((result) => !result.ok);
  const productErrors = productResults.filter((result) => !result.ok);
  const redirectsCreated = redirectResults.filter((result) => result.ok).length;
  const productsChanged = productResults.filter((result) => result.ok).length;
  const status =
    redirectsCreated === 0
      ? "FAILED"
      : redirectErrors.length || productErrors.length
        ? "PARTIAL"
        : "ACTIVE";
  const cleanup = await prisma.cleanupRun.create({
    data: {
      shop: session.shop,
      mode: payload.mode,
      status,
      actorName,
      totalSelected: payload.summary?.totalSelected ?? payload.redirects.length,
      redirectsTotal: redirects.length,
      redirectsCreated,
      redirectsFailed: redirectErrors.length,
      productsChanged,
      productsFailed: productErrors.length,
      skipped: payload.summary?.skipped ?? 0,
      conflicts: payload.summary?.conflicts ?? 0,
      lowConfidence: payload.summary?.lowConfidence ?? 0,
      planOverride: payload.summary?.planOverrideAllowed ?? false,
      completedAt: new Date(),
      redirects: {
        create: redirectResults.map((result) => {
          const original = payload.redirects.find(
            (redirect) => redirect.productId === result.productId && normalizePath(redirect.from) === result.from,
          );
          return {
            shop: session.shop,
            productId: result.productId,
            productName: result.productName,
            productImageUrl: original?.productImageUrl,
            productImageAlt: original?.productImageAlt,
            sourcePath: result.from,
            targetPath: result.to,
            ruleLabel: original?.ruleLabel,
            confidence: original?.confidence,
            targetChoice: original?.targetChoice,
            shopifyRedirectId: result.redirectId,
            status: result.ok ? "ACTIVE" : "FAILED",
            errorMessage: result.message,
          };
        }),
      },
    },
  });

    return {
    ok: redirectErrors.length === 0 && productErrors.length === 0,
    cleanupId: cleanup.id,
    completedAt: cleanup.completedAt?.toISOString(),
    redirects: redirectResults,
    products: productResults,
    dev: DEV ? { shopifyApiLogs: devLogs } : undefined,
    message:
      redirectErrors.length || productErrors.length
        ? "Some Shopify operations failed."
        : "Cleanup applied.",
    };
  });
};
