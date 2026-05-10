import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { addLogContext, logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

type TargetKind =
  | "product"
  | "collection"
  | "page"
  | "system"
  | "external"
  | "unknown"
  | "unsupported";

type ParsedTarget = {
  target: string;
  path: string;
  kind: TargetKind;
  handle?: string;
};

type TargetValidationResult = {
  target: string;
  status: "valid" | "invalid" | "unchecked" | "skipped";
  resourceType: TargetKind | "storefront";
  reason: string;
};

const MAX_TARGETS = 120;
const MAX_STOREFRONT_CHECKS = 80;
const STOREFRONT_TIMEOUT_MS = 3500;
const STOREFRONT_CONCURRENCY = 6;

const SHOP_PRIMARY_DOMAIN = `#graphql
  query ShopPrimaryDomain {
    shop {
      primaryDomain {
        url
      }
    }
  }
` as string;

function normalizeStorefrontBaseUrl(primaryDomainUrl: string | null | undefined, fallbackShop: string) {
  const fallback = `https://${fallbackShop.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  const raw = primaryDomainUrl?.trim();
  if (!raw) return fallback;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

async function getStorefrontBaseUrl(
  admin: { graphql(query: string): Promise<Response> },
  shop: string,
) {
  try {
    const response = await admin.graphql(SHOP_PRIMARY_DOMAIN);
    const json = (await response.json()) as {
      data?: { shop?: { primaryDomain?: { url?: string | null } | null } | null };
    };
    return normalizeStorefrontBaseUrl(json.data?.shop?.primaryDomain?.url, shop);
  } catch (error) {
    logger.warn("target_validation.primary_domain_failed", {
      error: logger.serializeError(error),
    });
    return normalizeStorefrontBaseUrl(null, shop);
  }
}

function decodeHandle(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseStorefrontPath(target: string, pathValue: string): ParsedTarget {
  const url = new URL(pathValue, "https://storefront.local");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/" || pathname === "/collections/all") {
    return { target, path: pathname, kind: "system" };
  }

  if (pathname === "/search" || pathname.startsWith("/search/")) {
    return { target, path: `${pathname}${url.search}`, kind: "system" };
  }

  const productMatch = pathname.match(/^\/products\/([^/]+)$/);
  if (productMatch) {
    return {
      target,
      path: pathname,
      kind: "product",
      handle: decodeHandle(productMatch[1]),
    };
  }

  const collectionMatch = pathname.match(/^\/collections\/([^/]+)$/);
  if (collectionMatch) {
    return {
      target,
      path: pathname,
      kind: "collection",
      handle: decodeHandle(collectionMatch[1]),
    };
  }

  const pageMatch = pathname.match(/^\/pages\/([^/]+)$/);
  if (pageMatch) {
    return {
      target,
      path: pathname,
      kind: "page",
      handle: decodeHandle(pageMatch[1]),
    };
  }

  return { target, path: `${pathname}${url.search}`, kind: "unknown" };
}

function parseTarget(target: string, storefrontBaseUrl: string, shop: string): ParsedTarget {
  const trimmed = target.trim();
  const storefrontHost = new URL(storefrontBaseUrl).hostname;
  const shopHost = shop.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname !== storefrontHost && url.hostname !== shopHost) {
        return { target: trimmed, path: trimmed, kind: "external" };
      }
      return parseStorefrontPath(trimmed, `${url.pathname}${url.search}`);
    } catch {
      return { target: trimmed, path: trimmed, kind: "unsupported" };
    }
  }

  if (!trimmed.startsWith("/")) {
    return { target: trimmed, path: trimmed, kind: "unsupported" };
  }

  return parseStorefrontPath(trimmed, trimmed);
}

function adminValidationQuery(targets: ParsedTarget[]) {
  const variableDefinitions: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, { handle: string }> = {};
  const aliases = new Map<string, ParsedTarget>();

  targets.forEach((target, index) => {
    if (!target.handle) return;

    if (target.kind === "product") {
      const alias = `product${index}`;
      const variable = `${alias}Identifier`;
      variableDefinitions.push(`$${variable}: ProductIdentifierInput!`);
      variables[variable] = { handle: target.handle };
      fields.push(`${alias}: productByIdentifier(identifier: $${variable}) { id handle status }`);
      aliases.set(alias, target);
    }

    if (target.kind === "collection") {
      const alias = `collection${index}`;
      const variable = `${alias}Identifier`;
      variableDefinitions.push(`$${variable}: CollectionIdentifierInput!`);
      variables[variable] = { handle: target.handle };
      fields.push(`${alias}: collectionByIdentifier(identifier: $${variable}) { id handle }`);
      aliases.set(alias, target);
    }
  });

  if (!fields.length) return null;

  return {
    query: `#graphql
      query ValidateRedirectTargets(${variableDefinitions.join(", ")}) {
        ${fields.join("\n")}
      }
    `,
    variables,
    aliases,
  };
}

async function validateAdminTargets(
  admin: { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> },
  targets: ParsedTarget[],
) {
  const results = new Map<string, TargetValidationResult>();
  const query = adminValidationQuery(targets);
  if (!query) return results;

  try {
    const response = await admin.graphql(query.query, { variables: query.variables });
    const json = (await response.json()) as {
      data?: Record<string, { id?: string; status?: string } | null>;
      errors?: { message: string }[];
    };

    if (json.errors?.length && !json.data) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    for (const [alias, target] of query.aliases) {
      const node = json.data?.[alias];

      if (!node?.id) {
        results.set(target.target, {
          target: target.target,
          status: "invalid",
          resourceType: target.kind,
          reason:
            target.kind === "product"
              ? `No Shopify product exists for handle "${target.handle}".`
              : `No Shopify collection exists for handle "${target.handle}".`,
        });
        continue;
      }

      if (target.kind === "product" && node.status && node.status !== "ACTIVE") {
        results.set(target.target, {
          target: target.target,
          status: "invalid",
          resourceType: target.kind,
          reason: `Product "${target.handle}" exists but is ${node.status.toLowerCase()}, so its storefront URL can 404.`,
        });
        continue;
      }

      results.set(target.target, {
        target: target.target,
        status: "valid",
        resourceType: target.kind,
        reason:
          target.kind === "product"
            ? `Product "${target.handle}" exists in Shopify.`
            : `Collection "${target.handle}" exists in Shopify.`,
      });
    }
  } catch (error) {
    logger.warn("target_validation.admin_check_failed", {
      error: logger.serializeError(error),
      targets: targets.map((target) => target.target),
    });

    for (const target of targets) {
      if (target.kind !== "product" && target.kind !== "collection") continue;
      results.set(target.target, {
        target: target.target,
        status: "unchecked",
        resourceType: target.kind,
        reason: "Shopify Admin validation was unavailable for this target.",
      });
    }
  }

  return results;
}

async function fetchWithTimeout(url: string, method: "HEAD" | "GET") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STOREFRONT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "RedirectMapperLiteTargetValidator/1.0",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateStorefrontTarget(
  storefrontBaseUrl: string,
  target: ParsedTarget,
): Promise<TargetValidationResult> {
  const url = new URL(target.path, storefrontBaseUrl).toString();

  try {
    let response = await fetchWithTimeout(url, "HEAD");
    if (response.status === 405) {
      response = await fetchWithTimeout(url, "GET");
    }

    if (response.status === 404 || response.status === 410) {
      return {
        target: target.target,
        status: "invalid",
        resourceType: "storefront",
        reason: `Storefront returned ${response.status} for this destination.`,
      };
    }

    if (response.status === 400 || response.status >= 500) {
      return {
        target: target.target,
        status: "invalid",
        resourceType: "storefront",
        reason: `Storefront returned ${response.status} for this destination.`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        target: target.target,
        status: "unchecked",
        resourceType: "storefront",
        reason: `Storefront returned ${response.status}, so this destination could not be confirmed.`,
      };
    }

    return {
      target: target.target,
      status: "valid",
      resourceType: "storefront",
      reason: `Storefront returned ${response.status}.`,
    };
  } catch (error) {
    return {
      target: target.target,
      status: "unchecked",
      resourceType: "storefront",
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "Storefront validation timed out."
          : "Storefront validation could not reach this destination.",
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

function defaultResultForTarget(target: ParsedTarget): TargetValidationResult {
  if (target.kind === "system") {
    return {
      target: target.target,
      status: "skipped",
      resourceType: target.kind,
      reason: "System destinations such as homepage, search, and all products are skipped.",
    };
  }

  if (target.kind === "external") {
    return {
      target: target.target,
      status: "unchecked",
      resourceType: target.kind,
      reason: "External URLs are not checked against the Shopify storefront.",
    };
  }

  return {
    target: target.target,
    status: "unchecked",
    resourceType: target.kind,
    reason: "This destination format could not be checked automatically.",
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "app.validate-targets.action", async () => {
    const { admin, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });

    const payload = (await request.json().catch(() => null)) as {
      targets?: unknown;
    } | null;
    const requestedTargets = Array.isArray(payload?.targets)
      ? payload.targets
          .filter((target): target is string => typeof target === "string")
          .map((target) => target.trim())
          .filter(Boolean)
      : [];
    const uniqueTargets = Array.from(new Set(requestedTargets));
    const targetsToCheck = uniqueTargets.slice(0, MAX_TARGETS);
    const overflowTargets = uniqueTargets.slice(MAX_TARGETS);
    const storefrontBaseUrl = await getStorefrontBaseUrl(admin, session.shop);
    const parsedTargets = targetsToCheck.map((target) =>
      parseTarget(target, storefrontBaseUrl, session.shop),
    );
    const results = new Map<string, TargetValidationResult>();

    for (const target of parsedTargets) {
      const defaultResult = defaultResultForTarget(target);
      if (defaultResult.status !== "unchecked" || target.kind === "external" || target.kind === "unsupported") {
        results.set(target.target, defaultResult);
      }
    }

    const adminResults = await validateAdminTargets(
      admin,
      parsedTargets.filter((target) => target.kind === "product" || target.kind === "collection"),
    );
    for (const [target, result] of adminResults) {
      results.set(target, result);
    }

    const storefrontCandidates = parsedTargets
      .filter((target) => target.kind !== "system" && target.kind !== "external" && target.kind !== "unsupported")
      .filter((target) => results.get(target.target)?.status !== "invalid");
    const storefrontTargets = storefrontCandidates.slice(0, MAX_STOREFRONT_CHECKS);
    const skippedStorefrontTargets = storefrontCandidates.slice(MAX_STOREFRONT_CHECKS);

    const storefrontResults = await mapWithConcurrency(
      storefrontTargets,
      STOREFRONT_CONCURRENCY,
      (target) => validateStorefrontTarget(storefrontBaseUrl, target),
    );

    for (const result of storefrontResults) {
      const existing = results.get(result.target);
      if (
        result.status === "invalid" ||
        !existing ||
        existing.status === "unchecked" ||
        existing.resourceType === "storefront"
      ) {
        results.set(result.target, result);
      }
    }

    for (const target of skippedStorefrontTargets) {
      if (!results.has(target.target)) {
        results.set(target.target, {
          target: target.target,
          status: "unchecked",
          resourceType: target.kind,
          reason: "Skipped to avoid excessive storefront validation requests.",
        });
      }
    }

    for (const target of overflowTargets) {
      results.set(target, {
        target,
        status: "unchecked",
        resourceType: "unknown",
        reason: "Skipped to avoid excessive validation requests.",
      });
    }

    logger.info("target_validation.completed", {
      requested: uniqueTargets.length,
      checked: targetsToCheck.length,
      invalid: Array.from(results.values()).filter((result) => result.status === "invalid").length,
      unchecked: Array.from(results.values()).filter((result) => result.status === "unchecked").length,
    });

    return {
      results: uniqueTargets.map(
        (target) =>
          results.get(target) ?? {
            target,
            status: "unchecked" as const,
            resourceType: "unknown" as const,
            reason: "This destination could not be checked automatically.",
          },
      ),
    };
  });
};

// No default export -> resource route (never rendered as a page)
