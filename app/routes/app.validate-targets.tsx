import type { ActionFunctionArgs } from "react-router";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
  invalidReason?: string;
};

type TargetValidationResult = {
  target: string;
  status: "valid" | "invalid" | "unchecked" | "skipped";
  resourceType: TargetKind | "storefront";
  reason: string;
};

type AdminCatalogNode = { id?: string; status?: string };
type AdminPageNode = { id?: string; handle?: string; isPublished?: boolean };
type AdminAliasResult = AdminCatalogNode | { nodes?: AdminPageNode[] } | null;
type ExternalFetchResult =
  | { response: Response }
  | { unsafeReason: string };

function isPageConnectionResult(value: AdminAliasResult): value is { nodes?: AdminPageNode[] } {
  return Boolean(value && "nodes" in value);
}

function isCatalogNodeResult(value: AdminAliasResult): value is AdminCatalogNode {
  return Boolean(value && !("nodes" in value));
}

const MAX_TARGETS = 120;
const MAX_STOREFRONT_CHECKS = 80;
const MAX_EXTERNAL_CHECKS = 40;
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

  const nestedPageMatch = pathname.match(/^\/pages\/(.+)$/);
  if (nestedPageMatch) {
    return {
      target,
      path: pathname,
      kind: "page",
      handle: decodeHandle(nestedPageMatch[1]),
      invalidReason:
        "Shopify pages use /pages/{handle}. Nested page paths such as /pages/foo/bar do not map to an Online Store page.",
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

function isUnsafeIpAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }

    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isUnsafeIpAddress(normalized.replace(/^::ffff:/, ""));
    }

    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("2001:db8:")
    );
  }

  return true;
}

function hostnameLooksPrivate(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

async function externalUrlSafety(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http:// and https:// external destinations can be checked.";
  }

  if (url.username || url.password) {
    return "External URLs with embedded credentials are not checked.";
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    return "External URLs on non-standard ports are not checked.";
  }

  if (hostnameLooksPrivate(url.hostname)) {
    return "External URLs using local or private hostnames are not checked.";
  }

  const literalAddress = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literalAddress)) {
    return isUnsafeIpAddress(literalAddress)
      ? "External URLs using private or reserved IP addresses are not checked."
      : null;
  }

  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length) return "External hostname could not be resolved.";
    if (addresses.some((address) => isUnsafeIpAddress(address.address))) {
      return "External hostname resolves to a private or reserved IP address, so it was not checked.";
    }
  } catch {
    return "External hostname could not be resolved.";
  }

  return null;
}

function searchQueryValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function adminValidationQuery(targets: ParsedTarget[]) {
  const variableDefinitions: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};
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

    if (target.kind === "page") {
      const alias = `page${index}`;
      const variable = `${alias}Query`;
      variableDefinitions.push(`$${variable}: String`);
      variables[variable] = `handle:${searchQueryValue(target.handle)}`;
      fields.push(`${alias}: pages(first: 1, query: $${variable}) { nodes { id handle isPublished } }`);
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
      data?: Record<string, AdminAliasResult>;
      errors?: { message: string }[];
    };

    if (json.errors?.length && !json.data) {
      throw new Error(json.errors.map((error) => error.message).join("; "));
    }

    for (const [alias, target] of query.aliases) {
      const rawNode = json.data?.[alias] ?? null;
      const pageNode = target.kind === "page" && isPageConnectionResult(rawNode)
        ? rawNode.nodes?.find((page) => page.handle === target.handle) ?? null
        : null;
      const catalogNode = target.kind !== "page" && isCatalogNodeResult(rawNode)
        ? rawNode
        : null;
      const node = target.kind === "page" ? pageNode : catalogNode;

      if (target.invalidReason) {
        results.set(target.target, {
          target: target.target,
          status: "invalid",
          resourceType: target.kind,
          reason: target.invalidReason,
        });
        continue;
      }

      if (!node?.id) {
        results.set(target.target, {
          target: target.target,
          status: "invalid",
          resourceType: target.kind,
          reason:
            target.kind === "product"
              ? `No Shopify product exists for handle "${target.handle}".`
              : target.kind === "collection"
                ? `No Shopify collection exists for handle "${target.handle}".`
                : `No published Shopify page exists for handle "${target.handle}".`,
        });
        continue;
      }

      if (target.kind === "product" && catalogNode?.status && catalogNode.status !== "ACTIVE") {
        results.set(target.target, {
          target: target.target,
          status: "invalid",
          resourceType: target.kind,
          reason: `Product "${target.handle}" exists but is ${catalogNode.status.toLowerCase()}, so its storefront URL can 404.`,
        });
        continue;
      }

      if (target.kind === "page" && pageNode?.isPublished === false) {
        results.set(target.target, {
          target: target.target,
          status: "invalid",
          resourceType: target.kind,
          reason: `Page "${target.handle}" exists but is not published, so its storefront URL can 404.`,
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
            : target.kind === "collection"
              ? `Collection "${target.handle}" exists in Shopify.`
              : `Page "${target.handle}" exists and is published in Shopify.`,
      });
    }
  } catch (error) {
    logger.warn("target_validation.admin_check_failed", {
      error: logger.serializeError(error),
      targets: targets.map((target) => target.target),
    });

    for (const target of targets) {
      if (target.kind !== "product" && target.kind !== "collection" && target.kind !== "page") continue;
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

async function fetchWithTimeout(
  url: string,
  method: "HEAD" | "GET",
  redirect: RequestRedirect = "follow",
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STOREFRONT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      redirect,
      signal: controller.signal,
      headers: {
        "User-Agent": "RedirectMapperLiteTargetValidator/1.0",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExternalWithTimeout(
  initialUrl: string,
  method: "HEAD" | "GET",
): Promise<ExternalFetchResult> {
  let currentUrl = new URL(initialUrl);

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const unsafeReason = await externalUrlSafety(currentUrl);
    if (unsafeReason) return { unsafeReason };

    const response = await fetchWithTimeout(currentUrl.toString(), method, "manual");
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response };
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return { response };
  }

  return { unsafeReason: "External destination has too many redirects to validate safely." };
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

async function validateExternalTarget(target: ParsedTarget): Promise<TargetValidationResult> {
  try {
    let result = await fetchExternalWithTimeout(target.path, "HEAD");
    if ("unsafeReason" in result) {
      return {
        target: target.target,
        status: "unchecked",
        resourceType: "external",
        reason: result.unsafeReason,
      };
    }

    let response = result.response;
    if (response.status === 405 || response.status === 403) {
      result = await fetchExternalWithTimeout(target.path, "GET");
      if ("unsafeReason" in result) {
        return {
          target: target.target,
          status: "unchecked",
          resourceType: "external",
          reason: result.unsafeReason,
        };
      }
      response = result.response;
    }

    if (response.status === 404 || response.status === 410) {
      return {
        target: target.target,
        status: "invalid",
        resourceType: "external",
        reason: `External destination returned ${response.status}.`,
      };
    }

    if (response.status === 429) {
      return {
        target: target.target,
        status: "unchecked",
        resourceType: "external",
        reason: "External destination rate-limited validation, so it could not be confirmed.",
      };
    }

    if (response.status === 400 || response.status >= 500) {
      return {
        target: target.target,
        status: "invalid",
        resourceType: "external",
        reason: `External destination returned ${response.status}.`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        target: target.target,
        status: "unchecked",
        resourceType: "external",
        reason: `External destination returned ${response.status}, so it could not be confirmed.`,
      };
    }

    return {
      target: target.target,
      status: "valid",
      resourceType: "external",
      reason: `External destination returned ${response.status}.`,
    };
  } catch (error) {
    return {
      target: target.target,
      status: "unchecked",
      resourceType: "external",
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "External destination validation timed out."
          : "External destination could not be reached.",
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
      reason: "External URL has not been checked yet.",
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

    const catalogAdminResults = await validateAdminTargets(
      admin,
      parsedTargets.filter(
        (target) => target.kind === "product" || target.kind === "collection",
      ),
    );
    for (const [target, result] of catalogAdminResults) {
      results.set(target, result);
    }

    const pageAdminResults = await validateAdminTargets(
      admin,
      parsedTargets.filter((target) => target.kind === "page"),
    );
    for (const [target, result] of pageAdminResults) {
      results.set(target, result);
    }

    const storefrontCandidates = parsedTargets
      .filter((target) => target.kind !== "system" && target.kind !== "external" && target.kind !== "unsupported")
      .filter((target) => target.kind !== "page")
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

    const externalCandidates = parsedTargets.filter((target) => target.kind === "external");
    const externalTargets = externalCandidates.slice(0, MAX_EXTERNAL_CHECKS);
    const skippedExternalTargets = externalCandidates.slice(MAX_EXTERNAL_CHECKS);
    const externalResults = await mapWithConcurrency(
      externalTargets,
      STOREFRONT_CONCURRENCY,
      validateExternalTarget,
    );

    for (const result of externalResults) {
      results.set(result.target, result);
    }

    for (const target of skippedExternalTargets) {
      results.set(target.target, {
        target: target.target,
        status: "unchecked",
        resourceType: target.kind,
        reason: "Skipped to avoid excessive external validation requests.",
      });
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
