import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getPlanInfo } from "../plan.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Banner,
  TextField,
  Select,
  ChoiceList,
  Checkbox,
  RadioButton,
  Divider,
  ProgressBar,
  Thumbnail,
  Tag,
  Box,
  IndexTable,
  IndexFilters,
  useSetIndexFiltersMode,
  IndexFiltersMode,
  EmptySearchResult,
  Popover,
  ActionList,
  Modal,
} from "@shopify/polaris";
import type { AppliedFilterInterface, FilterInterface } from "@shopify/polaris";
import type { loader as productsLoader } from "./app.products";
import type { action as applyAction } from "./app.apply";
import { DEV } from "../dev";
import { withRequestLogging } from "../request-logging.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "app.index.loader", () => getPlanInfo(request));
};

// ─── Types ───────────────────────────────────────────────────
type WizardStep =
  | "onboarding-1"
  | "onboarding-2"
  | "products"
  | "rules"
  | "preview"
  | "apply"
  | "success";

type ProductsLoaderData = Awaited<ReturnType<typeof productsLoader>>;
type ProductRow = {
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

type SelectedProductMap = Map<string, ProductRow>;
type CleanupPreset = "seasonal" | "vendor" | "oos" | "spring" | "none";

type Scenario = {
  id: CleanupPreset;
  icon: string;
  title: string;
  description: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  accentText: string;
};

type ScenarioStyle = CSSProperties & Record<`--${string}`, string>;

const SCENARIOS: Scenario[] = [
  {
    id: "seasonal",
    icon: "🍂",
    title: "Seasonal cleanup",
    description: "Retire a season, sale drop, or campaign group. Start with seasonal tags/collections plus out-of-stock items, then send shoppers to the closest remaining collection.",
    accent: "#d0810f",
    accentSoft: "#fff6dc",
    accentBorder: "#edc36a",
    accentText: "#7a4a00",
  },
  {
    id: "vendor",
    icon: "🏷️",
    title: "Vendor exit",
    description: "Stop selling a brand or supplier. Start from one real vendor, then redirect to that vendor collection or to similar products by type.",
    accent: "#0f7c8f",
    accentSoft: "#e5f7fa",
    accentBorder: "#94d4de",
    accentText: "#064f5e",
  },
  {
    id: "oos",
    icon: "📦",
    title: "Out of stock forever",
    description: "Clean up products that are not coming back. Start with zero inventory and redirect toward alternatives, type collections, or product-title search results.",
    accent: "#bd3f3a",
    accentSoft: "#fff0f0",
    accentBorder: "#eeaaa5",
    accentText: "#7d2622",
  },
  {
    id: "spring",
    icon: "🧹",
    title: "Spring cleaning",
    description: "Find stale, low-stock, clearance, or draft catalog items. Use this when cleanup work is mixed and needs a few broad rules.",
    accent: "#4f7f2d",
    accentSoft: "#edf8e6",
    accentBorder: "#b6d89b",
    accentText: "#2f4f1d",
  },
];
const PRESET_OPTIONS = SCENARIOS.map((scenario) => ({
  id: scenario.id,
  icon: scenario.icon,
  title: scenario.title,
  accent: scenario.accent,
  accentSoft: scenario.accentSoft,
  accentBorder: scenario.accentBorder,
  accentText: scenario.accentText,
}));

function scenarioStyle(scenario: Pick<Scenario, "accent" | "accentSoft" | "accentBorder" | "accentText">): ScenarioStyle {
  return {
    "--rml-card-accent": scenario.accent,
    "--rml-card-soft": scenario.accentSoft,
    "--rml-card-border": scenario.accentBorder,
    "--rml-card-text": scenario.accentText,
  };
}

const FREE_PLAN_OVERRIDE_REDIRECT_LIMIT = 200;

type RuleField =
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

type RuleTarget =
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

type RedirectRule = {
  id: string;
  field: RuleField;
  condition: string;
  value: string;
  target: RuleTarget;
  targetOption: string;
  targetValue: string;
  enabled: boolean;
  preserveQuery: boolean;
  stopOnMatch: boolean;
};

const RULE_FIELD_OPTIONS: { label: string; value: RuleField }[] = [
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

const RULE_TARGET_OPTIONS: { label: string; value: RuleTarget }[] = [
  { label: "Best matching product", value: "bestSiblingProduct" },
  { label: "Matched collection", value: "sameCollection" },
  { label: "Product type collection", value: "productTypeCollection" },
  { label: "Vendor collection", value: "vendorCollection" },
  { label: "Tag collection", value: "tagCollection" },
  { label: "Search results page", value: "searchResults" },
  { label: "All products collection", value: "allProducts" },
  { label: "Specific storefront path", value: "customPath" },
  { label: "Homepage", value: "homepage" },
  { label: "Do not create redirect", value: "noRedirect" },
];

const FIELD_CONFIG: Record<
  RuleField,
  {
    helpText: string;
    placeholder: string;
    valueHelpText: string;
    conditions: { label: string; value: string }[];
    options?: { label: string; value: string }[];
    valuesDisabled?: boolean;
  }
> = {
  collection: {
    helpText: "Use this for seasonal, launch, sale, or category cleanups.",
    placeholder: "SS24, Sale, Linen Tops",
    valueHelpText: "Use collection titles or handles, separated by commas.",
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
    helpText: "Useful when retiring a brand or supplier.",
    placeholder: "Acme, Northbridge",
    valueHelpText: "Use exact vendor names or partial names depending on the condition.",
    conditions: [
      { label: "is one of", value: "in" },
      { label: "is not one of", value: "notIn" },
      { label: "contains", value: "contains" },
      { label: "starts with", value: "startsWith" },
      { label: "is empty", value: "empty" },
    ],
  },
  productType: {
    helpText: "Groups retired products by merchandising category.",
    placeholder: "Shirt, Bag, Shoes",
    valueHelpText: "Use Shopify product type names, separated by commas.",
    conditions: [
      { label: "is one of", value: "in" },
      { label: "is not one of", value: "notIn" },
      { label: "contains", value: "contains" },
      { label: "starts with", value: "startsWith" },
      { label: "is empty", value: "empty" },
    ],
  },
  tag: {
    helpText: "Best for campaign, season, clearance, or lifecycle tags.",
    placeholder: "clearance, discontinued, fw23",
    valueHelpText: "Multiple tags use OR logic inside this rule.",
    conditions: [
      { label: "has any of", value: "hasAny" },
      { label: "has all of", value: "hasAll" },
      { label: "does not have", value: "notIn" },
      { label: "contains text", value: "contains" },
      { label: "has no tags", value: "empty" },
    ],
  },
  status: {
    helpText: "Separate active, draft, and archived products.",
    placeholder: "",
    valueHelpText: "Status rules are useful before archive/delete actions.",
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
    helpText: "Route permanently unavailable items away from dead product URLs.",
    placeholder: "0",
    valueHelpText: "Enter a whole number.",
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
    helpText: "Use SKU prefixes for discontinued ranges or supplier batches.",
    placeholder: "FW23-, DISC-, LIN-CMP",
    valueHelpText: "Use exact SKUs or prefixes depending on the condition.",
    conditions: [
      { label: "starts with", value: "startsWith" },
      { label: "contains", value: "contains" },
      { label: "is one of", value: "in" },
      { label: "is empty", value: "empty" },
    ],
  },
  titleHandle: {
    helpText: "Catch products by naming pattern when tags are inconsistent.",
    placeholder: "sample, final sale, 2023",
    valueHelpText: "Matches the product title and URL handle.",
    conditions: [
      { label: "contains", value: "contains" },
      { label: "does not contain", value: "notContains" },
      { label: "starts with", value: "startsWith" },
      { label: "ends with", value: "endsWith" },
      { label: "matches pattern", value: "matches" },
    ],
  },
  price: {
    helpText: "Useful for low-value clearance items or high-value alternatives.",
    placeholder: "25",
    valueHelpText: "Enter prices as numbers. Use a comma for between values.",
    conditions: [
      { label: "is less than", value: "lessThan" },
      { label: "is less than or equal to", value: "lessThanOrEqual" },
      { label: "is greater than", value: "greaterThan" },
      { label: "is between", value: "between" },
    ],
  },
  age: {
    helpText: "Find products created or updated before a cutoff.",
    placeholder: "365",
    valueHelpText: "Enter days, for example 180 or 365.",
    conditions: [
      { label: "created more than days ago", value: "createdOlderThan" },
      { label: "created less than days ago", value: "createdNewerThan" },
      { label: "not updated in days", value: "notUpdatedIn" },
      { label: "published before date", value: "publishedBefore" },
      { label: "published after date", value: "publishedAfter" },
    ],
  },
  fallback: {
    helpText: "Catches anything that did not match an earlier enabled rule.",
    placeholder: "",
    valueHelpText: "Fallback rules do not need a match value.",
    conditions: [{ label: "matches anything else", value: "anything" }],
    valuesDisabled: true,
  },
};

const TARGET_CONFIG: Record<
  RuleTarget,
  {
    helpText: string;
    optionLabel: string;
    optionHelpText: string;
    options?: { label: string; value: string }[];
    valueLabel?: string;
    valuePlaceholder?: string;
    valueHelpText?: string;
    needsValue?: boolean;
  }
> = {
  bestSiblingProduct: {
    helpText: "Sends shoppers to the closest active product alternative.",
    optionLabel: "Choose alternative by",
    optionHelpText: "These signals are evaluated against active products.",
    options: [
      { label: "Same collection, type, then vendor", value: "collectionTypeVendor" },
      { label: "Same product type, then collection", value: "typeCollection" },
      { label: "Same vendor and product type", value: "vendorType" },
      { label: "Highest inventory in same collection", value: "inventoryCollection" },
      { label: "Newest active product in same collection", value: "newestCollection" },
      { label: "Lowest price difference", value: "closestPrice" },
    ],
  },
  sameCollection: {
    helpText: "Best for seasonal cleanups where the collection remains useful.",
    optionLabel: "Which collection",
    optionHelpText: "Used when the retired product belongs to more than one collection.",
    options: [
      { label: "Most specific matching collection", value: "specific" },
      { label: "Highest priority collection", value: "priority" },
      { label: "Newest updated collection", value: "recent" },
      { label: "Collection with most active products", value: "mostProducts" },
      { label: "First manual collection", value: "manualFirst" },
      { label: "First smart collection", value: "smartFirst" },
    ],
  },
  productTypeCollection: {
    helpText: "Routes to a type landing page when product-level alternatives are weak.",
    optionLabel: "Collection source",
    optionHelpText: "The app can use an existing collection or generate the expected handle.",
    options: [
      { label: "Existing collection matching product type", value: "existing" },
      { label: "/collections/[product-type-handle]", value: "handle" },
      { label: "Search collection title for product type", value: "searchTitle" },
    ],
  },
  vendorCollection: {
    helpText: "Good for brand exits or vendor-specific catalog cleanup.",
    optionLabel: "Collection source",
    optionHelpText: "Vendor pages usually map to automated collections.",
    options: [
      { label: "Existing collection matching vendor", value: "existing" },
      { label: "/collections/[vendor-handle]", value: "handle" },
      { label: "Search collection title for vendor", value: "searchTitle" },
    ],
  },
  tagCollection: {
    helpText: "Useful when tags represent shopping destinations like clearance or gifts.",
    optionLabel: "Collection source",
    optionHelpText: "The first matching tag from the rule is used.",
    options: [
      { label: "Existing collection matching tag", value: "existing" },
      { label: "/collections/[tag-handle]", value: "handle" },
      { label: "Search collection title for tag", value: "searchTitle" },
    ],
  },
  searchResults: {
    helpText: "Fallback to search when no clean collection destination exists.",
    optionLabel: "Search query",
    optionHelpText: "Choose what term to pass to the storefront search page.",
    options: [
      { label: "Product type", value: "productType" },
      { label: "Vendor", value: "vendor" },
      { label: "Top collection title", value: "collection" },
      { label: "Product title", value: "productTitle" },
      { label: "Retired product title keywords", value: "titleKeywords" },
      { label: "Custom search term", value: "custom" },
    ],
    valueLabel: "Custom search term",
    valuePlaceholder: "linen shirt",
    valueHelpText: "Only required when using a custom search term.",
  },
  allProducts: {
    helpText: "Safe broad destination when catalog discovery matters more than precision.",
    optionLabel: "Destination",
    optionHelpText: "Choose the broadest catalog page available.",
    options: [
      { label: "/collections/all", value: "collectionsAll" },
      { label: "/collections", value: "collectionsIndex" },
      { label: "Shop all collection handle", value: "shopAll" },
    ],
  },
  customPath: {
    helpText: "Use this for curated landing pages, buying guides, or other storefront paths.",
    optionLabel: "Path type",
    optionHelpText: "Storefront paths must start with /.",
    options: [
      { label: "Storefront path", value: "path" },
      { label: "Liquid-style template path", value: "template" },
    ],
    valueLabel: "Destination",
    valuePlaceholder: "/collections/sale",
    valueHelpText: "Examples: /collections/sale or /pages/size-guide",
    needsValue: true,
  },
  homepage: {
    helpText: "Use only when there is no meaningful product or collection destination.",
    optionLabel: "Homepage path",
    optionHelpText: "The default Shopify storefront homepage is /.",
    options: [{ label: "/", value: "root" }],
  },
  noRedirect: {
    helpText: "Excludes matching products from redirect creation.",
    optionLabel: "Reason",
    optionHelpText: "The reason appears in review so the row is easy to audit.",
    options: [
      { label: "Keep URL intentionally unavailable", value: "intentional404" },
      { label: "Handle manually later", value: "manual" },
      { label: "Product is not customer-facing", value: "notCustomerFacing" },
    ],
  },
};

const DEFAULT_RULES: RedirectRule[] = [
  {
    id: "collection-season",
    field: "collection",
    condition: "in",
    value: "SS24, FW23, Sale",
    target: "sameCollection",
    targetOption: "specific",
    targetValue: "",
    enabled: true,
    preserveQuery: true,
    stopOnMatch: true,
  },
  {
    id: "vendor-type",
    field: "vendor",
    condition: "in",
    value: "Discontinued vendor",
    target: "bestSiblingProduct",
    targetOption: "vendorType",
    targetValue: "",
    enabled: true,
    preserveQuery: true,
    stopOnMatch: true,
  },
  {
    id: "out-of-stock",
    field: "inventory",
    condition: "zero",
    value: "",
    target: "productTypeCollection",
    targetOption: "existing",
    targetValue: "",
    enabled: true,
    preserveQuery: true,
    stopOnMatch: true,
  },
  {
    id: "clearance-tag",
    field: "tag",
    condition: "hasAny",
    value: "clearance, discontinued",
    target: "tagCollection",
    targetOption: "existing",
    targetValue: "",
    enabled: true,
    preserveQuery: true,
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
    preserveQuery: true,
    stopOnMatch: true,
  },
];

// ─── Preset helpers ───────────────────────────────────────────
// Tabs order in ProductsStep: all=0, active=1, draft=2, archived=3, oos=4
const PRESET_FILTER_INIT: Record<
  CleanupPreset,
  { inventory: string; updated: string; tabIndex: number }
> = {
  seasonal: { inventory: "out", updated: "",      tabIndex: 4 },
  vendor:   { inventory: "",    updated: "",      tabIndex: 0 },
  oos:      { inventory: "out", updated: "180d",  tabIndex: 4 },
  spring:   { inventory: "low", updated: "180d",  tabIndex: 1 },
  none:     { inventory: "",    updated: "",      tabIndex: 0 },
};

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

function productListFromSelection(selectedProducts?: SelectedProductMap) {
  return selectedProducts ? Array.from(selectedProducts.values()) : [];
}

function mostCommonValue(values: string[]) {
  const counts = new Map<string, number>();
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function firstValueMatching(values: string[], signals: string[]) {
  return values.find((value) => {
    const normalized = value.toLowerCase();
    return signals.some((signal) => normalized.includes(signal));
  }) ?? "";
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

function ruleTemplate(patch: Partial<RedirectRule> & Pick<RedirectRule, "id" | "field" | "condition" | "target" | "targetOption">): RedirectRule {
  return normalizeRule({
    value: "",
    targetValue: "",
    enabled: true,
    preserveQuery: true,
    stopOnMatch: true,
    ...patch,
  });
}

function rulesForPreset(
  preset: CleanupPreset,
  context: { selectedProducts?: SelectedProductMap } = {},
): RedirectRule[] {
  const products = productListFromSelection(context.selectedProducts);
  const vendorExample = exampleVendorFromProducts(products) || "Vendor to retire";
  const typeExample = exampleTypeFromProducts(products) || "Product type to retire";
  const seasonExample = seasonValueFromProducts(products) || "FW24, SS24, clearance";
  const clearanceExample = clearanceValueFromProducts(products) || "clearance, final-sale, discontinued";

  if (preset === "none") return DEFAULT_RULES.map((rule) => ({ ...rule }));

  if (preset === "seasonal") {
    return [
      ruleTemplate({
        id: "seasonal-collection",
        field: "collection",
        condition: "contains",
        value: seasonExample,
        target: "sameCollection",
        targetOption: "mostProducts",
      }),
      ruleTemplate({
        id: "seasonal-tag",
        field: "tag",
        condition: "contains",
        value: seasonExample,
        target: "tagCollection",
        targetOption: "existing",
      }),
      ruleTemplate({
        id: "seasonal-type-backstop",
        field: "productType",
        condition: "in",
        value: typeExample,
        target: "productTypeCollection",
        targetOption: "existing",
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
      ruleTemplate({
        id: "vendor-exit-primary",
        field: "vendor",
        condition: "in",
        value: vendorExample,
        target: "vendorCollection",
        targetOption: "existing",
      }),
      ruleTemplate({
        id: "vendor-exit-similar-type",
        field: "vendor",
        condition: "in",
        value: vendorExample,
        target: "bestSiblingProduct",
        targetOption: "vendorType",
      }),
      ruleTemplate({
        id: "vendor-exit-product-type",
        field: "productType",
        condition: "in",
        value: typeExample,
        target: "productTypeCollection",
        targetOption: "existing",
      }),
      ruleTemplate({
        id: "vendor-exit-fallback",
        field: "fallback",
        condition: "anything",
        target: "vendorCollection",
        targetOption: "existing",
      }),
    ];
  }

  if (preset === "oos") {
    return [
      ruleTemplate({
        id: "oos-primary",
        field: "inventory",
        condition: "zero",
        target: "bestSiblingProduct",
        targetOption: "inventoryCollection",
      }),
      ruleTemplate({
        id: "oos-type-collection",
        field: "productType",
        condition: "in",
        value: typeExample,
        target: "productTypeCollection",
        targetOption: "existing",
      }),
      ruleTemplate({
        id: "oos-clearance-tag",
        field: "tag",
        condition: "contains",
        value: clearanceExample,
        target: "tagCollection",
        targetOption: "existing",
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

  // spring
  return [
    ruleTemplate({
      id: "spring-clearance-tag",
      field: "tag",
      condition: "contains",
      value: clearanceExample,
      target: "tagCollection",
      targetOption: "existing",
    }),
    ruleTemplate({
      id: "spring-low-stock",
      field: "inventory",
      condition: "lessThan",
      value: "5",
      target: "bestSiblingProduct",
      targetOption: "collectionTypeVendor",
    }),
    ruleTemplate({
      id: "spring-stale-products",
      field: "age",
      condition: "notUpdatedIn",
      value: "180",
      target: "productTypeCollection",
      targetOption: "existing",
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

const PREVIEW_ROWS = [
  { id: "1", name: "Linen Camp Shirt — Sage", from: "/products/lin-cmp-sg", to: "/collections/linen-tops", via: "Collection", confidence: "High", tone: "success" as const },
  { id: "2", name: "Linen Camp Shirt — Rust", from: "/products/lin-cmp-rs", to: "/collections/linen-tops", via: "Collection", confidence: "High", tone: "success" as const },
  { id: "4", name: "Cashmere Beanie — Charcoal", from: "/products/csh-bn-ch", to: "/collections/winter-acc", via: "Collection", confidence: "Medium", tone: "info" as const },
  { id: "6", name: "Garden Tote — Olive", from: "/products/gd-tt-ol", to: "/collections/bags", via: "Collection", confidence: "High", tone: "success" as const },
  { id: "7", name: "Garden Tote — Stone", from: "/products/gd-tt-st", to: "/collections/bags", via: "Collection", confidence: "High", tone: "success" as const },
  { id: "m1", name: "Wool Mittens — Navy", from: "/products/wl-mt-nv", to: "/collections/highline", via: "Vendor", confidence: "Low", tone: "warning" as const },
  { id: "c1", name: "Field Cap — Khaki", from: "/products/fld-cp-kh", to: "/collections/all", via: "Fallback", confidence: "Low", tone: "warning" as const },
];

type PreviewTargetChoice =
  | "suggested"
  | "sameCollection"
  | "vendorCollection"
  | "productTypeCollection"
  | "search"
  | "allProducts"
  | "homepage"
  | "custom"
  | "skip";

type PreviewRedirectRow = (typeof PREVIEW_ROWS)[number] & {
  originalTo: string;
  targetChoice: PreviewTargetChoice;
  customTarget: string;
  edited: boolean;
};

type GeneratedPreviewRow = {
  id: string;
  name: string;
  from: string;
  to: string;
  imageUrl: string;
  imageAlt: string;
  via: string;
  confidence: "High" | "Medium" | "Low";
  tone: "success" | "info" | "warning";
  originalTo: string;
  targetChoice: PreviewTargetChoice;
  customTarget: string;
  edited: boolean;
};

type CleanupMode = "redirects" | "archive" | "delete";

type CleanupResult = {
  id: string;
  completedAt: Date;
  mode: CleanupMode;
  redirectsCreated: number;
  productsRetired: number;
  skipped: number;
  conflicts: number;
  lowConfidence: number;
};

const PREVIEW_TARGET_OPTIONS: { label: string; value: PreviewTargetChoice }[] = [
  { label: "Suggested target", value: "suggested" },
  { label: "Matching collection", value: "sameCollection" },
  { label: "Vendor collection", value: "vendorCollection" },
  { label: "Product type collection", value: "productTypeCollection" },
  { label: "Search results", value: "search" },
  { label: "All products", value: "allProducts" },
  { label: "Homepage", value: "homepage" },
  { label: "Custom path", value: "custom" },
  { label: "Skip redirect", value: "skip" },
];

// ─── Step 1: Onboarding Explainer ────────────────────────────
function OnboardingExplainer({ onNext }: { onNext(): void }) {
  return (
    <Page
      title="Redirect Mapper Lite"
      subtitle="Pre-delete redirect assistant for seasonal cleanups"
    >
      <Card padding="500">
        <BlockStack gap="500" inlineAlign="center">
          <Box>
            <img
              src="/hero.jpg"
              alt="Retired product redirected to best destination — 404 avoided"
              style={{ width: "100%", maxWidth: 560, height: "auto", display: "block", margin: "0 auto" }}
            />
          </Box>

          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingLg" alignment="center" as="h2">
              Retire products without breaking links
            </Text>
            <Text variant="bodyMd" tone="subdued" alignment="center" as="p">
              Pick the products you are about to archive or delete. We will suggest where each URL should redirect — by collection, vendor, or your own rules — before any 404s happen.
            </Text>
          </BlockStack>

          <InlineStack gap="200">
            <Button variant="primary" size="large" onClick={onNext}>
              Get started
            </Button>
          </InlineStack>

          <Box width="100%">
            <Divider />
          </Box>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, width: "100%" }}>
            {[
              { n: 1, title: "Pick products", description: "Select what you're retiring. Filter by tag, vendor or collection." },
              { n: 2, title: "Review redirects", description: "We auto-suggest a target for each. Edit any you don't like." },
              { n: 3, title: "Apply or export", description: "Push to Shopify directly, or export CSV for native bulk import." },
            ].map((step) => (
              <Box key={step.n} padding="400" background="bg-surface-secondary" borderRadius="200" borderWidth="025" borderColor="border-secondary">
                <BlockStack gap="200">
                  <div
                    style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#303030", color: "#fff",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 600,
                    }}
                  >
                    {step.n}
                  </div>
                  <Text variant="headingSm" as="h3">{step.title}</Text>
                  <Text variant="bodySm" tone="subdued" as="p">{step.description}</Text>
                </BlockStack>
              </Box>
            ))}
          </div>
        </BlockStack>
      </Card>
    </Page>
  );
}

// ─── Step 2: Onboarding Wizard ───────────────────────────────
function OnboardingWizard({
  onBack,
  onNext,
  selectedPreset,
  setSelectedPreset,
}: {
  onBack(): void;
  onNext(): void;
  selectedPreset: CleanupPreset;
  setSelectedPreset: (preset: CleanupPreset) => void;
}) {
  return (
    <Page
      title="What kind of cleanup?"
      subtitle="This sets sensible default rules. You can edit any of them after."
      backAction={{ content: "Back", onAction: onBack }}
      primaryAction={{ content: "Continue", onAction: onNext }}
      secondaryActions={[{
        content: "Skip — I'll set up manually",
        onAction: () => { setSelectedPreset("none"); onNext(); },
      }]}
    >
      <BlockStack gap="400">
        <Card>
          <div className="rml-cleanup-card">
          <BlockStack gap="500">
            <div className="rml-cleanup-header">
              <div className="rml-cleanup-kicker">Redirect strategy</div>
              <Text variant="headingLg" as="h2">Choose the cleanup path</Text>
              <Text variant="bodyMd" tone="subdued" as="p">
                Start with a scenario that matches the catalog risk, then tune the rules before any product URL changes.
              </Text>
            </div>

            <div className="rml-scenario-grid">
              {SCENARIOS.map((scenario) => {
                const selected = selectedPreset === scenario.id;
                return (
                <div
                  key={scenario.id}
                  aria-label={`Use ${scenario.title}`}
                  aria-pressed={selected}
                  className={`rml-scenario-card${selected ? " rml-scenario-card--selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPreset(scenario.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedPreset(scenario.id);
                    }
                  }}
                  style={scenarioStyle(scenario)}
                >
                  <div className="rml-scenario-card__top">
                    <div className="rml-scenario-icon" aria-hidden="true">
                      {scenario.icon}
                    </div>
                    <div className="rml-scenario-radio">
                      <RadioButton
                        label=""
                        checked={selected}
                        onChange={() => setSelectedPreset(scenario.id)}
                      />
                    </div>
                  </div>

                  <div className="rml-scenario-card__content">
                    <Text variant="headingMd" as="h3">
                      <span className="rml-scenario-title">{scenario.title}</span>
                    </Text>
                    <p className="rml-scenario-description">{scenario.description}</p>
                  </div>
                </div>
              );
            })}
            </div>

            <Banner tone="info">
              Defaults are a starting point. The next step lets you review and tweak each rule before any redirect is created.
            </Banner>
          </BlockStack>
          </div>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ─── Step 3: Products ────────────────────────────────────────
function ProductsStep({
  onBack,
  onNext,
  selectedProducts,
  setSelectedProducts,
  selectedPreset,
  setSelectedPreset,
}: {
  onBack(): void;
  onNext(): void;
  selectedProducts: SelectedProductMap;
  setSelectedProducts: Dispatch<SetStateAction<SelectedProductMap>>;
  selectedPreset: CleanupPreset;
  setSelectedPreset: (preset: CleanupPreset) => void;
}) {
  const productsFetcher = useFetcher<typeof productsLoader>();
  const filtersFetcher = useFetcher<typeof productsLoader>();
  const loadProductsRef = useRef(productsFetcher.load);
  const loadFiltersRef = useRef(filtersFetcher.load);
  const { mode, setMode } = useSetIndexFiltersMode(IndexFiltersMode.Default);
  const [selectedTab, setSelectedTab] = useState(
    () => PRESET_FILTER_INIT[selectedPreset].tabIndex,
  );
  const [searchValue, setSearchValue] = useState("");
  const [vendor, setVendor] = useState("");
  const [collection, setCollection] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState("");
  const [season, setSeason] = useState("");
  const [inventory, setInventory] = useState(
    () => PRESET_FILTER_INIT[selectedPreset].inventory,
  );
  const [updated, setUpdated] = useState(
    () => PRESET_FILTER_INIT[selectedPreset].updated,
  );
  const [presetFiltersApplied, setPresetFiltersApplied] = useState<CleanupPreset | null>(null);
  const [pageStack, setPageStack] = useState<(string | null)[]>([null]);
  const [filterOptions, setFilterOptions] = useState<{
    collections: { id: string; title: string }[];
    vendors: string[];
    productTypes: string[];
    tags: string[];
  }>({ collections: [], vendors: [], productTypes: [], tags: [] });
  const [productsLoadingTimedOut, setProductsLoadingTimedOut] = useState(false);
  const [lastProductsRequestPath, setLastProductsRequestPath] = useState("");

  const data = productsFetcher.data as ProductsLoaderData | undefined;
  const filtersData = filtersFetcher.data as ProductsLoaderData | undefined;
  const products = (data?.products ?? []) as ProductRow[];
  const pageInfo = data?.pageInfo ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  };
  const isLoading = productsFetcher.state !== "idle";
  const showProductLoading = isLoading && !productsLoadingTimedOut;
  const tableLoading = showProductLoading && !data;
  const currentAfter = pageStack[pageStack.length - 1] ?? null;
  const selectedIds = useMemo(
    () => new Set(selectedProducts.keys()),
    [selectedProducts],
  );
  const selectedScenario = SCENARIOS.find((scenario) => scenario.id === selectedPreset);

  const handleSelectionChange = (
    selectionType: string,
    isSelecting: boolean,
    selection?: string | [number, number]
  ) => {
    if (selectionType === "all" || selectionType === "page") {
      setSelectedProducts((prev) => {
        const next = new Map(prev);
        products.forEach((product) =>
          isSelecting ? next.set(product.id, product) : next.delete(product.id),
        );
        return next;
      });
    } else if (selectionType === "range" && Array.isArray(selection)) {
      const [start, end] = selection;
      setSelectedProducts((prev) => {
        const next = new Map(prev);
        products.slice(start, end + 1).forEach((product) =>
          isSelecting ? next.set(product.id, product) : next.delete(product.id),
        );
        return next;
      });
    } else if (selectionType === "single" && typeof selection === "string") {
      const product = products.find((item) => item.id === selection);
      setSelectedProducts((prev) => {
        const next = new Map(prev);
        if (isSelecting && product) next.set(selection, product);
        else next.delete(selection);
        return next;
      });
    }
  };

    const tabs = useMemo(() => [
      { id: "all", content: "All" },
      { id: "active", content: "Active" },
      { id: "draft", content: "Draft" },
      { id: "archived", content: "Archived" },
      { id: "oos", content: "Out of stock" },
    ], []);
  
    const selectedTabId = tabs[selectedTab]?.id ?? "all";
  const selectedInCurrentPage = products.filter((product) =>
    selectedIds.has(product.id),
  ).length;
  
    const resetPagination = useCallback(() => setPageStack([null]), []);

    const buildProductParams = useCallback(({
      includePagination,
      bulk,
    }: {
      includePagination: boolean;
      bulk?: boolean;
    }) => {
      const params = new URLSearchParams();
      if (searchValue.trim()) params.set("q", searchValue.trim());
      if (selectedTabId !== "all") params.set("tab", selectedTabId);
      if (vendor) params.set("vendor", vendor);
      if (collection) params.set("collection", collection);
      if (type) params.set("type", type);
      if (tag) params.set("tag", tag);
      if (season.trim()) params.set("season", season.trim());
      if (inventory) params.set("inventory", inventory);
      if (updated) params.set("updated", updated);
      if (includePagination && currentAfter) params.set("after", currentAfter);
      if (bulk) params.set("bulk", "1");
      return params;
    }, [
      collection,
      currentAfter,
      inventory,
      searchValue,
      season,
      selectedTabId,
      tag,
      type,
      updated,
      vendor,
    ]);

  const productRequestPath = useMemo(() => {
    const params = buildProductParams({
      includePagination: true,
    });
    return `/app/products?${params.toString()}`;
  }, [buildProductParams]);

  const filters = useMemo<FilterInterface[]>(
    () => [
      {
        key: "vendor",
        label: "Vendor",
        filter: (
          <ChoiceList
            title="Vendor"
            titleHidden
            choices={filterOptions.vendors.map((item) => ({
              label: item,
              value: item,
            }))}
            selected={vendor ? [vendor] : []}
            onChange={(value) => {
              setVendor(value[0] ?? "");
              resetPagination();
            }}
          />
        ),
        shortcut: true,
      },
      {
        key: "collection",
        label: "Collection",
        filter: (
          <ChoiceList
            title="Collection"
            titleHidden
            choices={filterOptions.collections.map((item) => ({
              label: item.title,
              value: item.id,
            }))}
            selected={collection ? [collection] : []}
            onChange={(value) => {
              setCollection(value[0] ?? "");
              resetPagination();
            }}
          />
        ),
        shortcut: true,
      },
        {
          key: "type",
          label: "Type",
        filter: (
          <ChoiceList
            title="Type"
            titleHidden
            choices={filterOptions.productTypes.map((item) => ({
              label: item,
              value: item,
            }))}
            selected={type ? [type] : []}
            onChange={(value) => {
              setType(value[0] ?? "");
              resetPagination();
            }}
          />
        ),
          shortcut: true,
        },
        {
          key: "tag",
          label: "Tag",
          filter: (
            <ChoiceList
              title="Tag"
              titleHidden
              choices={filterOptions.tags.map((item) => ({
                label: item,
                value: item,
              }))}
              selected={tag ? [tag] : []}
              onChange={(value) => {
                setTag(value[0] ?? "");
                resetPagination();
              }}
            />
          ),
          shortcut: true,
        },
        {
          key: "season",
          label: "Season keyword",
          filter: (
            <TextField
              label="Season keyword"
              labelHidden
              value={season}
              onChange={(value) => {
                setSeason(value);
                resetPagination();
              }}
              placeholder="winter, summer 2026, fw25"
              autoComplete="off"
            />
          ),
          shortcut: true,
        },
        {
          key: "inventory",
          label: "Inventory",
          filter: (
            <ChoiceList
              title="Inventory"
              titleHidden
              choices={[
                { label: "In stock", value: "available" },
                { label: "Out of stock", value: "out" },
                { label: "Low stock (1-4)", value: "low" },
                { label: "Healthy stock (5+)", value: "healthy" },
                { label: "Overstock (100+)", value: "overstock" },
              ]}
              selected={inventory ? [inventory] : []}
              onChange={(value) => {
                setInventory(value[0] ?? "");
                resetPagination();
              }}
            />
          ),
          shortcut: true,
        },
        {
          key: "updated",
          label: "Last updated",
          filter: (
            <ChoiceList
              title="Last updated"
              titleHidden
              choices={[
                { label: "Not updated in 90 days", value: "90d" },
                { label: "Not updated in 180 days", value: "180d" },
                { label: "Not updated in 1 year", value: "365d" },
              ]}
              selected={updated ? [updated] : []}
              onChange={(value) => {
                setUpdated(value[0] ?? "");
                resetPagination();
              }}
            />
          ),
          shortcut: true,
        },
      ],
      [collection, filterOptions, inventory, resetPagination, season, tag, type, updated, vendor],
    );

    const appliedFilters = useMemo<AppliedFilterInterface[]>(() => {
      const collectionTitle =
        filterOptions.collections.find((item) => item.id === collection)?.title ??
        collection;
      const inventoryLabel =
        inventory === "available"
          ? "In stock"
          : inventory === "out"
          ? "Out of stock"
          : inventory === "low"
            ? "Low stock (1-4)"
            : inventory === "healthy"
              ? "Healthy stock (5+)"
              : inventory === "overstock"
                ? "Overstock (100+)"
                : "";
      const updatedLabel =
        updated === "90d"
          ? "Not updated in 90 days"
          : updated === "180d"
            ? "Not updated in 180 days"
            : updated === "365d"
              ? "Not updated in 1 year"
              : "";
  
      return [
      vendor && {
        key: "vendor",
        label: `Vendor: ${vendor}`,
        onRemove: () => {
          setVendor("");
          resetPagination();
        },
      },
      collection && {
        key: "collection",
        label: `Collection: ${collectionTitle}`,
        onRemove: () => {
          setCollection("");
          resetPagination();
        },
      },
        type && {
          key: "type",
          label: `Type: ${type}`,
        onRemove: () => {
          setType("");
          resetPagination();
          },
        },
        tag && {
          key: "tag",
          label: `Tag: ${tag}`,
          onRemove: () => {
            setTag("");
            resetPagination();
          },
        },
        season && {
          key: "season",
          label: `Season: ${season}`,
          onRemove: () => {
            setSeason("");
            resetPagination();
          },
        },
        inventory && {
          key: "inventory",
          label: `Inventory: ${inventoryLabel}`,
          onRemove: () => {
            setInventory("");
            resetPagination();
          },
        },
        updated && {
          key: "updated",
          label: updatedLabel,
          onRemove: () => {
            setUpdated("");
            resetPagination();
          },
        },
      ].filter(Boolean) as AppliedFilterInterface[];
    }, [collection, filterOptions.collections, inventory, resetPagination, season, tag, type, updated, vendor]);

  const clearAllFilters = () => {
    setSearchValue("");
    setVendor("");
    setCollection("");
    setType("");
    setTag("");
    setSeason("");
    setInventory("");
    setUpdated("");
    setSelectedTab(0);
    setSelectedPreset("none");
    setPresetFiltersApplied("none");
    resetPagination();
  };

  useEffect(() => {
    loadProductsRef.current = productsFetcher.load;
  }, [productsFetcher.load]);

  useEffect(() => {
    loadFiltersRef.current = filtersFetcher.load;
  }, [filtersFetcher.load]);

  useEffect(() => {
    loadFiltersRef.current("/app/products?init=1&filtersOnly=1");
  }, []);

  useEffect(() => {
    setProductsLoadingTimedOut(false);
    const timeout = window.setTimeout(() => {
      setLastProductsRequestPath(productRequestPath);
      loadProductsRef.current(productRequestPath);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [productRequestPath]);

  useEffect(() => {
    if (productsFetcher.state === "idle") {
      setProductsLoadingTimedOut(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setProductsLoadingTimedOut(true);
    }, 15000);

    return () => window.clearTimeout(timeout);
  }, [productsFetcher.state, productRequestPath]);

  const retryProductsLoad = useCallback(() => {
    const requestPath = lastProductsRequestPath || productRequestPath;
    setProductsLoadingTimedOut(false);
    setLastProductsRequestPath(requestPath);
    loadProductsRef.current(requestPath);
  }, [lastProductsRequestPath, productRequestPath]);

  useEffect(() => {
    if (!filtersData) return;
      if (filtersData.collections.length || filtersData.vendors.length || filtersData.productTypes.length || filtersData.tags.length) {
        setFilterOptions({
          collections: filtersData.collections,
          vendors: filtersData.vendors,
          productTypes: filtersData.productTypes,
          tags: filtersData.tags,
        });
      }
  }, [filtersData]);

  const handleTabSelect = (index: number) => {
    setSelectedTab(index);
    resetPagination();
  };

  const handleQueryChange = (value: string) => {
    setSearchValue(value);
    resetPagination();
  };

  const setTabById = useCallback((id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    setSelectedTab(index >= 0 ? index : 0);
  }, [tabs]);

  const firstCollectionMatching = useCallback((signals: string[]) =>
    filterOptions.collections.find((item) => {
      const normalized = item.title.toLowerCase();
      return signals.some((signal) => normalized.includes(signal));
    }), [filterOptions.collections]);

  const applyQuickFilter = useCallback((preset: CleanupPreset) => {
    const suggestedVendor = filterOptions.vendors[0] ?? "";
    const suggestedSeasonTag = firstValueMatching(filterOptions.tags, SEASON_SIGNALS);
    const suggestedSeasonCollection = firstCollectionMatching(SEASON_SIGNALS);
    const suggestedClearanceTag = firstValueMatching(filterOptions.tags, CLEARANCE_SIGNALS);

    setSelectedPreset(preset);
    setSearchValue("");
    setVendor("");
    setCollection("");
    setType("");
    setTag("");
    setSeason("");
    setPresetFiltersApplied(preset);

    if (preset === "none") {
      setInventory("");
      setUpdated("");
      setTabById("all");
    }
    if (preset === "seasonal") {
      setInventory("out");
      setUpdated("");
      setTabById("oos");
      if (suggestedSeasonTag) {
        setTag(suggestedSeasonTag);
      } else if (suggestedSeasonCollection) {
        setCollection(suggestedSeasonCollection.id);
      }
    }
    if (preset === "vendor") {
      setVendor(suggestedVendor);
      setInventory("");
      setUpdated("");
      setTabById("all");
    }
    if (preset === "oos") {
      setInventory("out");
      setUpdated("180d");
      setTabById("oos");
    }
    if (preset === "spring") {
      setInventory("low");
      setUpdated("180d");
      setTabById("active");
      setTag(suggestedClearanceTag);
    }
    resetPagination();
  }, [
    filterOptions.tags,
    filterOptions.vendors,
    firstCollectionMatching,
    resetPagination,
    setSelectedPreset,
    setTabById,
  ]);

  useEffect(() => {
    const optionsLoaded =
      filterOptions.collections.length > 0 ||
      filterOptions.vendors.length > 0 ||
      filterOptions.productTypes.length > 0 ||
      filterOptions.tags.length > 0;
    if (!optionsLoaded || presetFiltersApplied === selectedPreset) return;
    applyQuickFilter(selectedPreset);
  }, [
    filterOptions.collections.length,
    filterOptions.productTypes.length,
    filterOptions.tags.length,
    filterOptions.vendors.length,
    presetFiltersApplied,
    selectedPreset,
    applyQuickFilter,
  ]);

    const vendorOptions = [
      { label: "Any vendor", value: "" },
      ...filterOptions.vendors.map((item) => ({ label: item, value: item })),
    ];
    const collectionOptions = [
      { label: "Any collection", value: "" },
      ...filterOptions.collections.map((item) => ({
        label: item.title,
        value: item.id,
      })),
    ];
    const productTypeOptions = [
      { label: "Any type", value: "" },
      ...filterOptions.productTypes.map((item) => ({ label: item, value: item })),
    ];
    const tagOptions = [
      { label: "Any tag", value: "" },
      ...filterOptions.tags.map((item) => ({ label: item, value: item })),
    ];
    const inventoryOptions = [
      { label: "Any inventory", value: "" },
      { label: "In stock", value: "available" },
      { label: "Out of stock", value: "out" },
      { label: "Low stock (1-4)", value: "low" },
      { label: "Healthy stock (5+)", value: "healthy" },
      { label: "Overstock (100+)", value: "overstock" },
    ];
    const updatedOptions = [
      { label: "Any update age", value: "" },
      { label: "Not updated in 90 days", value: "90d" },
      { label: "Not updated in 180 days", value: "180d" },
      { label: "Not updated in 1 year", value: "365d" },
    ];

  const hasActiveProductFilters =
    Boolean(searchValue.trim()) ||
    selectedTabId !== "all" ||
    appliedFilters.length > 0;

  const productMarkup = products.map((product: ProductRow, index: number) => (
    <IndexTable.Row
      id={product.id}
      key={product.id}
      selected={selectedIds.has(product.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Thumbnail
          size="small"
          source={product.imageUrl || "/favicon.ico"}
          alt={product.imageAlt}
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <InlineStack gap="150" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" as="span">
              {product.name}
            </Text>
            <Badge tone={product.status === "active" ? "success" : undefined}>
              {product.status}
            </Badge>
          </InlineStack>
            <Text variant="bodySm" tone="subdued" as="span">
              {product.sku || `/products/${product.handle}`}
            </Text>
            {product.tags.length ? (
              <InlineStack gap="100" wrap>
                {product.tags.slice(0, 3).map((item) => (
                  <Tag key={item}>{item}</Tag>
                ))}
                {product.tags.length > 3 ? (
                  <Text variant="bodySm" tone="subdued" as="span">
                    +{product.tags.length - 3}
                  </Text>
                ) : null}
              </InlineStack>
            ) : null}
          </BlockStack>
        </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100" wrap>
          {product.collections.length ? (
            product.collections.map((item) => <Tag key={item}>{item}</Tag>)
          ) : (
            <Text variant="bodySm" tone="subdued" as="span">
              None
            </Text>
          )}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">{product.vendor || "None"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">{product.type || "None"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text
          variant="bodyMd"
          alignment="end"
          tone={
            product.inventory === 0
              ? "critical"
              : product.inventory !== null && product.inventory < 5
                ? "caution"
                : undefined
          }
          fontWeight={product.inventory === 0 ? "semibold" : "regular"}
          as="span"
          numeric
        >
          {product.inventory ?? "n/a"}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Pick products to retire"
      subtitle="Select the products you're about to archive or delete"
      backAction={{ content: "Back", onAction: onBack }}
      primaryAction={{
        content: `Continue with ${selectedProducts.size} selected`,
        disabled: selectedProducts.size === 0,
        onAction: onNext,
      }}
    >
      <BlockStack gap="400">
        <Card>
          <div className="rml-preset-grid">
            {PRESET_OPTIONS.map((preset) => {
              const selected = selectedPreset === preset.id;
              return (
              <div
                key={preset.id}
                aria-pressed={selected}
                className={`rml-preset-card${selected ? " rml-preset-card--selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => applyQuickFilter(preset.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    applyQuickFilter(preset.id);
                  }
                }}
                style={scenarioStyle(preset)}
              >
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <RadioButton
                    label=""
                    checked={selected}
                    onChange={() => applyQuickFilter(preset.id)}
                  />
                  <Text variant="headingSm" as="span">
                    <span className="rml-preset-icon">{preset.icon}</span>
                    {preset.title}
                  </Text>
                </InlineStack>
              </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text variant="headingMd" as="h2">Filters</Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {selectedScenario?.description ??
                    "Combine vendor, season, collection, tag, stock, and update age before selecting products in bulk."}
                </Text>
              </BlockStack>
            </InlineStack>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <Select
                label="Vendor"
                options={vendorOptions}
                value={vendor}
                onChange={(value) => {
                  setVendor(value);
                  resetPagination();
                }}
              />
              <TextField
                label="Season keyword"
                value={season}
                onChange={(value) => {
                  setSeason(value);
                  resetPagination();
                }}
                placeholder="winter, summer 2026, fw25"
                autoComplete="off"
              />
              <Select
                label="Tag"
                options={tagOptions}
                value={tag}
                onChange={(value) => {
                  setTag(value);
                  resetPagination();
                }}
              />
              <Select
                label="Collection"
                options={collectionOptions}
                value={collection}
                onChange={(value) => {
                  setCollection(value);
                  resetPagination();
                }}
              />
              <Select
                label="Product type"
                options={productTypeOptions}
                value={type}
                onChange={(value) => {
                  setType(value);
                  resetPagination();
                }}
              />
              <Select
                label="Inventory"
                options={inventoryOptions}
                value={inventory}
                onChange={(value) => {
                  setInventory(value);
                  resetPagination();
                }}
              />
              <Select
                label="Last updated"
                options={updatedOptions}
                value={updated}
                onChange={(value) => {
                  setUpdated(value);
                  resetPagination();
                }}
              />
            </div>
          <InlineStack gap="150" blockAlign="center">
            <Text variant="bodySm" tone="subdued" as="span">
              {selectedInCurrentPage}/{products.length} selected on this page · {selectedProducts.size} total
            </Text>
          </InlineStack>
        </BlockStack>
      </Card>

        <Card padding="0">
          <IndexFilters
          tabs={tabs}
          selected={selectedTab}
          onSelect={handleTabSelect}
          mode={mode}
          setMode={setMode}
          queryValue={searchValue}
          queryPlaceholder="Search products"
          onQueryChange={handleQueryChange}
          onQueryClear={() => handleQueryChange("")}
          filters={filters}
          appliedFilters={appliedFilters}
          onClearAll={clearAllFilters}
          loading={showProductLoading}
          canCreateNewView={false}
        />
        {data?.error ? (
          <Box padding="400">
            <Banner tone="critical" title="Shopify could not load products">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">{data.error}</Text>
                <InlineStack gap="200">
                  <Button onClick={retryProductsLoad}>Retry</Button>
                  <Button onClick={clearAllFilters}>Clear filters</Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          </Box>
        ) : null}
        {productsLoadingTimedOut ? (
          <Box padding="400">
            <Banner tone="warning" title="Product sync is taking longer than expected">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  Shopify has not returned product data yet. You can retry the sync or clear filters to load a broader product list.
                </Text>
                <InlineStack gap="200">
                  <Button onClick={retryProductsLoad}>Retry</Button>
                  <Button onClick={clearAllFilters}>Clear filters</Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          </Box>
        ) : null}
          <IndexTable
            resourceName={{ singular: "product", plural: "products" }}
            itemCount={products.length}
            selectedItemsCount={selectedProducts.size}
            onSelectionChange={handleSelectionChange as never}
            loading={tableLoading}
            emptyState={
              <EmptySearchResult
                title="No products found"
                description={
                  hasActiveProductFilters
                    ? "Try clearing filters to load all products."
                    : "No products were returned for this store."
                }
                withIllustration
              />
            }
            pagination={{
              hasNext: pageInfo.hasNextPage,
              hasPrevious: pageStack.length > 1,
              onNext: () => {
                if (pageInfo.endCursor) {
                  setPageStack((prev) => [...prev, pageInfo.endCursor]);
                }
              },
              onPrevious: () => {
                setPageStack((prev) =>
                  prev.length > 1 ? prev.slice(0, -1) : prev,
                );
              },
            }}
            headings={[
              { title: "" },
              { title: "Product" },
              { title: "Collections" },
              { title: "Vendor" },
              { title: "Type" },
              { title: "Inventory", alignment: "end" },
            ]}
          >
            {productMarkup}
          </IndexTable>

          {/* Footer */}
          <div style={{ padding: "12px", borderTop: "1px solid var(--p-color-border-secondary, #ebebeb)", background: "var(--p-color-bg-surface-secondary, #fafafa)" }}>
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" tone="subdued" as="span">
                Showing {products.length} products on this page
              </Text>
              <Text variant="bodySm" tone="subdued" as="span">
                {selectedProducts.size} selected
              </Text>
            </InlineStack>
            </div>
        </Card>
        </BlockStack>
      </Page>
    );
  }

// ─── Step 4: Rules ───────────────────────────────────────────
function RulesStep({
  onBack,
  onNext,
  rules,
  setRules,
  selectedProducts,
  selectedPreset,
  setSelectedPreset,
}: {
  onBack(): void;
  onNext(): void;
  rules: RedirectRule[];
  setRules: Dispatch<SetStateAction<RedirectRule[]>>;
  selectedProducts: SelectedProductMap;
  selectedPreset: CleanupPreset;
  setSelectedPreset: (preset: CleanupPreset) => void;
}) {
  const createRule = (): RedirectRule => ({
    id: `rule-${Date.now()}`,
    field: "collection",
    condition: FIELD_CONFIG.collection.conditions[0].value,
    value: "",
    target: "bestSiblingProduct",
    targetOption: TARGET_CONFIG.bestSiblingProduct.options?.[0]?.value ?? "",
    targetValue: "",
    enabled: true,
    preserveQuery: true,
    stopOnMatch: true,
  });

  const [draftRule, setDraftRule] = useState<RedirectRule>(createRule);
  const [showAddForm, setShowAddForm] = useState(true);

  const enabledRules = rules.filter((rule) => rule.enabled);
  const rulesNeedingValue = rules.filter((rule) => getRuleErrors(rule).length > 0);
  const fallbackEnabled = rules.some(
    (rule) => rule.enabled && rule.field === "fallback",
  );
  const ruleCoverage = useMemo(() => {
    const coverage = new Map<string, number>();
    Array.from(selectedProducts.values()).forEach((product) => {
      const matchedRule = findMatchingRule(product, rules);
      if (matchedRule) {
        coverage.set(matchedRule.id, (coverage.get(matchedRule.id) ?? 0) + 1);
      }
    });
    return coverage;
  }, [rules, selectedProducts]);

  function updateRule(id: string, patch: Partial<RedirectRule>) {
    setRules((prev) =>
      prev.map((rule) =>
        rule.id === id ? normalizeRule({ ...rule, ...patch }) : rule,
      ),
    );
  }

  function moveRule(index: number, direction: -1 | 1) {
    setRules((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [rule] = next.splice(index, 1);
      next.splice(nextIndex, 0, rule);
      return next;
    });
  }

  function duplicateRule(index: number) {
    setRules((prev) => {
      const source = prev[index];
      const copy: RedirectRule = {
        ...source,
        id: `rule-${Date.now()}`,
        enabled: true,
      };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((rule) => rule.id !== id));
  }

  function addDraftRule() {
    const normalized = normalizeRule(draftRule);
    if (getRuleErrors(normalized).length > 0) return;
    setRules((prev) => [...prev, normalized]);
    setDraftRule(createRule());
    setShowAddForm(false);
  }

  function applyPreset(preset: CleanupPreset) {
    setSelectedPreset(preset);
    setRules(rulesForPreset(preset, { selectedProducts }));
  }

  return (
    <Page
      title="Redirect rules"
      subtitle="Evaluated top-down — first match wins"
      backAction={{ content: "Back", onAction: onBack }}
      primaryAction={{
        content: "Save & continue",
        disabled: rulesNeedingValue.length > 0 || enabledRules.length === 0,
        onAction: onNext,
      }}
      secondaryActions={[
        {
          content: "Clear rules",
          onAction: () => {
            setSelectedPreset("none");
            setRules([]);
            setShowAddForm(false);
            setDraftRule(createRule());
          },
        },
      ]}
    >
      <BlockStack gap="400">
        <Card>
          <div className="rml-preset-grid">
            {PRESET_OPTIONS.map((preset) => {
              const selected = selectedPreset === preset.id;
              return (
              <div
                key={preset.id}
                aria-pressed={selected}
                className={`rml-preset-card${selected ? " rml-preset-card--selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => applyPreset(preset.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    applyPreset(preset.id);
                  }
                }}
                style={scenarioStyle(preset)}
              >
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <RadioButton
                    label=""
                    checked={selected}
                    onChange={() => applyPreset(preset.id)}
                  />
                  <Text variant="headingSm" as="span">
                    <span className="rml-preset-icon">{preset.icon}</span>
                    {preset.title}
                  </Text>
                </InlineStack>
              </div>
              );
            })}
          </div>
        </Card>

        <Banner tone="info">
          Rules run in order. The first enabled rule that matches a retired product decides the redirect target for that product.
        </Banner>

        {rulesNeedingValue.length > 0 ? (
          <Banner tone="critical" title="Some rules need attention">
            Fill in the required match values or destination before continuing.
          </Banner>
        ) : null}

        {!fallbackEnabled ? (
          <Banner tone="warning" title="No fallback rule is enabled">
            Products that do not match an enabled rule will be skipped in the redirect preview.
          </Banner>
        ) : null}

        <BlockStack gap="400">
            <Card padding="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text variant="headingMd" as="h2">Rule priority</Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Put precise rules first, broad fallback rules last.
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={() => {
                      setDraftRule(createRule());
                      setShowAddForm(true);
                    }}
                  >
                    Add rule
                  </Button>
                </InlineStack>
              </Box>
              <Divider />

              <BlockStack gap="0">
                  {rules.map((rule, index) => {
                    const fieldConfig = FIELD_CONFIG[rule.field];
                    const targetConfig = TARGET_CONFIG[rule.target];
                    const targetOptions = targetConfig.options ?? [];
                    const ruleErrors = getRuleErrors(rule);
                    const coverageCount = ruleCoverage.get(rule.id) ?? 0;
                    const coveragePercent =
                      selectedProducts.size > 0
                        ? Math.round((coverageCount / selectedProducts.size) * 100)
                        : null;
                    const valueDisabled = fieldConfig.valuesDisabled || isValueDisabled(rule);
                  const targetValueVisible =
                    targetConfig.needsValue ||
                    (rule.target === "searchResults" &&
                      rule.targetOption === "custom");

                  return (
                    <div
                      key={rule.id}
                      style={{
                        padding: 16,
                        borderBottom:
                          "1px solid var(--p-color-border-secondary, #ebebeb)",
                        opacity: rule.enabled ? 1 : 0.62,
                      }}
                    >
                      <BlockStack gap="300">
                        <InlineStack gap="200" align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                border:
                                  "1px solid var(--p-color-border, #e1e1e1)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 13,
                                fontWeight: 600,
                                background: "#fff",
                              }}
                            >
                              {index + 1}
                            </div>
                            <Badge
                              tone={
                                rule.field === "fallback"
                                  ? "warning"
                                  : rule.enabled
                                    ? "info"
                                    : undefined
                              }
                            >
                              {getOptionLabel(RULE_FIELD_OPTIONS, rule.field)}
                            </Badge>
                              {ruleErrors.length ? (
                                <Badge tone="critical">Needs value</Badge>
                              ) : null}
                              <Text variant="bodySm" tone="subdued" as="span">
                                Coverage:{" "}
                                {coveragePercent === null
                                  ? "select products first"
                                  : `${coverageCount}/${selectedProducts.size} (${coveragePercent}%)`}
                              </Text>
                            </InlineStack>

                          <InlineStack gap="150" blockAlign="center">
                            <Button
                              size="slim"
                              disabled={index === 0}
                              onClick={() => moveRule(index, -1)}
                            >
                              Move up
                            </Button>
                            <Button
                              size="slim"
                              disabled={index === rules.length - 1}
                              onClick={() => moveRule(index, 1)}
                            >
                              Move down
                            </Button>
                            <Button size="slim" onClick={() => duplicateRule(index)}>
                              Duplicate
                            </Button>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => removeRule(rule.id)}
                            >
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1.1fr",
                            gap: 12,
                          }}
                        >
                          <Select
                            label="When"
                            options={RULE_FIELD_OPTIONS}
                            value={rule.field}
                            onChange={(value) =>
                              updateRule(rule.id, {
                                field: value as RuleField,
                                condition:
                                  FIELD_CONFIG[value as RuleField].conditions[0].value,
                                value: "",
                              })
                            }
                            helpText={fieldConfig.helpText}
                          />
                          <Select
                            label="Condition"
                            options={fieldConfig.conditions}
                            value={rule.condition}
                            onChange={(value) =>
                              updateRule(rule.id, { condition: value, value: "" })
                            }
                          />
                          {fieldConfig.options ? (
                            <Select
                              label="Value"
                              options={fieldConfig.options}
                              value={rule.value || fieldConfig.options[0].value}
                              onChange={(value) =>
                                updateRule(rule.id, { value })
                              }
                              disabled={valueDisabled}
                              helpText={fieldConfig.valueHelpText}
                            />
                          ) : (
                            <TextField
                              label="Value"
                              value={rule.value}
                              onChange={(value) =>
                                updateRule(rule.id, { value })
                              }
                              placeholder={fieldConfig.placeholder}
                              disabled={valueDisabled}
                              error={ruleErrors[0]}
                              helpText={fieldConfig.valueHelpText}
                              autoComplete="off"
                            />
                          )}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: targetValueVisible
                              ? "1fr 1fr 1.1fr"
                              : "1fr 1fr",
                            gap: 12,
                          }}
                        >
                          <Select
                            label="Redirect to"
                            options={RULE_TARGET_OPTIONS}
                            value={rule.target}
                            onChange={(value) =>
                              updateRule(rule.id, {
                                target: value as RuleTarget,
                                targetOption:
                                  TARGET_CONFIG[value as RuleTarget].options?.[0]
                                    ?.value ?? "",
                                targetValue: "",
                              })
                            }
                            helpText={targetConfig.helpText}
                          />
                          <Select
                            label={targetConfig.optionLabel}
                            options={targetOptions}
                            value={rule.targetOption || targetOptions[0]?.value}
                            onChange={(value) =>
                              updateRule(rule.id, { targetOption: value })
                            }
                            disabled={targetOptions.length <= 1}
                            helpText={targetConfig.optionHelpText}
                          />
                          {targetValueVisible ? (
                            <TextField
                              label={targetConfig.valueLabel ?? "Destination"}
                              value={rule.targetValue}
                              onChange={(value) =>
                                updateRule(rule.id, { targetValue: value })
                              }
                              placeholder={targetConfig.valuePlaceholder}
                              error={ruleErrors.find((error) =>
                                error.includes("destination"),
                              )}
                              helpText={targetConfig.valueHelpText}
                              autoComplete="off"
                            />
                          ) : null}
                        </div>

                        <InlineStack gap="400" blockAlign="center">
                          <Checkbox
                            label="Enabled"
                            checked={rule.enabled}
                            onChange={(checked) =>
                              updateRule(rule.id, { enabled: checked })
                            }
                          />
                          <Checkbox
                            label="Preserve query string"
                            checked={rule.preserveQuery}
                            onChange={(checked) =>
                              updateRule(rule.id, { preserveQuery: checked })
                            }
                          />
                        </InlineStack>
                      </BlockStack>
                    </div>
                  );
                })}
              </BlockStack>
            </Card>

            {showAddForm ? (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">Add a rule</Text>
                    <Button onClick={() => setShowAddForm(false)}>Close</Button>
                  </InlineStack>
                  <RuleEditor
                    rule={draftRule}
                    onChange={(patch) =>
                      setDraftRule((current) => normalizeRule({ ...current, ...patch }))
                    }
                  />
                  <InlineStack align="end" gap="200">
                    <Button onClick={() => setDraftRule(createRule())}>
                      Clear
                    </Button>
                    <Button
                      variant="primary"
                      disabled={getRuleErrors(draftRule).length > 0}
                      onClick={addDraftRule}
                    >
                      Add rule
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ) : null}
        </BlockStack>
      </BlockStack>
    </Page>
  );
}

function RuleEditor({
  rule,
  onChange,
}: {
  rule: RedirectRule;
  onChange(patch: Partial<RedirectRule>): void;
}) {
  const fieldConfig = FIELD_CONFIG[rule.field];
  const targetConfig = TARGET_CONFIG[rule.target];
  const targetOptions = targetConfig.options ?? [];
  const errors = getRuleErrors(rule);
  const valueDisabled = fieldConfig.valuesDisabled || isValueDisabled(rule);
  const targetValueVisible =
    targetConfig.needsValue ||
    (rule.target === "searchResults" && rule.targetOption === "custom");

  return (
    <BlockStack gap="400">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Select
          label="When"
          options={RULE_FIELD_OPTIONS}
          value={rule.field}
          onChange={(value) =>
            onChange({
              field: value as RuleField,
              condition: FIELD_CONFIG[value as RuleField].conditions[0].value,
              value: "",
            })
          }
          helpText={fieldConfig.helpText}
        />
        <Select
          label="Condition"
          options={fieldConfig.conditions}
          value={rule.condition}
          onChange={(value) => onChange({ condition: value, value: "" })}
        />
      </div>

      {fieldConfig.options ? (
        <Select
          label="Value"
          options={fieldConfig.options}
          value={rule.value || fieldConfig.options[0].value}
          onChange={(value) => onChange({ value })}
          disabled={valueDisabled}
          helpText={fieldConfig.valueHelpText}
        />
      ) : (
        <TextField
          label="Value"
          value={rule.value}
          onChange={(value) => onChange({ value })}
          placeholder={fieldConfig.placeholder}
          disabled={valueDisabled}
          error={errors[0]}
          helpText={fieldConfig.valueHelpText}
          autoComplete="off"
        />
      )}

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Select
          label="Redirect to"
          options={RULE_TARGET_OPTIONS}
          value={rule.target}
          onChange={(value) =>
            onChange({
              target: value as RuleTarget,
              targetOption:
                TARGET_CONFIG[value as RuleTarget].options?.[0]?.value ?? "",
              targetValue: "",
            })
          }
          helpText={targetConfig.helpText}
        />
        <Select
          label={targetConfig.optionLabel}
          options={targetOptions}
          value={rule.targetOption || targetOptions[0]?.value}
          onChange={(value) => onChange({ targetOption: value })}
          disabled={targetOptions.length <= 1}
          helpText={targetConfig.optionHelpText}
        />
      </div>

      {targetValueVisible ? (
        <TextField
          label={targetConfig.valueLabel ?? "Destination"}
          value={rule.targetValue}
          onChange={(value) => onChange({ targetValue: value })}
          placeholder={targetConfig.valuePlaceholder}
          error={errors.find((error) => error.includes("destination"))}
          helpText={targetConfig.valueHelpText}
          autoComplete="off"
        />
      ) : null}

      <InlineStack gap="400" blockAlign="center">
        <Checkbox
          label="Enable this rule immediately"
          checked={rule.enabled}
          onChange={(checked) => onChange({ enabled: checked })}
        />
        <Checkbox
          label="Preserve query string"
          checked={rule.preserveQuery}
          onChange={(checked) => onChange({ preserveQuery: checked })}
        />
      </InlineStack>
    </BlockStack>
  );
}

function normalizeRule(rule: RedirectRule): RedirectRule {
  const fieldConfig = FIELD_CONFIG[rule.field];
  const condition = fieldConfig.conditions.some(
    (option) => option.value === rule.condition,
  )
    ? rule.condition
    : fieldConfig.conditions[0].value;
  const value =
    fieldConfig.valuesDisabled || isValueDisabled({ ...rule, condition })
      ? ""
      : fieldConfig.options &&
          !fieldConfig.options.some((option) => option.value === rule.value)
        ? fieldConfig.options[0].value
        : rule.value;

  const targetConfig = TARGET_CONFIG[rule.target];
  const targetOptions = targetConfig.options ?? [];
  const targetOption = targetOptions.some(
    (option) => option.value === rule.targetOption,
  )
    ? rule.targetOption
    : targetOptions[0]?.value ?? "";
  const needsTargetValue =
    targetConfig.needsValue ||
    (rule.target === "searchResults" && targetOption === "custom");

  return {
    ...rule,
    condition,
    value,
    targetOption,
    targetValue: needsTargetValue ? rule.targetValue : "",
  };
}

function getRuleErrors(rule: RedirectRule) {
  if (!rule.enabled) return [];

  const errors: string[] = [];
  const valueRequired =
    !FIELD_CONFIG[rule.field].valuesDisabled && !isValueDisabled(rule);
  if (valueRequired && !rule.value.trim()) {
    errors.push("Enter a match value.");
  }

  if (
    valueRequired &&
    ["inventory", "price", "age"].includes(rule.field) &&
    !isNumericRuleValue(rule.value, rule.condition)
  ) {
    errors.push(
      rule.condition === "between"
        ? "Enter two numbers separated by a comma."
        : "Enter a valid number.",
    );
  }

  if (rule.target === "customPath") {
    if (!rule.targetValue.trim()) {
      errors.push("Enter a destination.");
    } else if (!rule.targetValue.trim().startsWith("/")) {
      errors.push("Storefront destination paths must start with /.");
    }
  }

  if (
    rule.target === "searchResults" &&
    rule.targetOption === "custom" &&
    !rule.targetValue.trim()
  ) {
    errors.push("Enter a custom search destination.");
  }

  return errors;
}

function isValueDisabled(rule: Pick<RedirectRule, "condition">) {
  return ["empty", "zero", "notTracked", "anything"].includes(rule.condition);
}

function isNumericRuleValue(value: string, condition: string) {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (condition === "between") {
    return values.length === 2 && values.every((item) => Number.isFinite(Number(item)));
  }

  return values.length === 1 && Number.isFinite(Number(values[0]));
}

function getOptionLabel<T extends string>(
  options: { label: string; value: T }[],
  value: T,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function slugifyPathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductTitleSearchQuery(name: string) {
  return name.split("—")[0].trim() || name.trim();
}

function inferCollectionHandle(row: Pick<PreviewRedirectRow, "to" | "name">) {
  if (row.to.startsWith("/collections/") && row.to !== "/collections/all") {
    return row.to.replace("/collections/", "");
  }

  const titleParts = row.name.split("—").map((part) => part.trim());
  return slugifyPathPart(titleParts[0] ?? row.name);
}

function inferVendorHandle(row: Pick<PreviewRedirectRow, "to" | "name">) {
  if (row.to.startsWith("/collections/") && row.to !== "/collections/all") {
    return row.to.replace("/collections/", "");
  }

  return slugifyPathPart(row.name.split(" ")[0] ?? row.name);
}

function inferProductTypeHandle(row: Pick<PreviewRedirectRow, "name">) {
  const name = row.name.toLowerCase();
  if (name.includes("shirt")) return "shirts";
  if (name.includes("blazer")) return "blazers";
  if (name.includes("beanie") || name.includes("cap")) return "hats";
  if (name.includes("tote") || name.includes("bag")) return "bags";
  if (name.includes("sock")) return "socks";
  return slugifyPathPart(row.name.split("—")[0] ?? row.name);
}

function getPreviewDestination(
  row: PreviewRedirectRow,
  choice: PreviewTargetChoice,
  customTarget = row.customTarget,
) {
  switch (choice) {
    case "suggested":
      return row.originalTo;
    case "sameCollection":
      return `/collections/${inferCollectionHandle(row)}`;
    case "vendorCollection":
      return `/collections/${inferVendorHandle(row)}`;
    case "productTypeCollection":
      return `/collections/${inferProductTypeHandle(row)}`;
    case "search":
      return `/search?q=${encodeURIComponent(getProductTitleSearchQuery(row.name))}`;
    case "allProducts":
      return "/collections/all";
    case "homepage":
      return "/";
    case "custom":
      return customTarget;
    case "skip":
      return "";
  }
}

function isPreviewDestinationValid(row: PreviewRedirectRow) {
  if (row.targetChoice === "skip") return true;
  if (row.targetChoice !== "custom") return true;

  const value = row.customTarget.trim();
  return value.startsWith("/");
}

function exportRedirectsCsv(rows: GeneratedPreviewRow[], filename = "redirects.csv") {
  const header = ["Redirect from", "Redirect to", "Product", "Rule", "Confidence"];
  const csvRows = rows.map((row) =>
    [row.from, row.to, row.name, row.via, row.confidence]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[header.join(","), ...csvRows].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

function ruleMatchesProduct(rule: RedirectRule, product: ProductRow) {
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

function numericConditionMatches(actual: number, value: string, condition: string) {
  const numbers = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  const first = numbers[0];

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

function findMatchingRule(product: ProductRow, rules: RedirectRule[]) {
  return rules.find((rule) => ruleMatchesProduct(rule, product)) ?? null;
}

function targetForRule(product: ProductRow, rule: RedirectRule | null) {
  if (!rule) return "/collections/all";

  switch (rule.target) {
    case "sameCollection":
      return product.collections[0]
        ? `/collections/${slugifyPathPart(product.collections[0])}`
        : "/collections/all";
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
      return product.type ? `/collections/${slugifyPathPart(product.type)}` : "/collections/all";
    case "vendorCollection":
      return product.vendor ? `/collections/${slugifyPathPart(product.vendor)}` : "/collections/all";
    case "tagCollection":
      return rule.value
        ? `/collections/${slugifyPathPart(parseRuleValues(rule.value)[0] ?? "all")}`
        : "/collections/all";
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
        case "custom":
          searchQuery = rule.targetValue.trim();
          break;
        default:
          searchQuery =
            product.type ||
            product.vendor ||
            getProductTitleSearchQuery(product.name);
      }

      return `/search?q=${encodeURIComponent(
        searchQuery ||
          product.type ||
          product.vendor ||
          getProductTitleSearchQuery(product.name),
      )}`;
    }
    case "allProducts":
      return "/collections/all";
    case "customPath":
      return rule.targetValue || "/collections/all";
    case "homepage":
      return "/";
    case "noRedirect":
      return "";
  }
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
      } else if (rule.targetOption === "inventoryCollection" || rule.targetOption === "newestCollection") {
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
      score += rule.value ? 8 : -20;
      break;
    case "searchResults":
      score -= 4;
      if (hasType || hasVendor) score += 5;
      break;
    case "customPath":
      score += rule.targetValue.startsWith("/") ? 4 : -8;
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

function buildPreviewRows(
  selectedProducts: SelectedProductMap,
  rules: RedirectRule[],
) {
  return Array.from(selectedProducts.values()).map((product) => {
    const rule = findMatchingRule(product, rules);
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
      originalTo: to,
      via: rule ? getOptionLabel(RULE_FIELD_OPTIONS, rule.field) : "Fallback",
      confidence: confidence.confidence,
      tone: confidence.tone,
      targetChoice,
      customTarget: rule?.target === "customPath" ? rule.targetValue : "",
      edited: false,
    } satisfies GeneratedPreviewRow;
  });
}

// ─── Step 5: Preview ─────────────────────────────────────────
function PreviewStep({
  onBack,
  onNext,
  selectedProducts,
  rules,
  rows,
  setRows,
}: {
  onBack(): void;
  onNext(): void;
  selectedProducts: SelectedProductMap;
  rules: RedirectRule[];
  rows: GeneratedPreviewRow[];
  setRows: Dispatch<SetStateAction<GeneratedPreviewRow[]>>;
}) {
  const generatedRows = useMemo(
    () => buildPreviewRows(selectedProducts, rules),
    [selectedProducts, rules],
  );
  const [confidenceFilter, setConfidenceFilter] = useState("All");
  const [ruleFilter, setRuleFilter] = useState("All");
  const [openTargetMenuId, setOpenTargetMenuId] = useState<string | null>(null);

  useEffect(() => {
    const rowIdentity = (row: GeneratedPreviewRow) =>
      `${row.id}:${row.originalTo}:${row.via}`;
    const currentSignature = rows
      .map(rowIdentity)
      .join("|");
    const nextSignature = generatedRows
      .map(rowIdentity)
      .join("|");

    if (currentSignature !== nextSignature) {
      setRows(generatedRows);
    }
  }, [generatedRows, rows, setRows]);

  const filteredRows = rows.filter((row) => {
    const matchesConfidence =
      confidenceFilter === "All" || row.confidence === confidenceFilter;
    const matchesRule = ruleFilter === "All" || row.via === ruleFilter;
    return matchesConfidence && matchesRule;
  });

  const applicableRows = rows.filter(
    (row) => row.targetChoice !== "skip" && isPreviewDestinationValid(row),
  );
  const selectedApplicableCount = rows.filter(
    (row) =>
      row.targetChoice !== "skip" &&
      isPreviewDestinationValid(row),
  ).length;
  const selectedInvalidCount = rows.filter(
    (row) => row.targetChoice !== "skip" && !isPreviewDestinationValid(row),
  ).length;

  const updatePreviewRow = (
    id: string,
    patch: Partial<Pick<PreviewRedirectRow, "targetChoice" | "customTarget">>,
  ) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        const to = getPreviewDestination(next, next.targetChoice);
        return { ...next, to, confidence: "High", tone: "success", edited: true };
      }),
    );

  };

  const highCount = rows.filter((r) => r.confidence === "High").length;
  const mediumCount = rows.filter((r) => r.confidence === "Medium").length;
  const lowCount = rows.filter((r) => r.confidence === "Low").length;
  const editedCount = rows.filter((r) => r.edited).length;
  const skippedCount = rows.filter((r) => r.targetChoice === "skip").length;
  const invalidCount = rows.filter((r) => !isPreviewDestinationValid(r)).length;

  const confidenceOptions = [
    { label: "All", value: "All" },
    { label: "High", value: "High" },
    { label: "Medium", value: "Medium" },
    { label: "Low", value: "Low" },
  ];

  const ruleOptions = [
    { label: "All", value: "All" },
    ...Array.from(new Set(rows.map((row) => row.via))).map((rule) => ({
      label: rule,
      value: rule,
    })),
  ];

  const visibleLowCount = filteredRows.filter((row) => row.confidence === "Low").length;

  return (
    <Page
      title="Review redirects"
      subtitle={`${applicableRows.length} redirects ready · ${highCount} high confidence · ${lowCount} need attention`}
      backAction={{ content: "Back to selection", onAction: onBack }}
      primaryAction={{
        content: `Apply ${selectedApplicableCount} redirects`,
        disabled: selectedApplicableCount === 0 || selectedInvalidCount > 0,
        onAction: onNext,
      }}
    >
      <BlockStack gap="400">
        {invalidCount > 0 ? (
          <Banner tone="critical" title={`${invalidCount} custom target needs a valid path`}>
            Custom destinations must start with / before you can apply selected redirects.
          </Banner>
        ) : lowCount > 0 ? (
          <Banner tone="warning" title={`${lowCount} products got a low-confidence target`}>
            Review the rows highlighted yellow before applying. Change any target dropdown to override the suggestion.
          </Banner>
        ) : null}

        <Card padding="0">
          {/* Filter bar */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--p-color-border-secondary, #ebebeb)" }}>
            <InlineStack gap="200" blockAlign="center">
              <Select
                label="Confidence:"
                labelInline
                options={confidenceOptions}
                value={confidenceFilter}
                onChange={setConfidenceFilter}
              />
              <Select
                label="Rule:"
                labelInline
                options={ruleOptions}
                value={ruleFilter}
                onChange={setRuleFilter}
              />
              <div style={{ flex: 1 }} />
              <Text variant="bodySm" tone="subdued" as="span">
                {filteredRows.length} shown · {selectedApplicableCount} ready
              </Text>
            </InlineStack>
          </div>

          <IndexTable
            resourceName={{ singular: "redirect", plural: "redirects" }}
            itemCount={filteredRows.length}
            selectable={false}
            headings={[
              { title: "" },
              { title: "From (will be retired)" },
              { title: "Redirects to" },
              { title: "Via rule" },
              { title: "Confidence" },
              { title: "" },
            ]}
          >
            {filteredRows.map((row, index) => {
              const targetIsInvalid = !isPreviewDestinationValid(row);

              return (
              <IndexTable.Row
                id={row.id}
                key={row.id}
                position={index}
                tone={
                  targetIsInvalid || row.confidence === "Low" ? "warning" : undefined
                }
              >
                <IndexTable.Cell>
                  <Thumbnail
                    size="small"
                    source={row.imageUrl || "/favicon.ico"}
                    alt={row.imageAlt || row.name}
                  />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text variant="bodyMd" fontWeight="semibold" as="span">{row.name}</Text>
                    <Text variant="bodySm" tone="subdued" as="span">
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{row.from}</span>
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="150">
                    {row.targetChoice === "custom" ? (
                      <TextField
                        label="Custom target"
                        labelHidden
                        value={row.customTarget}
                        onChange={(value) =>
                          updatePreviewRow(row.id, { customTarget: value })
                        }
                        placeholder="/collections/sale"
                        error={targetIsInvalid ? "Use a /path destination" : undefined}
                        autoComplete="off"
                      />
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          border: targetIsInvalid
                            ? "1px solid var(--p-color-border-critical, #e51c00)"
                            : "1px solid var(--p-color-border, #e1e1e1)",
                          borderRadius: 8,
                          padding: "6px 10px",
                          background: "#fff",
                          minHeight: 34,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, monospace",
                            fontSize: 13,
                            flex: 1,
                            color:
                              row.targetChoice === "skip"
                                ? "var(--p-color-text-secondary, #616161)"
                                : "inherit",
                          }}
                        >
                          {row.targetChoice === "skip" ? "No redirect will be created" : row.to}
                        </span>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 20 20"
                          fill="var(--p-color-text-secondary, #616161)"
                          style={{ flexShrink: 0 }}
                          aria-hidden="true"
                        >
                          <path d="M14.7 2.3l3 3a1 1 0 0 1 0 1.4l-9 9a1 1 0 0 1-.5.3l-4 1a1 1 0 0 1-1.2-1.2l1-4a1 1 0 0 1 .3-.5l9-9a1 1 0 0 1 1.4 0z" />
                        </svg>
                      </div>
                    )}
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={row.via === "Collection" ? "info" : row.via === "Vendor" ? "new" : "warning"}>
                    {row.via}
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="100">
                    <Badge tone={row.tone}>{row.confidence}</Badge>
                    {row.targetChoice === "skip" ? (
                      <Badge>Skipped</Badge>
                    ) : row.edited ? (
                      <Badge tone="info">Edited</Badge>
                    ) : null}
                  </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Popover
                    active={openTargetMenuId === row.id}
                    activator={
                      <Button
                        size="slim"
                        onClick={() =>
                          setOpenTargetMenuId((current) =>
                            current === row.id ? null : row.id,
                          )
                        }
                        accessibilityLabel={`Change redirect target for ${row.name}`}
                      >
                        ...
                      </Button>
                    }
                    onClose={() => setOpenTargetMenuId(null)}
                  >
                    <ActionList
                      items={PREVIEW_TARGET_OPTIONS.map((option) => ({
                        content:
                          option.value === row.targetChoice
                            ? `${option.label} ✓`
                            : option.label,
                        onAction: () => {
                          updatePreviewRow(row.id, {
                            targetChoice: option.value,
                          });
                          setOpenTargetMenuId(null);
                        },
                      }))}
                    />
                  </Popover>
                </IndexTable.Cell>
              </IndexTable.Row>
              );
            })}
          </IndexTable>

          {/* Footer */}
          <div style={{ padding: "12px", borderTop: "1px solid var(--p-color-border-secondary, #ebebeb)", background: "var(--p-color-bg-surface-secondary, #fafafa)" }}>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="150">
                <Badge tone="success">{`${highCount} high`}</Badge>
                <Badge tone="info">{`${mediumCount} medium`}</Badge>
                <Badge tone="warning">{`${lowCount} low`}</Badge>
                <Text variant="bodySm" tone="subdued" as="span">
                  · {applicableRows.length} ready · {editedCount} edited · {skippedCount} skipped
                </Text>
              </InlineStack>
              {visibleLowCount !== lowCount ? (
                <Button
                  variant="plain"
                  removeUnderline
                  onClick={() => {
                    setConfidenceFilter("Low");
                    setRuleFilter("All");
                  }}
                >
                  Show only low-confidence
                </Button>
              ) : (
                <Button
                  variant="plain"
                  removeUnderline
                  onClick={() => {
                    setConfidenceFilter("All");
                    setRuleFilter("All");
                  }}
                >
                  Show all
                </Button>
              )}
            </InlineStack>
          </div>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ─── Step 6: Apply ───────────────────────────────────────────
function ApplyStep({
  onBack,
  onComplete,
  rows,
  cleanupMode,
  setCleanupMode,
  planInfo,
}: {
  onBack(): void;
  onComplete(result: CleanupResult): void;
  rows: GeneratedPreviewRow[];
  cleanupMode: CleanupMode;
  setCleanupMode: Dispatch<SetStateAction<CleanupMode>>;
  planInfo: {
    plan: "free" | "standard";
    redirectsUsed: number;
    redirectLimit: number | null;
  };
}) {
  const applyFetcher = useFetcher<typeof applyAction>();
  const [confirmed, setConfirmed] = useState(false);
  const [planOverrideAllowed, setPlanOverrideAllowed] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasCompletedApply, setHasCompletedApply] = useState(false);
  const applyData = applyFetcher.data;

  const applyRows = rows.filter(
    (row) =>
      row.targetChoice !== "skip" &&
      isPreviewDestinationValid(row),
  );
  const invalidRows = rows.filter(
    (row) => row.targetChoice !== "skip" && !isPreviewDestinationValid(row),
  );
  const skippedRows = rows.filter((row) => row.targetChoice === "skip");
  const lowConfidenceRows = applyRows.filter((row) => row.confidence === "Low");
  const duplicateSources = applyRows.filter(
    (row, index) => applyRows.findIndex((item) => item.from === row.from) !== index,
  );
  const conflicts = [...duplicateSources];
  const productsRetired = cleanupMode === "redirects" ? 0 : applyRows.length;
  const currentUsage = planInfo.redirectsUsed;
  const planLimit = planInfo.redirectLimit;
  const projectedUsage = currentUsage + applyRows.length;
  const hasLimit = planLimit !== null;
  const planProgress = hasLimit
    ? Math.min(100, Math.round((projectedUsage / planLimit) * 100))
    : 0;
  const overPlanLimit = hasLimit ? projectedUsage > planLimit : false;
  const canUseFreePlanOverride =
    overPlanLimit &&
    currentUsage < FREE_PLAN_OVERRIDE_REDIRECT_LIMIT &&
    projectedUsage <= FREE_PLAN_OVERRIDE_REDIRECT_LIMIT;
  const effectivePlanOverrideAllowed =
    planOverrideAllowed && canUseFreePlanOverride;
  const mustConfirmDelete = cleanupMode === "delete";
  const isApplying = applyFetcher.state !== "idle";
  const operationErrors = [
    ...((applyData?.redirects ?? []).filter((result) => !result.ok)),
    ...((applyData?.products ?? []).filter((result) => !result.ok)),
  ];
  const devShopifyApiLogs = applyData?.dev?.shopifyApiLogs;

  const modes = [
    {
      id: "redirects" as const,
      title: "Redirects only",
      description: "Create redirects and leave products unchanged.",
    },
    {
      id: "archive" as const,
      title: "Redirects + archive",
      description: "Archive selected products after redirects are created.",
      recommended: true,
    },
    {
      id: "delete" as const,
      title: "Redirects + delete",
      description: "Delete selected products after redirects are created.",
      danger: true,
    },
  ];

  const steps = [
    `${applyRows.length} URL redirects will be created in Shopify.`,
    cleanupMode === "redirects"
      ? "Selected products will stay unchanged."
      : cleanupMode === "archive"
        ? `${productsRetired} products will be archived after redirect creation.`
        : `${productsRetired} products will be deleted after redirect creation.`,
    skippedRows.length
      ? `${skippedRows.length} skipped products will be left out.`
      : "No selected products are marked to skip.",
  ];

  useEffect(() => {
    if (!isApplying) return undefined;

    const interval = window.setInterval(() => {
      setProgress((current) => {
        return Math.min(90, current + 10);
      });
    }, 250);

    return () => window.clearInterval(interval);
  }, [isApplying]);

  useEffect(() => {
    if (!applyData || !applyData.ok || hasCompletedApply) return;

    setProgress(100);
    setHasCompletedApply(true);
    window.setTimeout(() => {
      const redirectsCreated = applyData.redirects.filter((result) => result.ok).length;
      const productsChanged = applyData.products.filter((result) => result.ok).length;
      onComplete({
        id: applyData.cleanupId ?? String(Date.now()),
        completedAt: applyData.completedAt ? new Date(applyData.completedAt) : new Date(),
        mode: cleanupMode,
        redirectsCreated,
        productsRetired: cleanupMode === "redirects" ? 0 : productsChanged,
        skipped: skippedRows.length,
        conflicts: conflicts.length,
        lowConfidence: lowConfidenceRows.length,
      });
    }, 300);
  }, [
    applyData,
    cleanupMode,
    conflicts.length,
    hasCompletedApply,
    lowConfidenceRows.length,
    onComplete,
    skippedRows.length,
  ]);

  useEffect(() => {
    if (!DEV || !devShopifyApiLogs?.length) return;

    console.groupCollapsed(
      `[DEV] Shopify API responses while applying redirects (${devShopifyApiLogs.length})`,
    );
    console.table(
      devShopifyApiLogs.map((log) => ({
        operation: log.operation,
        product: log.productName ?? log.productId ?? "",
        from: log.from ?? "",
        to: log.to ?? "",
      })),
    );
    devShopifyApiLogs.forEach((log) => console.log(log.operation, log));
    console.groupEnd();
  }, [devShopifyApiLogs]);

  const primaryDisabled =
    applyRows.length === 0 ||
    invalidRows.length > 0 ||
    isApplying ||
    (mustConfirmDelete && !confirmed) ||
    (overPlanLimit && !effectivePlanOverrideAllowed);

  const submitApply = () => {
    const formData = new FormData();
    formData.set(
      "payload",
      JSON.stringify({
        mode: cleanupMode,
        redirects: applyRows.map((row) => ({
          productId: row.id,
          productName: row.name,
          productImageUrl: row.imageUrl,
          productImageAlt: row.imageAlt,
          from: row.from,
          to: row.to,
          ruleLabel: row.via,
          confidence: row.confidence,
          targetChoice: row.targetChoice,
        })),
        summary: {
          totalSelected: rows.length,
          skipped: skippedRows.length,
          conflicts: conflicts.length,
          lowConfidence: lowConfidenceRows.length,
          planOverrideAllowed: effectivePlanOverrideAllowed,
        },
      }),
    );
    setProgress(0);
    setHasCompletedApply(false);
    applyFetcher.submit(formData, {
      method: "post",
      action: "/app/apply",
    });
  };

  return (
    <>
      <Page
      title={`Apply ${applyRows.length} redirects?`}
      subtitle="Last chance to confirm — this writes to your store"
      backAction={{ content: "Back to preview", onAction: onBack }}
      primaryAction={{
        content: isApplying ? "Applying..." : "Apply now",
        disabled: primaryDisabled,
        loading: isApplying,
        onAction: submitApply,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <BlockStack gap="400">
          {operationErrors.length ? (
            <Banner
              tone="critical"
              title={`${operationErrors.length} operation${operationErrors.length > 1 ? "s" : ""} failed`}
            >
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  The following Shopify operations could not be completed. No partial changes were rolled back — check History for what was saved.
                </Text>
                <BlockStack gap="100">
                  {operationErrors.map((err, i) => (
                    <div
                      key={i}
                      style={{
                        background: "rgba(0,0,0,.04)",
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        fontSize: 12,
                        lineHeight: 1.6,
                        wordBreak: "break-word",
                      }}
                    >
                      {"productId" in err && !("from" in err) ? (
                        <>
                          <div><strong>Product ID:</strong> {(err as { productId: string }).productId}</div>
                          <div><strong>Operation:</strong> {(err as { operation?: string }).operation ?? "product"}</div>
                        </>
                      ) : (
                        <>
                          <div><strong>Product:</strong> {(err as { productName: string }).productName}</div>
                          <div><strong>From:</strong> {(err as { from: string }).from}</div>
                          <div><strong>To:</strong> {(err as { to: string }).to}</div>
                        </>
                      )}
                      <div><strong>Error:</strong> {err.message ?? "No error message returned by Shopify."}</div>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Banner>
          ) : null}

          {invalidRows.length ? (
            <Banner tone="critical" title={`${invalidRows.length} invalid redirect targets`}>
              Go back to review and fix custom destinations before applying.
            </Banner>
          ) : null}

          {overPlanLimit ? (
            <Banner
              tone={canUseFreePlanOverride ? "warning" : "critical"}
              title={
                canUseFreePlanOverride
                  ? "This cleanup exceeds the free plan limit"
                  : "This cleanup exceeds the free allowance"
              }
            >
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  Applying these redirects would use {projectedUsage} of {planLimit} redirect slots.
                </Text>
                {canUseFreePlanOverride ? (
                  <InlineStack gap="200" blockAlign="center">
                    <Button
                      variant="primary"
                      disabled={effectivePlanOverrideAllowed}
                      onClick={() => {
                        setPlanOverrideAllowed(true);
                        setReviewModalOpen(true);
                      }}
                    >
                      {effectivePlanOverrideAllowed ? "Free override enabled" : "Apply changes anyway"}
                    </Button>
                    {effectivePlanOverrideAllowed ? (
                      <Text variant="bodySm" tone="subdued" as="span">
                        You can apply this cleanup now. Free overrides are available up to {FREE_PLAN_OVERRIDE_REDIRECT_LIMIT} redirects.
                      </Text>
                    ) : null}
                  </InlineStack>
                ) : (
                  <Text variant="bodyMd" as="p">
                    Free overrides are available only up to {FREE_PLAN_OVERRIDE_REDIRECT_LIMIT} redirects created with the app. Upgrade to continue applying redirects from here.
                  </Text>
                )}
              </BlockStack>
            </Banner>
          ) : null}

          {lowConfidenceRows.length ? (
            <Banner tone="warning" title={`${lowConfidenceRows.length} low-confidence redirects`}>
              These redirects are valid, but their destination was broad or fallback-based.
            </Banner>
          ) : null}

          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">What will happen</Text>
              <BlockStack gap="200">
                {steps.map((text, i) => (
                  <InlineStack key={text} gap="200" blockAlign="start" wrap={false}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "#303030", color: "#fff",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 1,
                    }}>
                      {i + 1}
                    </div>
                    <Text variant="bodyMd" as="span">{text}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
              {isApplying ? (
                <BlockStack gap="150">
                  <ProgressBar progress={progress} tone="primary" size="small" />
                  <Text variant="bodySm" tone="subdued" as="span">
                    {progress < 45
                      ? "Creating redirects"
                      : progress < 80
                        ? "Updating products"
                        : "Finishing cleanup"}
                  </Text>
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Cleanup mode</Text>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {modes.map((mode) => (
                  <div
                    key={mode.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setCleanupMode(mode.id);
                      setConfirmed(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setCleanupMode(mode.id);
                        setConfirmed(false);
                      }
                    }}
                    style={{
                      border: cleanupMode === mode.id ? "2px solid #303030" : "1px solid var(--p-color-border, #e1e1e1)",
                      background: cleanupMode === mode.id ? "var(--p-color-bg-surface-secondary, #fafafa)" : "#fff",
                      borderRadius: 8, padding: 14, position: "relative", cursor: "pointer",
                    }}
                  >
                    {mode.recommended && (
                      <div style={{ position: "absolute", top: -10, right: 10 }}>
                        <Badge tone="success">Recommended</Badge>
                      </div>
                    )}
                    <InlineStack gap="200" blockAlign="start" wrap={false}>
                      <RadioButton
                        label=""
                        checked={cleanupMode === mode.id}
                        onChange={() => {
                          setCleanupMode(mode.id);
                          setConfirmed(false);
                        }}
                        id={`mode-${mode.id}`}
                        name="cleanup-mode"
                      />
                      <BlockStack gap="100">
                        <Text variant="headingSm" tone={mode.danger ? "critical" : undefined} as="h3">
                          {mode.title}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="p">{mode.description}</Text>
                      </BlockStack>
                    </InlineStack>
                  </div>
                ))}
              </div>
              {mustConfirmDelete ? (
                <Checkbox
                  label="I understand products will be permanently deleted"
                  checked={confirmed}
                  onChange={setConfirmed}
                />
              ) : null}
            </BlockStack>
          </Card>

          {conflicts.length ? (
            <Banner tone="warning" title={`${conflicts.length} source URL conflicts`}>
              Duplicate source URLs were found in the selected redirects. Go back to review if you want to remove duplicates.
            </Banner>
          ) : null}
        </BlockStack>

        <BlockStack gap="400">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Summary</Text>
              <Divider />
              {[
                ["Products selected", String(rows.length)],
                ["Products retired", String(productsRetired)],
                ["Redirects created", String(applyRows.length)],
                ["Skipped", String(skippedRows.length)],
                ["Conflicts", String(conflicts.length)],
              ].map(([label, value]) => (
                <InlineStack key={label} align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="subdued" as="span">{label}</Text>
                  <Text variant="bodyMd" fontWeight="semibold" as="span">{value}</Text>
                </InlineStack>
              ))}
              <Divider />
              <BlockStack gap="150">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="subdued" as="span">
                    {planInfo.plan === "free" ? "Free plan usage" : "Standard plan usage"}
                  </Text>
                  <Text variant="bodyMd" fontWeight="semibold" tone={overPlanLimit ? "critical" : undefined} as="span">
                    {hasLimit ? `${projectedUsage} / ${planLimit}` : `${projectedUsage} (unlimited)`}
                  </Text>
                </InlineStack>
                {hasLimit ? (
                  <ProgressBar progress={planProgress} tone={overPlanLimit ? "critical" : "primary"} size="small" />
                ) : null}
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">Export instead</Text>
              <Text variant="bodySm" tone="subdued" as="p">
                Download the selected redirects as a Shopify-compatible CSV.
              </Text>
              <Button
                fullWidth
                disabled={!applyRows.length}
                onClick={() => exportRedirectsCsv(applyRows)}
              >
                Download redirects.csv
              </Button>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </Page>
    <Modal
      open={reviewModalOpen && canUseFreePlanOverride}
      onClose={() => setReviewModalOpen(false)}
      title="Keep using Redirect Mapper Lite for free"
      primaryAction={{
        content: "Continue",
        onAction: () => setReviewModalOpen(false),
      }}
    >
      <Modal.Section>
        <BlockStack gap="200">
          <Text variant="bodyMd" as="p">
            You can keep using the app for free, even when this cleanup goes over the free plan limit.
          </Text>
          <Text variant="bodyMd" as="p">
            This temporary exception is limited to {FREE_PLAN_OVERRIDE_REDIRECT_LIMIT} redirects created with the app.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
    </>
  );
}

// ─── Step 7: Success ─────────────────────────────────────────
function SuccessStep({
  onRestart,
  result,
  rows,
}: {
  onRestart(): void;
  result: CleanupResult | null;
  rows: GeneratedPreviewRow[];
}) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const appliedRows = rows.filter(
    (row) =>
      row.targetChoice !== "skip" &&
      isPreviewDestinationValid(row),
  );
  const fallbackResult: CleanupResult = {
    id: String(Date.now()),
    completedAt: new Date(),
    mode: "archive",
    redirectsCreated: appliedRows.length,
    productsRetired: appliedRows.length,
    skipped: rows.filter((row) => row.targetChoice === "skip").length,
    conflicts: 0,
    lowConfidence: appliedRows.filter((row) => row.confidence === "Low").length,
  };
  const cleanup = result ?? fallbackResult;
  const cleanupLabel = `cleanup-${cleanup.id}`;
  const productsAction =
    cleanup.mode === "redirects"
      ? "Products unchanged"
      : cleanup.mode === "archive"
        ? "Products archived"
        : "Products deleted";

  const copyShareLink = async () => {
    const shareUrl = `${window.location.origin}/app/history?cleanup=${cleanup.id}`;
    await navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const openShopifyRedirects = () => {
    window.open("/admin/online_store/navigation/redirects", "_blank", "noopener,noreferrer");
  };

  return (
    <Page
      title="Cleanup complete"
      subtitle={`${cleanup.redirectsCreated} redirects created · ${productsAction.toLowerCase()}`}
      primaryAction={{ content: "Start another cleanup", onAction: onRestart }}
      secondaryActions={[{ content: "View in Shopify admin", onAction: openShopifyRedirects }]}
    >
      <BlockStack gap="400">
        <Card padding="500">
          <InlineStack gap="400" blockAlign="center" wrap={false}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "#cdfee1",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                <path d="M8 18 L15 25 L28 11" stroke="#0c5132" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <BlockStack gap="100">
              <Text variant="headingLg" as="h2">All done — no 404s today</Text>
              <Text variant="bodyMd" tone="subdued" as="p">
                {cleanupLabel} saved to history. You can review, export, or roll it back from the history page.
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
          {[
            { n: String(cleanup.redirectsCreated), label: "Redirects created" },
            { n: String(cleanup.productsRetired), label: productsAction },
            { n: String(cleanup.skipped), label: "Skipped" },
            { n: String(cleanup.lowConfidence), label: "Low confidence" },
            { n: "0", label: "Errors" },
          ].map((stat) => (
            <Card key={stat.label}>
              <BlockStack gap="100">
                <Text variant="headingXl" as="p">{stat.n}</Text>
                <Text variant="bodySm" tone="subdued" as="p">{stat.label}</Text>
              </BlockStack>
            </Card>
          ))}
        </div>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">Applied redirects</Text>
              <Button
                disabled={!appliedRows.length}
                onClick={() => exportRedirectsCsv(appliedRows, `${cleanupLabel}-redirects.csv`)}
              >
                Download CSV
              </Button>
            </InlineStack>
            <IndexTable
              resourceName={{ singular: "redirect", plural: "redirects" }}
              itemCount={appliedRows.length}
              selectable={false}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Redirect" },
                { title: "Rule" },
              ]}
            >
              {appliedRows.slice(0, 5).map((row, index) => (
                <IndexTable.Row id={row.id} key={row.id} position={index}>
                  <IndexTable.Cell>
                    <Thumbnail
                      size="small"
                      source={row.imageUrl || "/favicon.ico"}
                      alt={row.imageAlt || row.name}
                    />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {row.name}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="span">
                        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                          {row.from}
                        </span>
                      </Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodySm" tone="subdued" as="span">
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                        {row.to}
                      </span>
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={row.confidence === "Low" ? "warning" : row.confidence === "Medium" ? "info" : "success"}>
                      {row.via}
                    </Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            {appliedRows.length > 5 ? (
              <Text variant="bodySm" tone="subdued" as="p">
                Showing 5 of {appliedRows.length} redirects.
              </Text>
            ) : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Next steps</Text>
            <BlockStack gap="150">
              <Text variant="bodyMd" as="p">
                • Watch your <strong>404 reports</strong> for the next 30 days.
              </Text>
              <Text variant="bodyMd" as="p">
                • Share <strong>{cleanupLabel}</strong> with your team:{" "}
                <Button variant="plain" removeUnderline onClick={copyShareLink}>
                  {copied ? "copied" : "copy share link"}
                </Button>
              </Text>
            </BlockStack>
            <Divider />
            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={() => navigate(`/app/history?cleanup=${cleanup.id}`)}
              >
                View cleanup history
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ─── Main wizard ─────────────────────────────────────────────
export default function Index() {
  const planInfo = useLoaderData<typeof loader>();
  const [step, setStep] = useState<WizardStep>("onboarding-1");
  const [selectedProducts, setSelectedProducts] = useState<SelectedProductMap>(
    new Map(),
  );
  const [selectedPreset, setSelectedPreset] = useState<CleanupPreset>("none");
  const [rules, setRules] = useState<RedirectRule[]>(() => rulesForPreset("none"));
  const [reviewRows, setReviewRows] = useState<GeneratedPreviewRow[]>([]);
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>("archive");
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const go = (s: WizardStep) => () => setStep(s);

  // Combined setter: changing the preset always syncs the rules to match.
  const setPreset = useCallback(
    (preset: CleanupPreset) => {
      setSelectedPreset(preset);
      setRules(rulesForPreset(preset));
    },
    [],
  );

  const restart = () => {
    setStep("onboarding-1");
    setPreset("none");
    setSelectedProducts(new Map());
    setReviewRows([]);
    setCleanupMode("archive");
    setCleanupResult(null);
  };

  switch (step) {
    case "onboarding-1":
      return <OnboardingExplainer onNext={go("onboarding-2")} />;
    case "onboarding-2":
      return (
        <OnboardingWizard
          onBack={go("onboarding-1")}
          onNext={go("products")}
          selectedPreset={selectedPreset}
          setSelectedPreset={setPreset}
        />
      );
    case "products":
      return (
        <ProductsStep
          onBack={go("onboarding-2")}
          onNext={() => {
            setRules(rulesForPreset(selectedPreset, { selectedProducts }));
            setStep("rules");
          }}
          selectedProducts={selectedProducts}
          setSelectedProducts={setSelectedProducts}
          selectedPreset={selectedPreset}
          setSelectedPreset={setPreset}
        />
      );
    case "rules":
      return (
        <RulesStep
          onBack={go("products")}
          onNext={go("preview")}
          rules={rules}
          setRules={setRules}
          selectedProducts={selectedProducts}
          selectedPreset={selectedPreset}
          setSelectedPreset={setPreset}
        />
      );
    case "preview":
      return (
        <PreviewStep
          onBack={go("rules")}
          onNext={go("apply")}
          selectedProducts={selectedProducts}
          rules={rules}
          rows={reviewRows}
          setRows={setReviewRows}
        />
      );
    case "apply":
      return (
        <ApplyStep
          onBack={go("preview")}
          onComplete={(result) => {
            setCleanupResult(result);
            setStep("success");
          }}
          rows={reviewRows}
          cleanupMode={cleanupMode}
          setCleanupMode={setCleanupMode}
          planInfo={planInfo}
        />
      );
    case "success":
      return (
        <SuccessStep
          onRestart={restart}
          result={cleanupResult}
          rows={reviewRows}
        />
      );
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
