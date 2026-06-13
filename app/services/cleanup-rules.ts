export type ProductRow = {
  id: string;
  name: string;
  handle: string;
  status: "active" | "archived" | "draft";
  vendor: string;
  type: string;
  inventory: number | null;
  sku: string;
  imageUrl: string;
  imageAlt: string;
  collections: string[];
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type CleanupPreset = "seasonal" | "vendor" | "oos" | "spring" | "none";
export type CleanupMode = "redirects" | "archive" | "delete";
export type ConfigurablePreset = Exclude<CleanupPreset, "none">;

export type PresetDetails = {
  seasonal: {
    keywords: string;
    collectionIds: string[];
    collectionTitles: string[];
    tags: string[];
    inventory: string;
  };
  vendor: {
    vendors: string[];
    productTypes: string[];
  };
  oos: {
    updated: string;
    productTypes: string[];
    tags: string[];
  };
  spring: {
    tags: string[];
    inventory: string;
    updated: string;
    productTypes: string[];
  };
};

export type RuleField =
  | "collection"
  | "vendor"
  | "productType"
  | "tag"
  | "status"
  | "inventory"
  | "sku"
  | "titleHandle"
  | "price"
  | "age"
  | "fallback";

export type RuleTarget =
  | "sameCollection"
  | "bestSiblingProduct"
  | "productTypeCollection"
  | "vendorCollection"
  | "tagCollection"
  | "searchResults"
  | "allProducts"
  | "customPath"
  | "homepage"
  | "noRedirect";

export type RedirectRule = {
  id: string;
  field: RuleField;
  condition: string;
  value: string;
  target: RuleTarget;
  targetOption: string;
  targetValue: string;
  enabled: boolean;
  stopOnMatch: boolean;
};

export type PreviewTargetChoice =
  | "suggested"
  | "sameCollection"
  | "vendorCollection"
  | "productTypeCollection"
  | "search"
  | "allProducts"
  | "homepage"
  | "custom"
  | "skip";

export type GeneratedPreviewRow = {
  id: string;
  name: string;
  from: string;
  to: string;
  imageUrl: string;
  imageAlt: string;
  status?: ProductRow["status"];
  via: string;
  confidence: "High" | "Medium" | "Low";
  tone: "success" | "info" | "warning";
  originalTo: string;
  targetChoice: PreviewTargetChoice;
  customTarget: string;
  edited: boolean;
};

type RuleRedirectExample = {
  productName: string;
  source: string;
  target: string;
};

export const DEFAULT_PRESET_DETAILS: PresetDetails = {
  seasonal: {
    keywords: "",
    collectionIds: [],
    collectionTitles: [],
    tags: [],
    inventory: "out",
  },
  vendor: {
    vendors: [],
    productTypes: [],
  },
  oos: {
    updated: "180d",
    productTypes: [],
    tags: [],
  },
  spring: {
    tags: [],
    inventory: "low",
    updated: "180d",
    productTypes: [],
  },
};

export const RULE_FIELD_OPTIONS: { label: string; value: RuleField }[] = [
  { label: "Collection", value: "collection" },
  { label: "Vendor", value: "vendor" },
  { label: "Product type", value: "productType" },
  { label: "Tag", value: "tag" },
  { label: "Product status", value: "status" },
  { label: "Inventory level", value: "inventory" },
  { label: "SKU", value: "sku" },
  { label: "Title or handle", value: "titleHandle" },
  { label: "Price", value: "price" },
  { label: "Product age", value: "age" },
  { label: "Fallback", value: "fallback" },
];

const FIELD_CONFIG: Record<
  RuleField,
  {
    conditions: { label: string; value: string }[];
    options?: { label: string; value: string }[];
    valuesDisabled?: boolean;
  }
> = {
  collection: {
    conditions: [
      { label: "is one of", value: "in" },
      { label: "is not one of", value: "notIn" },
      { label: "contains", value: "contains" },
      { label: "does not contain", value: "notContains" },
      { label: "starts with", value: "startsWith" },
      { label: "is empty", value: "empty" },
    ],
  },
  vendor: {
    conditions: [
      { label: "is one of", value: "in" },
      { label: "is not one of", value: "notIn" },
      { label: "contains", value: "contains" },
      { label: "starts with", value: "startsWith" },
      { label: "is empty", value: "empty" },
    ],
  },
  productType: {
    conditions: [
      { label: "is one of", value: "in" },
      { label: "is not one of", value: "notIn" },
      { label: "contains", value: "contains" },
      { label: "starts with", value: "startsWith" },
      { label: "is empty", value: "empty" },
    ],
  },
  tag: {
    conditions: [
      { label: "has any of", value: "hasAny" },
      { label: "has all of", value: "hasAll" },
      { label: "does not have", value: "notIn" },
      { label: "contains text", value: "contains" },
      { label: "has no tags", value: "empty" },
    ],
  },
  status: {
    conditions: [
      { label: "is", value: "equals" },
      { label: "is not", value: "notEquals" },
    ],
    options: [
      { label: "Active", value: "active" },
      { label: "Draft", value: "draft" },
      { label: "Archived", value: "archived" },
    ],
  },
  inventory: {
    conditions: [
      { label: "is zero", value: "zero" },
      { label: "is less than", value: "lessThan" },
      { label: "is less than or equal to", value: "lessThanOrEqual" },
      { label: "is greater than", value: "greaterThan" },
      { label: "is between", value: "between" },
      { label: "is not tracked", value: "notTracked" },
    ],
  },
  sku: {
    conditions: [
      { label: "starts with", value: "startsWith" },
      { label: "contains", value: "contains" },
      { label: "is one of", value: "in" },
      { label: "is empty", value: "empty" },
    ],
  },
  titleHandle: {
    conditions: [
      { label: "contains", value: "contains" },
      { label: "does not contain", value: "notContains" },
      { label: "starts with", value: "startsWith" },
      { label: "ends with", value: "endsWith" },
      { label: "matches pattern", value: "matches" },
    ],
  },
  price: {
    conditions: [
      { label: "is less than", value: "lessThan" },
      { label: "is less than or equal to", value: "lessThanOrEqual" },
      { label: "is greater than", value: "greaterThan" },
      { label: "is between", value: "between" },
    ],
  },
  age: {
    conditions: [
      { label: "created more than days ago", value: "createdOlderThan" },
      { label: "created less than days ago", value: "createdNewerThan" },
      { label: "not updated in days", value: "notUpdatedIn" },
      { label: "published before date", value: "publishedBefore" },
      { label: "published after date", value: "publishedAfter" },
    ],
  },
  fallback: {
    conditions: [{ label: "matches anything else", value: "anything" }],
    valuesDisabled: true,
  },
};

const TARGET_CONFIG: Record<
  RuleTarget,
  {
    options?: { label: string; value: string }[];
    needsValue?: boolean;
  }
> = {
  bestSiblingProduct: {
    options: [
      { label: "Product's collection, then product type", value: "collectionTypeVendor" },
      { label: "Product type collection", value: "typeCollection" },
      { label: "Search by product type", value: "vendorType" },
      { label: "Product's collection", value: "inventoryCollection" },
      { label: "Product's collection", value: "newestCollection" },
      { label: "Product's collection", value: "closestPrice" },
    ],
  },
  sameCollection: {
    options: [
      { label: "Product's first collection", value: "firstCollection" },
      { label: "Product's last collection", value: "lastCollection" },
      { label: "Collection matched by this rule", value: "matchedCollection" },
    ],
  },
  productTypeCollection: {
    options: [
      { label: "/collections/[product-type]", value: "typeHandle" },
      { label: "Custom product type pattern", value: "customPattern" },
    ],
  },
  vendorCollection: {
    options: [
      { label: "/collections/[vendor]", value: "vendorHandle" },
      { label: "Custom vendor pattern", value: "customPattern" },
    ],
  },
  tagCollection: {
    options: [
      { label: "/collections/[first rule tag]", value: "tagHandle" },
      { label: "/collections/[matched product tag]", value: "matchedTagHandle" },
      { label: "/collections/[first product tag]", value: "firstProductTag" },
      { label: "Custom tag pattern", value: "customPattern" },
    ],
  },
  searchResults: {
    options: [
      { label: "Product type", value: "productType" },
      { label: "Vendor", value: "vendor" },
      { label: "Product's first collection", value: "collection" },
      { label: "Product title keywords", value: "productTitle" },
      { label: "Product SKU", value: "sku" },
      { label: "Product's first tag", value: "tag" },
      { label: "Custom search term", value: "custom" },
    ],
  },
  allProducts: {
    options: [
      { label: "/collections/all", value: "collectionsAll" },
      { label: "Storefront search page", value: "searchAll" },
      { label: "Custom catalog path", value: "customCatalogPath" },
    ],
  },
  customPath: {
    options: [
      { label: "Manual storefront path", value: "manualPath" },
      { label: "Variable storefront path", value: "variablePath" },
      { label: "External URL", value: "externalUrl" },
    ],
    needsValue: true,
  },
  homepage: {
    options: [{ label: "/", value: "root" }],
  },
  noRedirect: {},
};

export const DEFAULT_RULES: RedirectRule[] = [
  {
    id: "collection-season",
    field: "collection",
    condition: "in",
    value: "SS24, FW23, Sale",
    target: "sameCollection",
    targetOption: "firstCollection",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  },
  {
    id: "vendor-type",
    field: "vendor",
    condition: "in",
    value: "Discontinued vendor",
    target: "productTypeCollection",
    targetOption: "typeHandle",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  },
  {
    id: "out-of-stock",
    field: "inventory",
    condition: "zero",
    value: "",
    target: "productTypeCollection",
    targetOption: "typeHandle",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  },
  {
    id: "clearance-tag",
    field: "tag",
    condition: "hasAny",
    value: "clearance, discontinued",
    target: "tagCollection",
    targetOption: "tagHandle",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  },
  {
    id: "fallback",
    field: "fallback",
    condition: "anything",
    value: "",
    target: "allProducts",
    targetOption: "collectionsAll",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  },
];

const SEASON_SIGNALS = [
  "fw2",
  "fw 2",
  "fw-",
  "fall",
  "winter",
  "holiday",
  "ss2",
  "ss 2",
  "ss-",
  "spring",
  "summer",
  "season",
  "sale",
  "clearance",
  "discontinued",
  "final",
];

const CLEARANCE_SIGNALS = [
  "clearance",
  "sale",
  "final",
  "discontinued",
  "outlet",
  "archive",
];

function optionLabel<T extends string>(options: { label: string; value: T }[], value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function splitRuleInputValues(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function compactValueList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function compactValues(values: string[]) {
  return compactValueList(values).join(", ");
}

function uniqueRuleValues(values: string[]) {
  const seen = new Set<string>();
  return compactValueList(values).filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSortedValues(values: string[]) {
  const unique = new Map<string, string>();
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });

  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

function splitPresetTextValues(value: string) {
  return uniqueSortedValues(splitRuleInputValues(value));
}

function valuesOrFallback(values: string[], fallback: string) {
  const compact = compactValueList(values);
  return compact.length ? compact : splitPresetTextValues(fallback);
}

function updatedDays(value: string) {
  if (value === "90d") return "90";
  if (value === "180d") return "180";
  if (value === "365d") return "365";
  return "";
}

function inventoryRule(value: string) {
  if (!value) return null;
  if (value === "out") return { condition: "zero", value: "" };
  if (value === "available") return { condition: "greaterThan", value: "0" };
  if (value === "low") return { condition: "lessThan", value: "5" };
  if (value === "healthy") return { condition: "greaterThan", value: "4" };
  if (value === "overstock") return { condition: "greaterThan", value: "99" };
  return null;
}

function mostCommonValue(values: string[]) {
  const counts = new Map<string, number>();
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function seasonValueFromProducts(products: ProductRow[]) {
  return (
    mostCommonValue(
      products.flatMap((product) =>
        [...product.collections, ...product.tags].filter((value) => {
          const normalized = value.toLowerCase();
          return SEASON_SIGNALS.some((signal) => normalized.includes(signal));
        }),
      ),
    ) || mostCommonValue(products.flatMap((product) => product.collections))
  );
}

function clearanceValueFromProducts(products: ProductRow[]) {
  return mostCommonValue(
    products.flatMap((product) =>
      product.tags.filter((tag) => {
        const normalized = tag.toLowerCase();
        return CLEARANCE_SIGNALS.some((signal) => normalized.includes(signal));
      }),
    ),
  );
}

function exampleVendorFromProducts(products: ProductRow[]) {
  return mostCommonValue(products.map((product) => product.vendor));
}

function exampleTypeFromProducts(products: ProductRow[]) {
  return mostCommonValue(products.map((product) => product.type));
}

function defaultTargetValueForOption(target: RuleTarget, targetOption: string) {
  if (target === "productTypeCollection" && targetOption === "customPattern") {
    return "/collections/{productType}";
  }
  if (target === "vendorCollection" && targetOption === "customPattern") {
    return "/collections/{vendor}";
  }
  if (target === "tagCollection" && targetOption === "customPattern") {
    return "/collections/{matchedTag}";
  }
  if (target === "allProducts" && targetOption === "customCatalogPath") {
    return "/collections/all";
  }
  return "";
}

function targetNeedsValue(target: RuleTarget, targetOption: string) {
  if (TARGET_CONFIG[target].needsValue) return true;
  if (target === "searchResults" && targetOption === "custom") return true;
  if (
    ["productTypeCollection", "vendorCollection", "tagCollection"].includes(target) &&
    targetOption === "customPattern"
  ) {
    return true;
  }
  return target === "allProducts" && targetOption === "customCatalogPath";
}

export function normalizeRuleTarget(rule: RedirectRule): RedirectRule {
  if (rule.target === "bestSiblingProduct") {
    if (rule.targetOption === "typeCollection") {
      return {
        ...rule,
        target: "productTypeCollection",
        targetOption: "typeHandle",
      };
    }

    if (rule.targetOption === "vendorType") {
      return {
        ...rule,
        target: "searchResults",
        targetOption: "productType",
      };
    }

    return {
      ...rule,
      target: "sameCollection",
      targetOption: "firstCollection",
    };
  }

  if (rule.target === "searchResults" && rule.targetOption === "titleKeywords") {
    return {
      ...rule,
      targetOption: "productTitle",
    };
  }

  if (rule.target === "customPath" && rule.targetOption === "path") {
    return {
      ...rule,
      targetOption: "manualPath",
    };
  }

  return rule;
}

export function normalizeRule(rule: RedirectRule): RedirectRule {
  const normalizedTargetRule = normalizeRuleTarget(rule);
  const fieldConfig = FIELD_CONFIG[normalizedTargetRule.field];
  const condition = fieldConfig.conditions.some(
    (option) => option.value === normalizedTargetRule.condition,
  )
    ? normalizedTargetRule.condition
    : fieldConfig.conditions[0].value;
  const value =
    fieldConfig.valuesDisabled || isValueDisabled({ ...normalizedTargetRule, condition })
      ? ""
      : fieldConfig.options &&
          !fieldConfig.options.some((option) => option.value === normalizedTargetRule.value)
        ? fieldConfig.options[0].value
        : normalizedTargetRule.value;

  const targetOptions = TARGET_CONFIG[normalizedTargetRule.target].options ?? [];
  const targetOption = targetOptions.some(
    (option) => option.value === normalizedTargetRule.targetOption,
  )
    ? normalizedTargetRule.targetOption
    : targetOptions[0]?.value ?? "";
  const needsTargetValue = targetNeedsValue(normalizedTargetRule.target, targetOption);

  return {
    ...normalizedTargetRule,
    condition,
    value,
    targetOption,
    targetValue: needsTargetValue
      ? normalizedTargetRule.targetValue ||
        defaultTargetValueForOption(normalizedTargetRule.target, targetOption)
      : "",
  };
}

function isValueDisabled(rule: Pick<RedirectRule, "condition">) {
  return ["empty", "zero", "notTracked", "anything"].includes(rule.condition);
}

function ruleTemplate(
  patch: Partial<RedirectRule> &
    Pick<RedirectRule, "id" | "field" | "condition" | "target" | "targetOption">,
): RedirectRule {
  return normalizeRule({
    value: "",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
    ...patch,
  });
}

function rulesFromValues({
  idPrefix,
  field,
  condition,
  values,
  target,
  targetOption,
}: {
  idPrefix: string;
  field: RuleField;
  condition: string;
  values: string[];
  target: RuleTarget;
  targetOption: string;
}) {
  return uniqueRuleValues(values).map((value, index) =>
    ruleTemplate({
      id: `${idPrefix}-${index + 1}`,
      field,
      condition,
      value,
      target,
      targetOption,
    }),
  );
}

export function rulesForPreset(
  preset: CleanupPreset,
  context: {
    selectedProducts?: ProductRow[];
    presetDetails?: PresetDetails;
  } = {},
): RedirectRule[] {
  const products = context.selectedProducts ?? [];
  const presetDetails = context.presetDetails ?? DEFAULT_PRESET_DETAILS;
  const vendorExample = exampleVendorFromProducts(products) || "Vendor to retire";
  const typeExample = exampleTypeFromProducts(products) || "Product type to retire";
  const seasonalDetails = presetDetails.seasonal;
  const vendorDetails = presetDetails.vendor;
  const oosDetails = presetDetails.oos;
  const springDetails = presetDetails.spring;
  const seasonExample =
    compactValues([
      seasonalDetails.keywords,
      compactValues(seasonalDetails.collectionTitles),
      compactValues(seasonalDetails.tags),
    ]) ||
    seasonValueFromProducts(products) ||
    "FW24, SS24, clearance";
  const seasonalCollectionValues = valuesOrFallback(
    seasonalDetails.collectionTitles,
    seasonalDetails.keywords || seasonExample,
  );
  const seasonalTagValues = valuesOrFallback(
    seasonalDetails.tags,
    seasonalDetails.keywords || seasonExample,
  );
  const vendorRuleValues = valuesOrFallback(vendorDetails.vendors, vendorExample);
  const vendorTypeValues = valuesOrFallback(vendorDetails.productTypes, typeExample);
  const oosTypeValues = valuesOrFallback(oosDetails.productTypes, typeExample);
  const oosTagValue =
    compactValues(oosDetails.tags) ||
    clearanceValueFromProducts(products) ||
    "discontinued, final-sale";
  const oosTagValues = valuesOrFallback(oosDetails.tags, oosTagValue);
  const oosUpdatedDays = updatedDays(oosDetails.updated);
  const springTagValue =
    compactValues(springDetails.tags) ||
    clearanceValueFromProducts(products) ||
    "clearance, final-sale, discontinued";
  const springTagValues = valuesOrFallback(springDetails.tags, springTagValue);
  const springTypeValues = valuesOrFallback(springDetails.productTypes, typeExample);
  const springUpdatedDays = updatedDays(springDetails.updated);
  const springInventoryRule = inventoryRule(springDetails.inventory);

  if (preset === "none") return DEFAULT_RULES.map((rule) => ({ ...rule }));

  if (preset === "seasonal") {
    return [
      ...rulesFromValues({
        idPrefix: "seasonal-collection",
        field: "collection",
        condition: "contains",
        values: seasonalCollectionValues,
        target: "sameCollection",
        targetOption: "matchedCollection",
      }),
      ...rulesFromValues({
        idPrefix: "seasonal-tag",
        field: "tag",
        condition: "contains",
        values: seasonalTagValues,
        target: "tagCollection",
        targetOption: "tagHandle",
      }),
      ruleTemplate({
        id: "seasonal-type-backstop",
        field: "productType",
        condition: "in",
        value: typeExample,
        target: "productTypeCollection",
        targetOption: "typeHandle",
      }),
      ruleTemplate({
        id: "seasonal-fallback-search-title",
        field: "fallback",
        condition: "anything",
        target: "searchResults",
        targetOption: "productTitle",
      }),
    ];
  }

  if (preset === "vendor") {
    return [
      ...rulesFromValues({
        idPrefix: "vendor-exit-primary",
        field: "vendor",
        condition: "in",
        values: vendorRuleValues,
        target: "productTypeCollection",
        targetOption: "typeHandle",
      }),
      ...rulesFromValues({
        idPrefix: "vendor-exit-product-type",
        field: "productType",
        condition: "in",
        values: vendorTypeValues,
        target: "productTypeCollection",
        targetOption: "typeHandle",
      }),
      ruleTemplate({
        id: "vendor-exit-fallback",
        field: "fallback",
        condition: "anything",
        target: "allProducts",
        targetOption: "collectionsAll",
      }),
    ];
  }

  if (preset === "oos") {
    return [
      ruleTemplate({
        id: "oos-primary",
        field: "inventory",
        condition: "zero",
        target: "sameCollection",
        targetOption: "firstCollection",
      }),
      ...rulesFromValues({
        idPrefix: "oos-type-collection",
        field: "productType",
        condition: "in",
        values: oosTypeValues,
        target: "productTypeCollection",
        targetOption: "typeHandle",
      }),
      ...(oosUpdatedDays
        ? [
            ruleTemplate({
              id: "oos-stale-products",
              field: "age",
              condition: "notUpdatedIn",
              value: oosUpdatedDays,
              target: "productTypeCollection",
              targetOption: "typeHandle",
            }),
          ]
        : []),
      ...rulesFromValues({
        idPrefix: "oos-lifecycle-tag",
        field: "tag",
        condition: "contains",
        values: oosTagValues,
        target: "tagCollection",
        targetOption: "tagHandle",
      }),
      ruleTemplate({
        id: "oos-fallback-search-title",
        field: "fallback",
        condition: "anything",
        target: "searchResults",
        targetOption: "productTitle",
      }),
    ];
  }

  return [
    ...rulesFromValues({
      idPrefix: "spring-clearance-tag",
      field: "tag",
      condition: "contains",
      values: springTagValues,
      target: "tagCollection",
      targetOption: "tagHandle",
    }),
    ...(springInventoryRule
      ? [
          ruleTemplate({
            id: "spring-inventory-scope",
            field: "inventory",
            condition: springInventoryRule.condition,
            value: springInventoryRule.value,
            target: "sameCollection",
            targetOption: "firstCollection",
          }),
        ]
      : []),
    ...(springUpdatedDays
      ? [
          ruleTemplate({
            id: "spring-stale-products",
            field: "age",
            condition: "notUpdatedIn",
            value: springUpdatedDays,
            target: "productTypeCollection",
            targetOption: "typeHandle",
          }),
        ]
      : []),
    ...rulesFromValues({
      idPrefix: "spring-type-collection",
      field: "productType",
      condition: "in",
      values: springTypeValues,
      target: "productTypeCollection",
      targetOption: "typeHandle",
    }),
    ruleTemplate({
      id: "spring-fallback-search-title",
      field: "fallback",
      condition: "anything",
      target: "searchResults",
      targetOption: "productTitle",
    }),
  ];
}

export function slugifyPathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isExternalRedirectDestination(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeGeneratedDestination(value: string, fallback = "/collections/all") {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (isExternalRedirectDestination(trimmed)) return trimmed;

  return (trimmed.startsWith("/") ? trimmed : `/${trimmed}`).replace(/\/{2,}/g, "/");
}

function firstRuleValue(rule: RedirectRule) {
  return splitRuleInputValues(rule.value)[0] ?? "";
}

function parseRuleValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function valueMatches(values: string[], candidate: string, condition: string) {
  const normalized = candidate.toLowerCase();

  switch (condition) {
    case "in":
    case "hasAny":
      return values.some((value) => normalized === value);
    case "notIn":
      return values.every((value) => normalized !== value);
    case "contains":
      return values.some((value) => normalized.includes(value));
    case "notContains":
      return values.every((value) => !normalized.includes(value));
    case "startsWith":
      return values.some((value) => normalized.startsWith(value));
    case "endsWith":
      return values.some((value) => normalized.endsWith(value));
    case "equals":
      return values.some((value) => normalized === value);
    case "notEquals":
      return values.every((value) => normalized !== value);
    case "matches":
      return values.some((value) => {
        try {
          return new RegExp(value, "i").test(candidate);
        } catch {
          return false;
        }
      });
    default:
      return false;
  }
}

function matchedCollectionForRule(product: ProductRow, rule: RedirectRule) {
  if (rule.field !== "collection" || !rule.value.trim()) return "";

  const values = parseRuleValues(rule.value);
  return (
    product.collections.find((collection) =>
      valueMatches(values, collection, rule.condition),
    ) ?? ""
  );
}

function matchedTagForRule(product: ProductRow, rule: RedirectRule) {
  if (rule.field !== "tag" || !rule.value.trim()) return "";

  const values = parseRuleValues(rule.value);
  return (
    product.tags.find((tag) =>
      values.some(
        (value) =>
          tag.toLowerCase() === value ||
          tag.toLowerCase().includes(value) ||
          value.includes(tag.toLowerCase()),
      ),
    ) ?? ""
  );
}

function firstSkuPart(product: ProductRow) {
  return product.sku.split(",")[0]?.trim() ?? product.sku;
}

function getProductTitleSearchQuery(name: string) {
  return name.split(/\s(?:-|\u2013|\u2014)\s/)[0].trim() || name.trim();
}

function targetVariableValues(
  product: ProductRow,
  rule: RedirectRule,
  { slugValues = true }: { slugValues?: boolean } = {},
) {
  const firstCollection = product.collections[0] ?? "";
  const lastCollection = product.collections.at(-1) ?? "";
  const matchedCollection = matchedCollectionForRule(product, rule) || firstCollection;
  const firstTag = product.tags[0] ?? "";
  const matchedTag = matchedTagForRule(product, rule) || firstRuleValue(rule) || firstTag;
  const values: Record<string, string> = {
    productHandle: product.handle,
    productTitle: getProductTitleSearchQuery(product.name),
    productType: product.type,
    vendor: product.vendor,
    firstCollection,
    lastCollection,
    matchedCollection,
    firstTag,
    matchedTag,
    sku: firstSkuPart(product),
  };

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      slugValues ? slugifyPathPart(value) : value.trim(),
    ]),
  ) as Record<string, string>;
}

function interpolateTargetTemplate(
  template: string,
  product: ProductRow,
  rule: RedirectRule,
  options?: { slugValues?: boolean },
) {
  const variables = targetVariableValues(product, rule, options);

  return Object.entries(variables).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template.trim(),
  );
}

function destinationFromPattern(
  pattern: string,
  product: ProductRow,
  rule: RedirectRule,
  fallback = "/collections/all",
) {
  return normalizeGeneratedDestination(
    interpolateTargetTemplate(pattern, product, rule),
    fallback,
  );
}

function collectionForRuleTarget(product: ProductRow, rule: RedirectRule) {
  switch (rule.targetOption) {
    case "lastCollection":
      return product.collections.at(-1) ?? "";
    case "matchedCollection":
      return matchedCollectionForRule(product, rule) || product.collections[0] || "";
    case "firstCollection":
    default:
      return product.collections[0] ?? "";
  }
}

function tagForRuleTarget(product: ProductRow, rule: RedirectRule) {
  switch (rule.targetOption) {
    case "matchedTagHandle":
      return matchedTagForRule(product, rule) || firstRuleValue(rule) || product.tags[0] || "";
    case "firstProductTag":
      return product.tags[0] ?? "";
    case "tagHandle":
    default:
      return firstRuleValue(rule) || matchedTagForRule(product, rule) || product.tags[0] || "";
  }
}

export function targetForRule(product: ProductRow, rule: RedirectRule | null) {
  if (!rule) return "/collections/all";

  switch (rule.target) {
    case "sameCollection": {
      const collection = collectionForRuleTarget(product, rule);
      return collection ? `/collections/${slugifyPathPart(collection)}` : "/collections/all";
    }
    case "bestSiblingProduct":
      if (rule.targetOption === "vendorType" && product.vendor && product.type) {
        return `/search?q=${encodeURIComponent(`${product.vendor} ${product.type}`)}`;
      }
      if (rule.targetOption === "typeCollection" && product.type) {
        return `/collections/${slugifyPathPart(product.type)}`;
      }
      if (product.collections[0]) {
        return `/collections/${slugifyPathPart(product.collections[0])}`;
      }
      return product.type ? `/collections/${slugifyPathPart(product.type)}` : "/collections/all";
    case "productTypeCollection":
      if (rule.targetOption === "customPattern") {
        return destinationFromPattern(
          rule.targetValue || "/collections/{productType}",
          product,
          rule,
        );
      }
      return product.type ? `/collections/${slugifyPathPart(product.type)}` : "/collections/all";
    case "vendorCollection":
      if (rule.targetOption === "customPattern") {
        return destinationFromPattern(rule.targetValue || "/collections/{vendor}", product, rule);
      }
      return product.vendor ? `/collections/${slugifyPathPart(product.vendor)}` : "/collections/all";
    case "tagCollection": {
      if (rule.targetOption === "customPattern") {
        return destinationFromPattern(
          rule.targetValue || "/collections/{matchedTag}",
          product,
          rule,
        );
      }

      const tag = tagForRuleTarget(product, rule);
      return tag ? `/collections/${slugifyPathPart(tag)}` : "/collections/all";
    }
    case "searchResults": {
      let searchQuery = "";

      switch (rule.targetOption) {
        case "productType":
          searchQuery = product.type;
          break;
        case "vendor":
          searchQuery = product.vendor;
          break;
        case "collection":
          searchQuery = product.collections[0] ?? "";
          break;
        case "productTitle":
        case "titleKeywords":
          searchQuery = getProductTitleSearchQuery(product.name);
          break;
        case "sku":
          searchQuery = firstSkuPart(product);
          break;
        case "tag":
          searchQuery = product.tags[0] ?? "";
          break;
        case "custom":
          searchQuery = interpolateTargetTemplate(rule.targetValue, product, rule, {
            slugValues: false,
          });
          break;
        default:
          searchQuery = product.type || product.vendor || getProductTitleSearchQuery(product.name);
      }

      return `/search?q=${encodeURIComponent(
        searchQuery || product.type || product.vendor || getProductTitleSearchQuery(product.name),
      )}`;
    }
    case "allProducts":
      if (rule.targetOption === "searchAll") return "/search";
      if (rule.targetOption === "customCatalogPath") {
        return destinationFromPattern(rule.targetValue || "/collections/all", product, rule);
      }
      return "/collections/all";
    case "customPath":
      return destinationFromPattern(rule.targetValue, product, rule);
    case "homepage":
      return "/";
    case "noRedirect":
      return "";
  }
}

function tagRuleMatches(values: string[], productTags: string[], condition: string) {
  if (condition === "empty") return productTags.length === 0;

  const normalizedTags = productTags.map((tag) => tag.toLowerCase());
  if (condition === "hasAll") {
    return values.every((value) => normalizedTags.some((tag) => tag === value));
  }
  if (condition === "hasAny") {
    return values.some((value) => normalizedTags.some((tag) => tag === value));
  }
  if (condition === "notIn") {
    return values.every((value) => normalizedTags.every((tag) => tag !== value));
  }
  if (condition === "contains") {
    return values.some((value) => normalizedTags.some((tag) => tag.includes(value)));
  }

  return false;
}

function daysAgoTimestamp(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getTime();
}

function ageRuleMatches(product: ProductRow, value: string, condition: string) {
  const days = Number(value.trim());
  const isDayValue = Number.isFinite(days);
  const createdAt = product.createdAt ? new Date(product.createdAt).getTime() : null;
  const updatedAt = product.updatedAt ? new Date(product.updatedAt).getTime() : null;

  if (condition === "createdOlderThan" && isDayValue && createdAt) {
    return createdAt < daysAgoTimestamp(days);
  }
  if (condition === "createdNewerThan" && isDayValue && createdAt) {
    return createdAt > daysAgoTimestamp(days);
  }
  if (condition === "notUpdatedIn" && isDayValue && updatedAt) {
    return updatedAt < daysAgoTimestamp(days);
  }

  const dateValue = new Date(value.trim()).getTime();
  if (!Number.isFinite(dateValue) || !createdAt) return false;
  if (condition === "publishedBefore") return createdAt < dateValue;
  if (condition === "publishedAfter") return createdAt > dateValue;
  return false;
}

function numericConditionMatches(actual: number, value: string, condition: string) {
  const numbers = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  const first = numbers[0];
  if (first === undefined) return false;

  switch (condition) {
    case "lessThan":
      return actual < first;
    case "lessThanOrEqual":
      return actual <= first;
    case "greaterThan":
      return actual > first;
    case "between":
      return numbers.length >= 2 && actual >= numbers[0] && actual <= numbers[1];
    default:
      return false;
  }
}

export function ruleMatchesProduct(rule: RedirectRule, product: ProductRow) {
  if (!rule.enabled) return false;
  if (rule.field === "fallback") return true;

  const values = parseRuleValues(rule.value);

  switch (rule.field) {
    case "collection":
      if (rule.condition === "empty") return product.collections.length === 0;
      if (rule.condition === "notIn" || rule.condition === "notContains") {
        return product.collections.every((collection) =>
          valueMatches(values, collection, rule.condition),
        );
      }
      return product.collections.some((collection) =>
        valueMatches(values, collection, rule.condition),
      );
    case "vendor":
      if (rule.condition === "empty") return !product.vendor;
      return valueMatches(values, product.vendor, rule.condition);
    case "productType":
      if (rule.condition === "empty") return !product.type;
      return valueMatches(values, product.type, rule.condition);
    case "status":
      return valueMatches(values, product.status, rule.condition);
    case "inventory":
      if (rule.condition === "notTracked") return product.inventory === null;
      if (product.inventory === null) return false;
      if (rule.condition === "zero") return product.inventory === 0;
      return numericConditionMatches(product.inventory, rule.value, rule.condition);
    case "sku":
      if (rule.condition === "empty") return !product.sku;
      return valueMatches(values, product.sku, rule.condition);
    case "titleHandle":
      return valueMatches(values, `${product.name} ${product.handle}`, rule.condition);
    case "tag":
      return tagRuleMatches(values, product.tags, rule.condition);
    case "age":
      return ageRuleMatches(product, rule.value, rule.condition);
    case "price":
      return false;
  }
}

export function findMatchingRule(product: ProductRow, rules: RedirectRule[]) {
  return rules.find((rule) => ruleMatchesProduct(rule, product)) ?? null;
}

function confidenceForRule(product: ProductRow, rule: RedirectRule | null) {
  if (!rule) return { confidence: "Low" as const, tone: "warning" as const };
  if (rule.target === "noRedirect") {
    return { confidence: "Low" as const, tone: "warning" as const };
  }

  let score = 45;
  const hasCollection = product.collections.length > 0;
  const hasVendor = Boolean(product.vendor);
  const hasType = Boolean(product.type);
  const hasSku = Boolean(product.sku);
  const exactRuleConditions = ["in", "hasAny", "hasAll", "equals", "zero", "anything"];
  const broadRuleConditions = [
    "contains",
    "notContains",
    "notIn",
    "startsWith",
    "endsWith",
    "matches",
    "empty",
    "notTracked",
    "lessThan",
    "lessThanOrEqual",
    "greaterThan",
    "between",
  ];

  if (exactRuleConditions.includes(rule.condition)) score += 10;
  if (broadRuleConditions.includes(rule.condition)) score -= 8;

  switch (rule.field) {
    case "collection":
      score += hasCollection ? 20 : -25;
      break;
    case "vendor":
      score += hasVendor ? 10 : -20;
      break;
    case "productType":
      score += hasType ? 12 : -20;
      break;
    case "tag":
      score += 6;
      break;
    case "sku":
      score += hasSku ? 8 : -15;
      break;
    case "titleHandle":
      score += 4;
      break;
    case "status":
    case "inventory":
      score -= 5;
      break;
    case "price":
    case "age":
      score -= 10;
      break;
    case "fallback":
      score -= 30;
      break;
  }

  switch (rule.target) {
    case "sameCollection":
      score += hasCollection ? 22 : -30;
      break;
    case "bestSiblingProduct":
      if (rule.targetOption === "vendorType") {
        score += hasVendor && hasType ? 18 : -18;
      } else if (rule.targetOption === "typeCollection") {
        score += hasType ? 12 : -18;
      } else if (
        rule.targetOption === "inventoryCollection" ||
        rule.targetOption === "newestCollection"
      ) {
        score += hasCollection ? 14 : -18;
      } else {
        score += hasCollection || hasType ? 10 : -18;
      }
      break;
    case "productTypeCollection":
      score += hasType ? 12 : -24;
      break;
    case "vendorCollection":
      score += hasVendor ? 10 : -24;
      break;
    case "tagCollection":
      score += tagForRuleTarget(product, rule) ? 8 : -20;
      break;
    case "searchResults":
      score -= 4;
      if (hasType || hasVendor) score += 5;
      break;
    case "customPath":
      score += rule.targetValue.trim() ? 4 : -8;
      break;
    case "allProducts":
      score -= 22;
      break;
    case "homepage":
      score -= 30;
      break;
  }

  if (rule.field === "fallback" && rule.target === "allProducts") score = Math.min(score, 42);
  if (rule.target === "homepage") score = Math.min(score, 35);
  if (rule.target === "sameCollection" && hasCollection && rule.field === "collection") {
    score += 8;
  }
  if (
    rule.target === "bestSiblingProduct" &&
    rule.targetOption === "vendorType" &&
    rule.field === "vendor" &&
    hasType
  ) {
    score += 8;
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  if (boundedScore >= 72) {
    return { confidence: "High" as const, tone: "success" as const };
  }
  if (boundedScore >= 48) {
    return { confidence: "Medium" as const, tone: "info" as const };
  }
  return { confidence: "Low" as const, tone: "warning" as const };
}

function redirectExampleForProduct(
  product: ProductRow,
  rule: RedirectRule,
): RuleRedirectExample {
  return {
    productName: product.name,
    source: `/products/${product.handle}`,
    target: targetForRule(product, rule),
  };
}

export function firstDirectRuleExample(rule: RedirectRule, selectedProducts: ProductRow[]) {
  const product = selectedProducts.find((item) => ruleMatchesProduct(rule, item));

  return product ? redirectExampleForProduct(product, rule) : null;
}

export function buildPreviewRows(products: ProductRow[], rules: RedirectRule[]) {
  return products.map((product) => {
    const rule = findMatchingRule(product, rules.map(normalizeRule));
    const to = targetForRule(product, rule);
    const confidence = confidenceForRule(product, rule);
    const targetChoice: PreviewTargetChoice =
      rule?.target === "noRedirect"
        ? "skip"
        : rule?.target === "customPath"
          ? "custom"
          : "suggested";

    return {
      id: product.id,
      name: product.name,
      from: `/products/${product.handle}`,
      to,
      imageUrl: product.imageUrl,
      imageAlt: product.imageAlt,
      status: product.status,
      originalTo: to,
      via: rule ? optionLabel(RULE_FIELD_OPTIONS, rule.field) : "Fallback",
      confidence: confidence.confidence,
      tone: confidence.tone,
      targetChoice,
      customTarget: rule?.target === "customPath" ? rule.targetValue : "",
      edited: false,
    } satisfies GeneratedPreviewRow;
  });
}

export function productFilterInventoryValue(inventory: string) {
  return inventory === "out" ? "" : inventory;
}

export function productScopeForInventory(inventory: string) {
  if (inventory === "out") return "oos";
  if (inventory) return "custom_stock";
  return "all";
}
