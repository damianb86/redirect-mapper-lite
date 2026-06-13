import { logger } from "../logger.server";
import type { AdminGraphqlClient } from "./shopify-catalog.server";

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

export type TargetValidationResult = {
  target: string;
  status: "valid" | "invalid" | "unchecked" | "skipped";
  resourceType: TargetKind;
  reason: string;
};

type AdminCatalogNode = { id?: string; status?: string };
type AdminPageNode = { id?: string; handle?: string; isPublished?: boolean };
type AdminAliasResult = AdminCatalogNode | { nodes?: AdminPageNode[] } | null;

function isPageConnectionResult(value: AdminAliasResult): value is { nodes?: AdminPageNode[] } {
  return Boolean(value && "nodes" in value);
}

function isCatalogNodeResult(value: AdminAliasResult): value is AdminCatalogNode {
  return Boolean(value && !("nodes" in value));
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
        "Shopify pages use /pages/{handle}. Nested page paths do not map to an Online Store page.",
    };
  }

  return { target, path: `${pathname}${url.search}`, kind: "unknown" };
}

function parseTarget(target: string): ParsedTarget {
  const trimmed = target.trim();
  if (!trimmed) {
    return { target: trimmed, path: trimmed, kind: "unsupported" };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
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
      reason: "External URL was not checked by the AI planning validator.",
    };
  }

  if (target.kind === "unsupported") {
    return {
      target: target.target,
      status: "invalid",
      resourceType: target.kind,
      reason: "Destination must be a storefront path or http(s) URL.",
    };
  }

  return {
    target: target.target,
    status: "unchecked",
    resourceType: target.kind,
    reason: "This destination format could not be checked automatically.",
  };
}

async function validateAdminTargets(admin: AdminGraphqlClient, targets: ParsedTarget[]) {
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
    logger.warn("ai_wizard.target_validation.admin_check_failed", {
      error: logger.serializeError(error),
      targets: targets.map((target) => target.target),
    });

    for (const target of targets) {
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

export async function validateRedirectTargetsForShop({
  admin,
  targets,
}: {
  admin: AdminGraphqlClient;
  shop: string;
  targets?: unknown;
}) {
  const requestedTargets = Array.isArray(targets)
    ? targets
        .filter((target): target is string => typeof target === "string")
        .map((target) => target.trim())
        .filter(Boolean)
    : [];
  const uniqueTargets = Array.from(new Set(requestedTargets)).slice(0, 120);
  const parsedTargets = uniqueTargets.map(parseTarget);
  const results = new Map<string, TargetValidationResult>();

  for (const target of parsedTargets) {
    const defaultResult = defaultResultForTarget(target);
    if (
      defaultResult.status !== "unchecked" ||
      target.kind === "external" ||
      target.kind === "unsupported"
    ) {
      results.set(target.target, defaultResult);
    }
  }

  const adminResults = await validateAdminTargets(
    admin,
    parsedTargets.filter(
      (target) =>
        target.kind === "product" || target.kind === "collection" || target.kind === "page",
    ),
  );
  for (const [target, result] of adminResults) {
    results.set(target, result);
  }

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
}
