import type { FunctionTool } from "openai/resources/responses/responses";
import {
  buildPreviewRows,
  normalizeRule,
  productFilterInventoryValue,
  productScopeForInventory,
  rulesForPreset,
  type CleanupMode,
  type CleanupPreset,
  type GeneratedPreviewRow,
  type PresetDetails,
  type ProductRow,
  type RedirectRule,
} from "./cleanup-rules";
import {
  buildShopifyProductQuery,
  loadCatalogLookupOptions,
  loadProductsForCleanup,
  normalizeProductFilters,
  type AdminGraphqlClient,
  type CatalogLookupKind,
  type CleanupProductFilters,
} from "./shopify-catalog.server";
import { validateRedirectTargetsForShop } from "./redirect-target-validation.server";
import type { AiCleanupIntent, AiSuggestedFilter } from "./ai-wizard.schemas";

export type AiToolContext = {
  admin: AdminGraphqlClient;
  shop: string;
};

type JsonObject = Record<string, unknown>;

export type AiWizardToolResult = {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
};

const stringArraySchema = {
  type: "array",
  items: { type: "string" },
};

const productFiltersParamSchema = {
  type: "object",
  description:
    "Existing product filters only. Supported fields are q, season, inventory, updated, vendors, types, tags, collection IDs/titles, status tab, and joins. There is no description/body/content/metafield/SEO-description filter.",
  additionalProperties: false,
  required: [
    "q",
    "season",
    "inventory",
    "inventoryValue",
    "updated",
    "vendors",
    "types",
    "tags",
    "collectionIds",
    "collectionTitles",
    "taxonomyJoin",
    "vendorJoin",
    "typeJoin",
    "tagJoin",
    "collectionJoin",
    "tab",
    "bulk",
    "maxProducts",
  ],
  properties: {
    q: {
      type: ["string", "null"],
      description:
        "Broad keyword query over supported indexed fields such as title/name, handle, vendor, product type, SKU, collections, and tags. Do not use this as a product-description search.",
    },
    season: { type: ["string", "null"] },
    inventory: { type: ["string", "null"] },
    inventoryValue: { type: ["string", "number", "null"] },
    updated: { type: ["string", "null"] },
    vendors: stringArraySchema,
    types: stringArraySchema,
    tags: stringArraySchema,
    collectionIds: stringArraySchema,
    collectionTitles: stringArraySchema,
    taxonomyJoin: { type: "string", enum: ["and", "or"] },
    vendorJoin: { type: "string", enum: ["any", "all"] },
    typeJoin: { type: "string", enum: ["any", "all"] },
    tagJoin: { type: "string", enum: ["any", "all"] },
    collectionJoin: { type: "string", enum: ["any", "all"] },
    tab: { type: ["string", "null"] },
    bulk: { type: "boolean" },
    maxProducts: { type: "number" },
  },
};

const presetDetailsParamSchema = {
  type: "object",
  additionalProperties: false,
  required: ["seasonal", "vendor", "oos", "spring"],
  properties: {
    seasonal: {
      type: "object",
      additionalProperties: false,
      required: [
        "keywords",
        "collectionIds",
        "collectionTitles",
        "tags",
        "inventory",
      ],
      properties: {
        keywords: { type: "string" },
        collectionIds: stringArraySchema,
        collectionTitles: stringArraySchema,
        tags: stringArraySchema,
        inventory: { type: "string" },
      },
    },
    vendor: {
      type: "object",
      additionalProperties: false,
      required: ["vendors", "productTypes"],
      properties: {
        vendors: stringArraySchema,
        productTypes: stringArraySchema,
      },
    },
    oos: {
      type: "object",
      additionalProperties: false,
      required: ["updated", "productTypes", "tags"],
      properties: {
        updated: { type: "string" },
        productTypes: stringArraySchema,
        tags: stringArraySchema,
      },
    },
    spring: {
      type: "object",
      additionalProperties: false,
      required: ["tags", "inventory", "updated", "productTypes"],
      properties: {
        tags: stringArraySchema,
        inventory: { type: "string" },
        updated: { type: "string" },
        productTypes: stringArraySchema,
      },
    },
  },
};

const redirectRuleParamSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "field",
    "condition",
    "value",
    "target",
    "targetOption",
    "targetValue",
    "enabled",
    "stopOnMatch",
  ],
  properties: {
    id: { type: "string" },
    field: {
      type: "string",
      enum: [
        "collection",
        "vendor",
        "productType",
        "tag",
        "status",
        "inventory",
        "sku",
        "titleHandle",
        "price",
        "age",
        "fallback",
      ],
    },
    condition: { type: "string" },
    value: { type: "string" },
    target: {
      type: "string",
      enum: [
        "sameCollection",
        "bestSiblingProduct",
        "productTypeCollection",
        "vendorCollection",
        "tagCollection",
        "searchResults",
        "allProducts",
        "customPath",
        "homepage",
        "noRedirect",
      ],
    },
    targetOption: { type: "string" },
    targetValue: { type: "string" },
    enabled: { type: "boolean" },
    stopOnMatch: { type: "boolean" },
  },
};

const redirectPreviewParamSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "from", "to", "via", "confidence", "targetChoice"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    via: { type: "string" },
    confidence: { type: "string", enum: ["High", "Medium", "Low"] },
    targetChoice: {
      type: "string",
      enum: [
        "suggested",
        "sameCollection",
        "vendorCollection",
        "productTypeCollection",
        "search",
        "allProducts",
        "homepage",
        "custom",
        "skip",
      ],
    },
  },
};

function tool(
  name: string,
  description: string,
  parameters: FunctionTool["parameters"],
): FunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters,
  };
}

function searchTool(name: string, kind: CatalogLookupKind, noun: string) {
  return tool(
    name,
    `Search real Shopify ${noun}. Use this before referring to a ${noun.slice(0, -1)} from merchant text. Returns only catalog values that exist in the shop.`,
    {
      type: "object",
      additionalProperties: false,
      required: ["query", "limit"],
      properties: {
        query: {
          type: "string",
          description: `Merchant-provided text to match against real Shopify ${noun}.`,
        },
        limit: {
          type: "number",
          description:
            "Maximum results to return. Use 10 unless there is a reason to show more.",
        },
      },
    },
  );
}

export const AI_WIZARD_TOOLS: FunctionTool[] = [
  searchTool("search_vendors", "vendor", "vendors"),
  searchTool("search_collections", "collection", "collections"),
  searchTool("search_product_types", "productType", "product types"),
  searchTool("search_tags", "tag", "tags"),
  tool(
    "preview_matching_products",
    "Preview real Shopify products matching proposed cleanup filters, including wildcard values and AND/OR taxonomy joins. This returns a sample and pagination flags, not an invented total count.",
    {
      type: "object",
      additionalProperties: false,
      required: ["filters", "limit"],
      properties: {
        filters: productFiltersParamSchema,
        limit: {
          type: "number",
          description: "Sample size. Use 20 for planning and at most 100.",
        },
      },
    },
  ),
  tool(
    "suggest_cleanup_preset",
    "Classify the merchant goal into one existing cleanup preset and cleanup mode. This does not inspect catalog data.",
    {
      type: "object",
      additionalProperties: false,
      required: ["user_goal"],
      properties: {
        user_goal: { type: "string" },
      },
    },
  ),
  tool(
    "suggest_product_filters",
    "Convert verified catalog values and merchant-described wildcard patterns into product filters and preset details that match the existing cleanup flow. Only use supported filters: q keyword, season, vendors, product types, tags, collection IDs/titles, inventory, updated age, status, and joins. Do not create or suggest product description/body/content filters.",
    {
      type: "object",
      additionalProperties: false,
      required: [
        "cleanup_preset",
        "vendors",
        "product_types",
        "collection_ids",
        "collection_titles",
        "tags",
        "taxonomy_join",
        "vendor_join",
        "product_type_join",
        "tag_join",
        "collection_join",
        "inventory",
        "updated",
        "status",
        "query",
        "season",
      ],
      properties: {
        cleanup_preset: {
          type: "string",
          enum: ["seasonal", "vendor", "oos", "spring", "none"],
        },
        vendors: stringArraySchema,
        product_types: stringArraySchema,
        collection_ids: stringArraySchema,
        collection_titles: stringArraySchema,
        tags: stringArraySchema,
        taxonomy_join: { type: "string", enum: ["and", "or"] },
        vendor_join: { type: "string", enum: ["any", "all"] },
        product_type_join: { type: "string", enum: ["any", "all"] },
        tag_join: { type: "string", enum: ["any", "all"] },
        collection_join: { type: "string", enum: ["any", "all"] },
        inventory: { type: "string" },
        updated: { type: "string" },
        status: { type: "string" },
        query: { type: "string" },
        season: { type: "string" },
      },
    },
  ),
  tool(
    "suggest_redirect_rules",
    "Build redirect rules using the same rule patterns as the existing cleanup flow. Merchant destination instructions override generic preset defaults; for product's first collection use target sameCollection with targetOption firstCollection. Use only verified values in preset_details.",
    {
      type: "object",
      additionalProperties: false,
      required: ["cleanup_preset", "preset_details"],
      properties: {
        cleanup_preset: {
          type: "string",
          enum: ["seasonal", "vendor", "oos", "spring", "none"],
        },
        preset_details: presetDetailsParamSchema,
      },
    },
  ),
  tool(
    "suggest_redirect_targets",
    "Summarize destination targets from a redirect preview. Use this after preview_redirects and before validate_redirect_destinations.",
    {
      type: "object",
      additionalProperties: false,
      required: ["redirect_preview"],
      properties: {
        redirect_preview: {
          type: "array",
          items: redirectPreviewParamSchema,
        },
      },
    },
  ),
  tool(
    "validate_redirect_destinations",
    "Validate proposed redirect destinations against real Shopify catalog/storefront data. This is read-only and does not create redirects.",
    {
      type: "object",
      additionalProperties: false,
      required: ["targets"],
      properties: {
        targets: stringArraySchema,
      },
    },
  ),
  tool(
    "preview_redirects",
    "Load matching products and preview redirect rows using proposed rules. This is read-only and uses the same rule engine as the cleanup review step.",
    {
      type: "object",
      additionalProperties: false,
      required: ["filters", "redirect_rules", "limit"],
      properties: {
        filters: productFiltersParamSchema,
        redirect_rules: {
          type: "array",
          items: redirectRuleParamSchema,
        },
        limit: { type: "number" },
      },
    },
  ),
  tool(
    "estimate_cleanup_impact",
    "Count the previewed redirects, skipped rows, low-confidence rows, and product-operation count for the current sample. Do not extrapolate totals.",
    {
      type: "object",
      additionalProperties: false,
      required: ["cleanup_mode", "redirect_preview"],
      properties: {
        cleanup_mode: {
          type: "string",
          enum: ["redirects", "archive", "delete"],
        },
        redirect_preview: {
          type: "array",
          items: redirectPreviewParamSchema,
        },
      },
    },
  ),
];

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, string>();
  value
    .map((item) => asString(item))
    .filter(Boolean)
    .forEach((item) => {
      const key = item.toLowerCase();
      if (!unique.has(key)) unique.set(key, item);
    });
  return [...unique.values()];
}

function isAiAllCollectionFilterValue(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return normalized === "all" || normalized === "collectionsall";
}

function asCollectionTitleArray(value: unknown) {
  return asStringArray(value).filter(
    (item) => !isAiAllCollectionFilterValue(item),
  );
}

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asCleanupPreset(value: unknown): CleanupPreset {
  const candidate = asString(value);
  return candidate === "seasonal" ||
    candidate === "vendor" ||
    candidate === "oos" ||
    candidate === "spring" ||
    candidate === "none"
    ? candidate
    : "none";
}

function asCleanupMode(value: unknown): CleanupMode {
  const candidate = asString(value);
  return candidate === "archive" ||
    candidate === "delete" ||
    candidate === "redirects"
    ? candidate
    : "archive";
}

function asTaxonomyJoin(value: unknown) {
  return asString(value) === "or" ? "or" : "and";
}

function asTaxonomyValueJoin(value: unknown) {
  return asString(value) === "all" ? "all" : "any";
}

function asProductFilters(
  value: unknown,
  limit?: number,
): CleanupProductFilters {
  const raw = asObject(value);
  return {
    q: asString(raw.q),
    season: asString(raw.season),
    inventory: asString(raw.inventory),
    inventoryValue:
      typeof raw.inventoryValue === "number" ||
      typeof raw.inventoryValue === "string"
        ? raw.inventoryValue
        : "",
    updated: asString(raw.updated),
    vendors: asStringArray(raw.vendors),
    types: asStringArray(raw.types),
    tags: asStringArray(raw.tags),
    collectionIds: asStringArray(raw.collectionIds),
    collectionTitles: asCollectionTitleArray(raw.collectionTitles),
    taxonomyJoin: asTaxonomyJoin(raw.taxonomyJoin),
    vendorJoin: asTaxonomyValueJoin(raw.vendorJoin),
    typeJoin: asTaxonomyValueJoin(raw.typeJoin),
    tagJoin: asTaxonomyValueJoin(raw.tagJoin),
    collectionJoin: asTaxonomyValueJoin(raw.collectionJoin),
    tab: asString(raw.tab) || "all",
    bulk: Boolean(raw.bulk),
    maxProducts: limit ?? asNumber(raw.maxProducts, 100),
    first: Math.min(100, Math.max(20, limit ?? asNumber(raw.maxProducts, 20))),
  };
}

function asPresetDetails(value: unknown): PresetDetails {
  const raw = asObject(value);
  const seasonal = asObject(raw.seasonal);
  const vendor = asObject(raw.vendor);
  const oos = asObject(raw.oos);
  const spring = asObject(raw.spring);

  return {
    seasonal: {
      keywords: asString(seasonal.keywords),
      collectionIds: asStringArray(seasonal.collectionIds),
      collectionTitles: asCollectionTitleArray(seasonal.collectionTitles),
      tags: asStringArray(seasonal.tags),
      inventory: asString(seasonal.inventory),
    },
    vendor: {
      vendors: asStringArray(vendor.vendors),
      productTypes: asStringArray(vendor.productTypes),
    },
    oos: {
      updated: asString(oos.updated),
      productTypes: asStringArray(oos.productTypes),
      tags: asStringArray(oos.tags),
    },
    spring: {
      tags: asStringArray(spring.tags),
      inventory: asString(spring.inventory),
      updated: asString(spring.updated),
      productTypes: asStringArray(spring.productTypes),
    },
  };
}

function asRedirectRules(value: unknown): RedirectRule[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const raw = asObject(item);
    return normalizeRule({
      id: asString(raw.id) || `ai-rule-${index + 1}`,
      field: asString(raw.field) as RedirectRule["field"],
      condition: asString(raw.condition),
      value: asString(raw.value),
      target: asString(raw.target) as RedirectRule["target"],
      targetOption: asString(raw.targetOption),
      targetValue: asString(raw.targetValue),
      enabled: raw.enabled !== false,
      stopOnMatch: raw.stopOnMatch !== false,
    });
  });
}

function productPreview(product: ProductRow) {
  return {
    id: product.id,
    name: product.name,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor,
    productType: product.type,
    inventory: product.inventory,
    collections: product.collections,
    tags: product.tags,
  };
}

function compactPreviewRow(row: GeneratedPreviewRow) {
  return {
    id: row.id,
    name: row.name,
    from: row.from,
    to: row.to,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    status: row.status ?? "",
    via: row.via,
    confidence: row.confidence,
    tone: row.tone,
    originalTo: row.originalTo,
    targetChoice: row.targetChoice,
    customTarget: row.customTarget,
    edited: row.edited,
  };
}

function filtersToSuggestedFilters(
  filters: CleanupProductFilters,
): AiSuggestedFilter[] {
  const normalized = normalizeProductFilters(filters);
  const query = buildShopifyProductQuery(normalized);
  const suggestions: AiSuggestedFilter[] = [];
  const valueOperator = (join: string, wildcard = false) =>
    wildcard
      ? join === "all"
        ? "matches all patterns"
        : "matches any pattern"
      : join === "all"
        ? "matches all"
        : "matches any";
  const hasWildcard = (values: string[]) =>
    values.some((value) => value.includes("*"));
  if (normalized.q) {
    suggestions.push({
      field: "query",
      operator: "contains",
      values: [normalized.q],
      source: "merchant_intent",
      shopifyQueryFragment: normalized.q,
    });
  }
  if (normalized.season) {
    suggestions.push({
      field: "season",
      operator: "contains",
      values: [normalized.season],
      source: "merchant_intent",
      shopifyQueryFragment: normalized.season,
    });
  }
  if (normalized.vendors.length) {
    suggestions.push({
      field: "vendor",
      operator: valueOperator(
        normalized.vendorJoin,
        hasWildcard(normalized.vendors),
      ),
      values: normalized.vendors,
      source: "catalog_lookup",
      shopifyQueryFragment: null,
    });
  }
  if (normalized.types.length) {
    suggestions.push({
      field: "productType",
      operator: valueOperator(
        normalized.typeJoin,
        hasWildcard(normalized.types),
      ),
      values: normalized.types,
      source: "catalog_lookup",
      shopifyQueryFragment: null,
    });
  }
  if (normalized.collectionIds.length || normalized.collectionTitles.length) {
    suggestions.push({
      field: "collection",
      operator: valueOperator(
        normalized.collectionJoin,
        hasWildcard(normalized.collectionTitles),
      ),
      values: [...normalized.collectionIds, ...normalized.collectionTitles],
      source: "catalog_lookup",
      shopifyQueryFragment: null,
    });
  }
  if (normalized.tags.length) {
    suggestions.push({
      field: "tag",
      operator: valueOperator(normalized.tagJoin, hasWildcard(normalized.tags)),
      values: normalized.tags,
      source: "catalog_lookup",
      shopifyQueryFragment: null,
    });
  }
  if (normalized.inventory || normalized.tab === "oos") {
    suggestions.push({
      field: "inventory",
      operator: normalized.inventory || normalized.tab,
      values: [normalized.inventory || normalized.tab],
      source: "merchant_intent",
      shopifyQueryFragment: query.includes("inventory_total") ? query : null,
    });
  }
  if (normalized.updated) {
    suggestions.push({
      field: "updated",
      operator: "older than",
      values: [normalized.updated],
      source: "merchant_intent",
      shopifyQueryFragment: query.includes("updated_at") ? query : null,
    });
  }
  if (["active", "archived", "draft"].includes(normalized.tab)) {
    suggestions.push({
      field: "status",
      operator: "is",
      values: [normalized.tab],
      source: "merchant_intent",
      shopifyQueryFragment: `status:${normalized.tab}`,
    });
  }

  return suggestions;
}

function classifyGoal(userGoal: string): {
  intent: AiCleanupIntent;
  preset: CleanupPreset;
  cleanupMode: CleanupMode;
  confidence: number;
  reason: string;
} {
  const text = userGoal.toLowerCase();
  if (/\bvendor\b|\bbrand\b|\bsupplier\b/.test(text)) {
    return {
      intent: "vendor_exit",
      preset: "vendor",
      cleanupMode: text.includes("delete") ? "delete" : "archive",
      confidence: 0.78,
      reason: "The goal names a vendor, brand, or supplier cleanup.",
    };
  }
  if (/out[- ]?of[- ]?stock|\boos\b|not coming back|sold out/.test(text)) {
    return {
      intent: "out_of_stock_cleanup",
      preset: "oos",
      cleanupMode: text.includes("delete") ? "delete" : "archive",
      confidence: 0.74,
      reason: "The goal is centered on unavailable inventory.",
    };
  }
  if (
    /season|last season|summer|winter|spring|fall|holiday|fw\d|ss\d/.test(text)
  ) {
    return {
      intent: "seasonal_cleanup",
      preset: "seasonal",
      cleanupMode: text.includes("delete") ? "delete" : "archive",
      confidence: 0.7,
      reason: "The goal references seasonal or campaign cleanup.",
    };
  }
  if (/discontinued|retire|retired|archive/.test(text)) {
    return {
      intent: "discontinued_cleanup",
      preset: "spring",
      cleanupMode: text.includes("delete") ? "delete" : "archive",
      confidence: 0.65,
      reason:
        "The goal mentions discontinued or retired products without a specific catalog value.",
    };
  }
  if (/404|broken|dead|redirect/.test(text)) {
    return {
      intent: "unknown",
      preset: "none",
      cleanupMode: "redirects",
      confidence: 0.35,
      reason:
        "The request mentions redirects but does not identify which products should be cleaned up.",
    };
  }
  return {
    intent: "unknown",
    preset: "none",
    cleanupMode: "archive",
    confidence: 0.25,
    reason: "The goal does not map clearly to an existing cleanup preset.",
  };
}

function makeProductFilters(args: JsonObject): {
  filters: CleanupProductFilters;
  presetDetails: PresetDetails;
  suggestedFilters: AiSuggestedFilter[];
} {
  const vendors = asStringArray(args.vendors);
  const productTypes = asStringArray(args.product_types);
  const collectionIds = asStringArray(args.collection_ids);
  const collectionTitles = asCollectionTitleArray(args.collection_titles);
  const tags = asStringArray(args.tags);
  const taxonomyJoin = asTaxonomyJoin(args.taxonomy_join);
  const vendorJoin = asTaxonomyValueJoin(args.vendor_join);
  const typeJoin = asTaxonomyValueJoin(args.product_type_join);
  const tagJoin = asTaxonomyValueJoin(args.tag_join);
  const collectionJoin = asTaxonomyValueJoin(args.collection_join);
  const inventory = asString(args.inventory);
  const updated = asString(args.updated);
  const status = asString(args.status);
  const query = asString(args.query);
  const season = asString(args.season);
  const tab = status || productScopeForInventory(inventory);
  const normalizedInventory = inventory;

  const filters: CleanupProductFilters = {
    q: query,
    season,
    inventory: productFilterInventoryValue(normalizedInventory),
    inventoryValue: "",
    updated,
    vendors,
    types: productTypes,
    tags,
    collectionIds,
    collectionTitles,
    taxonomyJoin,
    vendorJoin,
    typeJoin,
    tagJoin,
    collectionJoin,
    tab,
    bulk: true,
    maxProducts: 100,
  };

  const presetDetails: PresetDetails = {
    seasonal: {
      keywords: season || collectionTitles.join(", ") || tags.join(", "),
      collectionIds,
      collectionTitles,
      tags,
      inventory: normalizedInventory,
    },
    vendor: {
      vendors,
      productTypes,
    },
    oos: {
      updated,
      productTypes,
      tags,
    },
    spring: {
      tags,
      inventory: normalizedInventory,
      updated,
      productTypes,
    },
  };

  return {
    filters,
    presetDetails,
    suggestedFilters: filtersToSuggestedFilters(filters),
  };
}

function targetKind(target: string, choice?: string) {
  if (!target || choice === "skip") return "skip";
  if (/^https?:\/\//i.test(target)) return "external";
  if (target === "/") return "homepage";
  if (target === "/collections/all") return "all_products";
  if (target.startsWith("/collections/")) return "collection";
  if (target.startsWith("/search")) return "search";
  if (target.startsWith("/")) return "custom_path";
  return "unknown";
}

function summarizeTargets(
  preview: Pick<
    GeneratedPreviewRow,
    "to" | "confidence" | "via" | "targetChoice"
  >[],
) {
  const grouped = new Map<
    string,
    {
      target: string;
      confidence: "High" | "Medium" | "Low";
      reasons: string[];
      choice: string;
    }
  >();
  for (const row of preview) {
    const key = row.to || "__skip__";
    const existing = grouped.get(key);
    if (existing) {
      if (existing.confidence !== "Low" && row.confidence === "Low")
        existing.confidence = "Low";
      if (existing.confidence === "High" && row.confidence === "Medium")
        existing.confidence = "Medium";
      existing.reasons.push(row.via);
      continue;
    }
    grouped.set(key, {
      target: row.to,
      confidence: row.confidence,
      reasons: [row.via],
      choice: row.targetChoice,
    });
  }

  return [...grouped.values()].map((item) => ({
    target: item.target,
    targetKind: targetKind(item.target, item.choice),
    confidence: item.confidence,
    reason: `Suggested by ${Array.from(new Set(item.reasons)).join(", ")} rule preview.`,
    validationStatus: item.target ? "unchecked" : "skipped",
    validationReason: item.target
      ? "Destination has not been validated yet."
      : "No redirect will be created for skipped rows.",
  }));
}

function asPreviewRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const raw = asObject(item);
    return {
      id: asString(raw.id),
      name: asString(raw.name),
      from: asString(raw.from),
      to: asString(raw.to),
      via: asString(raw.via),
      confidence:
        raw.confidence === "High" ||
        raw.confidence === "Medium" ||
        raw.confidence === "Low"
          ? raw.confidence
          : "Low",
      targetChoice: asString(raw.targetChoice),
    };
  });
}

async function handleSearch(
  context: AiToolContext,
  args: JsonObject,
  kind: CatalogLookupKind,
  toolName: string,
): Promise<AiWizardToolResult> {
  const query = asString(args.query);
  const lookupQuery = query.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  const limit = Math.min(20, Math.max(1, asNumber(args.limit, 10)));
  const options = await loadCatalogLookupOptions(
    context.admin,
    kind,
    lookupQuery || query,
  );
  return {
    ok: true,
    tool: toolName,
    data: {
      kind,
      query,
      options: options.slice(0, limit),
    },
  };
}

export async function runAiWizardTool(
  context: AiToolContext,
  name: string,
  rawArgs: unknown,
): Promise<AiWizardToolResult> {
  const args = asObject(rawArgs);

  try {
    if (name === "search_vendors") {
      return handleSearch(context, args, "vendor", name);
    }
    if (name === "search_collections") {
      return handleSearch(context, args, "collection", name);
    }
    if (name === "search_product_types") {
      return handleSearch(context, args, "productType", name);
    }
    if (name === "search_tags") {
      return handleSearch(context, args, "tag", name);
    }

    if (name === "suggest_cleanup_preset") {
      const suggestion = classifyGoal(asString(args.user_goal));
      return { ok: true, tool: name, data: suggestion };
    }

    if (name === "suggest_product_filters") {
      return { ok: true, tool: name, data: makeProductFilters(args) };
    }

    if (name === "preview_matching_products") {
      const limit = Math.min(100, Math.max(1, asNumber(args.limit, 20)));
      const filters = asProductFilters(args.filters, limit);
      const result = await loadProductsForCleanup(context.admin, {
        ...filters,
        bulk: true,
        maxProducts: limit,
        first: Math.min(100, Math.max(20, limit)),
      });
      return {
        ok: true,
        tool: name,
        data: {
          filters: result.filters,
          shopifyQuery: result.query,
          sortKey: result.sortKey,
          estimatedTotal: null,
          sampledCount: result.products.length,
          bulkLimited: result.bulkLimited || result.pageInfo.hasNextPage,
          products: result.products.slice(0, limit).map(productPreview),
        },
      };
    }

    if (name === "suggest_redirect_rules") {
      const cleanupPreset = asCleanupPreset(args.cleanup_preset);
      const presetDetails = asPresetDetails(args.preset_details);
      const rules =
        cleanupPreset === "none"
          ? []
          : rulesForPreset(cleanupPreset, { presetDetails }).map(normalizeRule);
      return {
        ok: true,
        tool: name,
        data: {
          cleanupPreset,
          presetDetails,
          rules,
        },
      };
    }

    if (name === "preview_redirects") {
      const limit = Math.min(100, Math.max(1, asNumber(args.limit, 20)));
      const filters = asProductFilters(args.filters, limit);
      const rules = asRedirectRules(args.redirect_rules);
      const products = await loadProductsForCleanup(context.admin, {
        ...filters,
        bulk: true,
        maxProducts: limit,
        first: Math.min(100, Math.max(20, limit)),
      });
      const preview = buildPreviewRows(products.products, rules).slice(
        0,
        limit,
      );
      return {
        ok: true,
        tool: name,
        data: {
          filters: products.filters,
          shopifyQuery: products.query,
          estimatedTotal: null,
          sampledCount: products.products.length,
          bulkLimited: products.bulkLimited || products.pageInfo.hasNextPage,
          products: products.products.map(productPreview),
          redirectPreview: preview.map(compactPreviewRow),
          targets: summarizeTargets(preview),
        },
      };
    }

    if (name === "suggest_redirect_targets") {
      const preview = asPreviewRows(args.redirect_preview);
      return {
        ok: true,
        tool: name,
        data: {
          targets: summarizeTargets(
            preview as Pick<
              GeneratedPreviewRow,
              "to" | "confidence" | "via" | "targetChoice"
            >[],
          ),
        },
      };
    }

    if (name === "validate_redirect_destinations") {
      const targets = asStringArray(args.targets);
      const validation = await validateRedirectTargetsForShop({
        admin: context.admin,
        shop: context.shop,
        targets,
      });
      return {
        ok: true,
        tool: name,
        data: validation,
      };
    }

    if (name === "estimate_cleanup_impact") {
      const cleanupMode = asCleanupMode(args.cleanup_mode);
      const preview = asPreviewRows(args.redirect_preview);
      const activeRows = preview.filter(
        (row) => row.targetChoice !== "skip" && row.to,
      );
      const skippedRows = preview.length - activeRows.length;
      const lowConfidence = activeRows.filter(
        (row) => row.confidence === "Low",
      ).length;
      const sourceCounts = new Map<string, number>();
      for (const row of activeRows) {
        sourceCounts.set(row.from, (sourceCounts.get(row.from) ?? 0) + 1);
      }
      const conflicts = [...sourceCounts.values()].filter(
        (count) => count > 1,
      ).length;

      return {
        ok: true,
        tool: name,
        data: {
          cleanupMode,
          sampleSize: preview.length,
          redirectsPreviewed: activeRows.length,
          productsChangedPreviewed:
            cleanupMode === "redirects" ? 0 : activeRows.length,
          skippedRows,
          lowConfidence,
          conflicts,
          estimatedTotalProducts: null,
          estimatedTotalRedirects: null,
          note: "Counts are exact for the preview sample only. The tool does not extrapolate full-catalog totals.",
        },
      };
    }

    return {
      ok: false,
      tool: name,
      error: `Unknown AI wizard tool: ${name}`,
    };
  } catch (error) {
    return {
      ok: false,
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
