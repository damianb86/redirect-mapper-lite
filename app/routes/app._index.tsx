import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getPlanInfo } from "../plan.server";
import { MAX_PRODUCTS_PER_CLEANUP_RUN } from "../plan";
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
  Checkbox,
  RadioButton,
  Divider,
  ProgressBar,
  Thumbnail,
  Tag,
  Box,
  IndexTable,
  EmptySearchResult,
  Popover,
  ActionList,
  Modal,
  Icon,
  Autocomplete,
  Tooltip,
} from "@shopify/polaris";
import {
  ArchiveIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ChartDonutIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardChecklistIcon,
  DeleteIcon,
  DomainRedirectIcon,
  DuplicateIcon,
  EditIcon,
  ExportIcon,
  InfoIcon,
  MagicIcon,
  PaperCheckIcon,
  ProductIcon,
  QuestionCircleIcon,
  RefreshIcon,
  ResetIcon,
  SearchIcon,
  TargetIcon,
  XIcon,
} from "@shopify/polaris-icons";
import type { loader as productsLoader } from "./app.products";
import type { action as applyAction } from "./app.apply";
import type {
  action as aiWizardAction,
  loader as aiWizardLoader,
} from "./app.ai-wizard";
import type { AiWizardPlan } from "../services/ai-wizard.schemas";
import { DEV } from "../dev";
import { withRequestLogging } from "../request-logging.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "app.index.loader", () =>
    getPlanInfo(request),
  );
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

const WIZARD_NAV_STEPS: { id: WizardStep; label: string }[] = [
  { id: "onboarding-1", label: "Intro" },
  { id: "onboarding-2", label: "Cleanup type" },
  { id: "products", label: "Products" },
  { id: "rules", label: "Rules" },
  { id: "preview", label: "Review" },
  { id: "apply", label: "Summary" },
  { id: "success", label: "Done" },
];

type ProductsLoaderData = Awaited<ReturnType<typeof productsLoader>>;
type AiWizardConfigData = Awaited<ReturnType<typeof aiWizardLoader>>;
type AiWizardActionData =
  | {
      ok: true;
      plan: AiWizardPlan;
      model: string;
      fallbackUsed: boolean;
      toolCalls: unknown[];
      responseId?: string | null;
      usage?: unknown;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type AiClarifyingSelections = Record<string, string[]>;
type AiSelectedProductIds = Set<string>;
type ProductTargetingPrefill = {
  key: string;
  q: string;
  vendors: string[];
  collectionIds: string[];
  collectionTitles: string[];
  collectionTitlePatterns: string[];
  types: string[];
  tags: string[];
  taxonomyJoin: TaxonomyJoin;
  vendorJoin: TaxonomyValueJoin;
  collectionJoin: TaxonomyValueJoin;
  typeJoin: TaxonomyValueJoin;
  tagJoin: TaxonomyValueJoin;
  inventory: string;
  inventoryValue: string;
  updated: string;
  tab: string;
};

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
type AiWizardProductDisplayRow = {
  id: string;
  name: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  inventory: number | null;
  collections: string[];
  tags: string[];
};
type CleanupPreset = "seasonal" | "vendor" | "oos" | "spring" | "none";
type ConfigurablePreset = Exclude<CleanupPreset, "none">;

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

type CatalogLookupKind = "collection" | "vendor" | "productType" | "tag";
type CatalogOption = { label: string; value: string };
type TaxonomyJoin = "and" | "or";
type TaxonomyValueJoin = "any" | "all";

const TAXONOMY_GROUP_JOIN_OPTIONS: { label: string; value: TaxonomyJoin }[] = [
  { label: "Match all groups", value: "and" },
  { label: "Match any group", value: "or" },
];

const TAXONOMY_VALUE_JOIN_OPTIONS: {
  label: string;
  value: TaxonomyValueJoin;
}[] = [
  { label: "Any selected", value: "any" },
  { label: "All selected", value: "all" },
];

function taxonomyValueJoinLabel(value: TaxonomyValueJoin) {
  return value === "all" ? "all selected" : "any selected";
}

function taxonomyGroupJoinLabel(value: TaxonomyJoin) {
  return value === "or" ? "any taxonomy group" : "all taxonomy groups";
}

function normalizeTaxonomyJoinValue(value: unknown): TaxonomyJoin {
  return value === "or" ? "or" : "and";
}

function normalizeTaxonomyValueJoinValue(value: unknown): TaxonomyValueJoin {
  return value === "all" ? "all" : "any";
}

function taxonomyFilterSummary(
  values: string[],
  fallback: string,
  join: TaxonomyValueJoin,
) {
  const summary = selectedValueSummary(values, fallback);
  if (values.length <= 1) return summary;
  return `${summary} · ${taxonomyValueJoinLabel(join)}`;
}

function truncateProductTitle(title: string, maxLength = 50) {
  return title.length > maxLength
    ? `${title.slice(0, Math.max(0, maxLength - 3))}...`
    : title;
}

type PresetDetails = {
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

type PresetDetailPatch = Partial<PresetDetails[ConfigurablePreset]>;

const DEFAULT_PRESET_DETAILS: PresetDetails = {
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

const INVENTORY_OPTIONS = [
  { label: "Any inventory", value: "" },
  { label: "In stock", value: "available" },
  { label: "Out of stock", value: "out" },
  { label: "Low stock (1-4)", value: "low" },
  { label: "Healthy stock (5+)", value: "healthy" },
  { label: "Overstock (100+)", value: "overstock" },
];

const INVENTORY_FILTER_OPTIONS = [
  { label: "In stock", value: "available" },
  { label: "Low stock (1-4)", value: "low" },
  { label: "Healthy stock (5+)", value: "healthy" },
  { label: "High stock (100+)", value: "overstock" },
  { label: "Below custom threshold", value: "below" },
  { label: "Above custom threshold", value: "above" },
];

const UPDATED_OPTIONS = [
  { label: "Any update age", value: "" },
  { label: "Not updated in 90 days", value: "90d" },
  { label: "Not updated in 180 days", value: "180d" },
  { label: "Not updated in 1 year", value: "365d" },
];

const PRODUCT_STATUS_SCOPES = [
  {
    id: "all",
    label: "All",
    detail: "Full catalog",
    accent: "#0f7c8f",
  },
  {
    id: "active",
    label: "Active",
    detail: "Live storefront items",
    accent: "#0f6f5c",
  },
  {
    id: "draft",
    label: "Draft",
    detail: "Not published yet",
    accent: "#8a6a12",
  },
  {
    id: "archived",
    label: "Archived",
    detail: "Already removed from sale",
    accent: "#68746f",
  },
  {
    id: "oos",
    label: "Out of stock",
    detail: "Zero inventory",
    accent: "#bd3f3a",
  },
  {
    id: "custom_stock",
    label: "Custom stock",
    detail: "Low, high, or threshold",
    accent: "#c38727",
  },
];

const PRODUCT_PAGE_SIZE_OPTIONS = [20, 40, 60, 100, 150, 250] as const;
const PRODUCT_PAGE_SIZE_SELECT_OPTIONS = PRODUCT_PAGE_SIZE_OPTIONS.map(
  (value) => ({
    label: `${value} per page`,
    value: String(value),
  }),
);

const SCENARIOS: Scenario[] = [
  {
    id: "seasonal",
    icon: "🍂",
    title: "Seasonal cleanup",
    description:
      "Retire a season, sale drop, or campaign group. Start with seasonal tags/collections plus out-of-stock items, then send shoppers to the closest remaining collection.",
    accent: "#d0810f",
    accentSoft: "#fff6dc",
    accentBorder: "#edc36a",
    accentText: "#7a4a00",
  },
  {
    id: "vendor",
    icon: "🏷️",
    title: "Vendor exit",
    description:
      "Stop selling a brand or supplier. Start from one real vendor, then redirect to that vendor collection or to similar products by type.",
    accent: "#0f7c8f",
    accentSoft: "#e5f7fa",
    accentBorder: "#94d4de",
    accentText: "#064f5e",
  },
  {
    id: "oos",
    icon: "📦",
    title: "Out of stock forever",
    description:
      "Clean up products that are not coming back. Start with zero inventory and redirect toward alternatives, type collections, or product-title search results.",
    accent: "#bd3f3a",
    accentSoft: "#fff0f0",
    accentBorder: "#eeaaa5",
    accentText: "#7d2622",
  },
  {
    id: "spring",
    icon: "🧹",
    title: "Spring cleaning",
    description:
      "Find stale, low-stock, clearance, or draft catalog items. Use this when cleanup work is mixed and needs a few broad rules.",
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

function scenarioStyle(
  scenario: Pick<
    Scenario,
    "accent" | "accentSoft" | "accentBorder" | "accentText"
  >,
): ScenarioStyle {
  return {
    "--rml-card-accent": scenario.accent,
    "--rml-card-soft": scenario.accentSoft,
    "--rml-card-border": scenario.accentBorder,
    "--rml-card-text": scenario.accentText,
  };
}

function isConfigurablePreset(
  preset: CleanupPreset,
): preset is ConfigurablePreset {
  return preset !== "none";
}

function mergePresetDetails(
  current: PresetDetails,
  preset: ConfigurablePreset,
  patch: PresetDetailPatch,
): PresetDetails {
  return {
    ...current,
    [preset]: {
      ...current[preset],
      ...patch,
    },
  };
}

function optionLabel(
  options: { label: string; value: string }[],
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? "";
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

function inventoryFilterLabel(inventory: string, inventoryValue: string) {
  const threshold = inventoryValue.trim();
  if (inventory === "below") {
    return threshold ? `Below ${threshold} units` : "Below custom threshold";
  }
  if (inventory === "above") {
    return threshold ? `Above ${threshold} units` : "Above custom threshold";
  }
  return (
    optionLabel(INVENTORY_FILTER_OPTIONS, inventory) ||
    optionLabel(INVENTORY_OPTIONS, inventory)
  );
}

function compactValues(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");
}

function splitRuleInputValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactValueList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function selectedValueSummary(values: string[], fallback: string) {
  const compact = compactValueList(values);
  if (!compact.length) return fallback;
  if (compact.length === 1) return compact[0];
  return `${compact[0]} +${compact.length - 1}`;
}

function splitPresetTextValues(value: string) {
  return uniqueSortedValues(splitRuleInputValues(value));
}

function valuesOrFallback(values: string[], fallback: string) {
  const compact = compactValueList(values);
  return compact.length ? compact : splitPresetTextValues(fallback);
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
  stopOnMatch: boolean;
};

type RuleRedirectExample = {
  productName: string;
  source: string;
  target: string;
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
  { label: "Product's collection", value: "sameCollection" },
  { label: "Product type collection", value: "productTypeCollection" },
  { label: "Vendor collection", value: "vendorCollection" },
  { label: "Tag collection", value: "tagCollection" },
  { label: "Search results", value: "searchResults" },
  { label: "Custom storefront path", value: "customPath" },
  { label: "All products", value: "allProducts" },
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
    valueHelpText:
      "Use exact vendor names or partial names depending on the condition.",
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
    helpText:
      "Route permanently unavailable items away from dead product URLs.",
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
    helpText:
      "Useful for low-value clearance items or high-value alternatives.",
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
    helpText:
      "Legacy smart destination. New rules use clearer destination types.",
    optionLabel: "Legacy strategy",
    optionHelpText:
      "Kept only so older in-memory rules can still normalize safely.",
    options: [
      {
        label: "Product's collection, then product type",
        value: "collectionTypeVendor",
      },
      { label: "Product type collection", value: "typeCollection" },
      { label: "Search by product type", value: "vendorType" },
      { label: "Product's collection", value: "inventoryCollection" },
      { label: "Product's collection", value: "newestCollection" },
      { label: "Product's collection", value: "closestPrice" },
    ],
  },
  sameCollection: {
    helpText:
      "Sends shoppers to a collection already attached to the retired product.",
    optionLabel: "Collection source",
    optionHelpText:
      "Choose which product collection should become the redirect destination.",
    options: [
      { label: "Product's first collection", value: "firstCollection" },
      { label: "Product's last collection", value: "lastCollection" },
      { label: "Collection matched by this rule", value: "matchedCollection" },
    ],
  },
  productTypeCollection: {
    helpText:
      "Builds a collection URL from the retired product's Shopify product type.",
    optionLabel: "URL pattern",
    optionHelpText:
      "Use the standard product type collection or write a pattern with variables.",
    options: [
      { label: "/collections/[product-type]", value: "typeHandle" },
      { label: "Custom product type pattern", value: "customPattern" },
    ],
    valueLabel: "Product type pattern",
    valuePlaceholder: "/collections/{productType}",
    valueHelpText:
      "Use variables such as {productType}, {vendor}, or {productHandle}.",
  },
  vendorCollection: {
    helpText: "Builds a collection URL from the retired product's vendor.",
    optionLabel: "URL pattern",
    optionHelpText:
      "Use the standard vendor collection or write a pattern with variables.",
    options: [
      { label: "/collections/[vendor]", value: "vendorHandle" },
      { label: "Custom vendor pattern", value: "customPattern" },
    ],
    valueLabel: "Vendor pattern",
    valuePlaceholder: "/collections/{vendor}",
    valueHelpText:
      "Use variables such as {vendor}, {productType}, or {productHandle}.",
  },
  tagCollection: {
    helpText:
      "Builds a collection URL from a tag on the rule or selected product.",
    optionLabel: "URL pattern",
    optionHelpText: "Choose which tag should map to the collection handle.",
    options: [
      { label: "/collections/[first rule tag]", value: "tagHandle" },
      {
        label: "/collections/[matched product tag]",
        value: "matchedTagHandle",
      },
      { label: "/collections/[first product tag]", value: "firstProductTag" },
      { label: "Custom tag pattern", value: "customPattern" },
    ],
    valueLabel: "Tag pattern",
    valuePlaceholder: "/collections/{matchedTag}",
    valueHelpText:
      "Use variables such as {matchedTag}, {firstTag}, or {productHandle}.",
  },
  searchResults: {
    helpText:
      "Sends shoppers to storefront search when a collection URL would be too speculative.",
    optionLabel: "Search query",
    optionHelpText:
      "Choose the product attribute used as the search term, or enter a manual term.",
    options: [
      { label: "Product type", value: "productType" },
      { label: "Vendor", value: "vendor" },
      { label: "Product's first collection", value: "collection" },
      { label: "Product title keywords", value: "productTitle" },
      { label: "Product SKU", value: "sku" },
      { label: "Product's first tag", value: "tag" },
      { label: "Custom search term", value: "custom" },
    ],
    valueLabel: "Custom search term",
    valuePlaceholder: "linen shirt or {productType} {vendor}",
    valueHelpText:
      "Only required when using a custom search term. Variables can be used here.",
  },
  allProducts: {
    helpText:
      "Broad fallback for products that should keep shoppers inside the catalog.",
    optionLabel: "Destination",
    optionHelpText:
      "Choose the broad catalog destination used as the final fallback.",
    options: [
      { label: "/collections/all", value: "collectionsAll" },
      { label: "Storefront search page", value: "searchAll" },
      { label: "Custom catalog path", value: "customCatalogPath" },
    ],
    valueLabel: "Catalog path",
    valuePlaceholder: "/collections/all",
    valueHelpText:
      "Use a storefront path or variable pattern for a broader catalog destination.",
  },
  customPath: {
    helpText:
      "Use this for curated landing pages, buying guides, external URLs, or variable paths.",
    optionLabel: "Path type",
    optionHelpText:
      "Choose whether this destination is a fixed path, a variable path, or an external URL.",
    options: [
      { label: "Manual storefront path", value: "manualPath" },
      { label: "Variable storefront path", value: "variablePath" },
      { label: "External URL", value: "externalUrl" },
    ],
    valueLabel: "Destination",
    valuePlaceholder: "/collections/sale or https://example.com",
    valueHelpText:
      "Examples: /collections/sale, /pages/{productType}, or https://example.com/{productHandle}",
    needsValue: true,
  },
  homepage: {
    helpText:
      "Use only when there is no meaningful product or collection destination.",
    optionLabel: "Homepage path",
    optionHelpText:
      "This is intentionally broad; prefer it only for final fallback rules.",
    options: [{ label: "/", value: "root" }],
  },
  noRedirect: {
    helpText: "Excludes matching products from redirect creation.",
    optionLabel: "Skip behavior",
    optionHelpText:
      "No redirect record is created for products that match this rule.",
  },
};

const TARGET_VARIABLES = [
  { token: "{productHandle}", description: "product handle" },
  { token: "{productTitle}", description: "product title as a handle" },
  { token: "{productType}", description: "product type as a handle" },
  { token: "{vendor}", description: "vendor as a handle" },
  { token: "{firstCollection}", description: "first product collection" },
  { token: "{lastCollection}", description: "last product collection" },
  {
    token: "{matchedCollection}",
    description: "collection matched by the rule",
  },
  { token: "{firstTag}", description: "first product tag" },
  { token: "{matchedTag}", description: "tag matched by the rule" },
  { token: "{sku}", description: "product SKU" },
] as const;

const TARGET_VARIABLE_HELP = TARGET_VARIABLES.map(
  (variable) => `${variable.token}: ${variable.description}`,
).join("; ");

function targetNeedsValue(target: RuleTarget, targetOption: string) {
  if (TARGET_CONFIG[target].needsValue) return true;
  if (target === "searchResults" && targetOption === "custom") return true;
  if (
    ["productTypeCollection", "vendorCollection", "tagCollection"].includes(
      target,
    ) &&
    targetOption === "customPattern"
  ) {
    return true;
  }
  return target === "allProducts" && targetOption === "customCatalogPath";
}

function targetValueFitsOption(
  target: RuleTarget,
  targetOption: string,
  value: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (target === "searchResults") return true;
  if (target === "customPath" && targetOption === "externalUrl") {
    return isExternalRedirectDestination(trimmed);
  }
  return trimmed.startsWith("/");
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

function targetSupportsVariables(
  rule: Pick<RedirectRule, "target" | "targetOption">,
) {
  if (rule.target === "customPath" && rule.targetOption === "manualPath")
    return false;
  return targetNeedsValue(rule.target, rule.targetOption);
}

function targetValueLabel(rule: Pick<RedirectRule, "target" | "targetOption">) {
  if (
    rule.target === "productTypeCollection" &&
    rule.targetOption === "customPattern"
  ) {
    return "Product type pattern";
  }
  if (
    rule.target === "vendorCollection" &&
    rule.targetOption === "customPattern"
  ) {
    return "Vendor pattern";
  }
  if (
    rule.target === "tagCollection" &&
    rule.targetOption === "customPattern"
  ) {
    return "Tag pattern";
  }
  if (
    rule.target === "allProducts" &&
    rule.targetOption === "customCatalogPath"
  ) {
    return "Catalog path";
  }
  return TARGET_CONFIG[rule.target].valueLabel ?? "Destination";
}

function targetValuePlaceholder(
  rule: Pick<RedirectRule, "target" | "targetOption">,
) {
  if (rule.target === "customPath" && rule.targetOption === "externalUrl") {
    return "https://example.com/{productHandle}";
  }
  if (rule.target === "customPath" && rule.targetOption === "variablePath") {
    return "/pages/{productType}";
  }
  if (rule.target === "customPath" && rule.targetOption === "manualPath") {
    return "/collections/sale";
  }
  const defaultValue = defaultTargetValueForOption(
    rule.target,
    rule.targetOption,
  );
  return defaultValue || TARGET_CONFIG[rule.target].valuePlaceholder;
}

function targetValueHelpText(
  rule: Pick<RedirectRule, "target" | "targetOption">,
) {
  if (rule.target === "customPath" && rule.targetOption === "externalUrl") {
    return "Use a full external URL. Variables can be used in the path or query string.";
  }
  if (rule.target === "customPath" && rule.targetOption === "variablePath") {
    return "Use a storefront path pattern. Variables are replaced for each selected product.";
  }
  if (rule.target === "customPath" && rule.targetOption === "manualPath") {
    return "Use a fixed storefront path such as /collections/sale or /pages/size-guide.";
  }
  if (
    rule.target === "allProducts" &&
    rule.targetOption === "customCatalogPath"
  ) {
    return "Use a broad catalog path. Variables are allowed, but this should still be a safe fallback.";
  }
  if (
    ["productTypeCollection", "vendorCollection", "tagCollection"].includes(
      rule.target,
    ) &&
    rule.targetOption === "customPattern"
  ) {
    return "Use a storefront path pattern. Variables are replaced with values from each selected product.";
  }
  return TARGET_CONFIG[rule.target].valueHelpText;
}

function RedirectVariableHelp({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <InlineStack gap="100" blockAlign="center" wrap={false}>
      <Tooltip content={TARGET_VARIABLE_HELP}>
        <span className="rml-rule-variable-help__icon">
          <Icon source={QuestionCircleIcon} />
        </span>
      </Tooltip>
      <Text variant="bodySm" tone="subdued" as="span">
        Variables available
      </Text>
    </InlineStack>
  );
}

const DEFAULT_RULES: RedirectRule[] = [
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

// ─── Preset helpers ───────────────────────────────────────────
// Tabs order in ProductsStep: all=0, active=1, draft=2, archived=3, oos=4
const PRESET_FILTER_INIT: Record<
  CleanupPreset,
  { inventory: string; updated: string; tabIndex: number }
> = {
  seasonal: { inventory: "out", updated: "", tabIndex: 4 },
  vendor: { inventory: "", updated: "", tabIndex: 0 },
  oos: { inventory: "out", updated: "180d", tabIndex: 4 },
  spring: { inventory: "low", updated: "180d", tabIndex: 5 },
  none: { inventory: "", updated: "", tabIndex: 0 },
};

function statusScopeIndex(scopeId: string) {
  const index = PRODUCT_STATUS_SCOPES.findIndex(
    (scope) => scope.id === scopeId,
  );
  return index >= 0 ? index : 0;
}

function productScopeForInventory(inventory: string) {
  if (inventory === "out") return "oos";
  if (inventory) return "custom_stock";
  return "all";
}

function productFilterInventoryValue(inventory: string) {
  return inventory === "out" ? "" : inventory;
}

function initialProductTargeting(
  preset: CleanupPreset,
  details: PresetDetails,
) {
  if (preset === "seasonal") {
    const inventory = details.seasonal.inventory;
    return {
      inventory: productFilterInventoryValue(inventory),
      updated: "",
      tabIndex: statusScopeIndex(productScopeForInventory(inventory)),
    };
  }

  if (preset === "spring") {
    const inventory = details.spring.inventory;
    return {
      inventory: productFilterInventoryValue(inventory),
      updated: details.spring.updated,
      tabIndex: statusScopeIndex(productScopeForInventory(inventory)),
    };
  }

  if (preset === "oos") {
    return {
      inventory: "",
      updated: details.oos.updated,
      tabIndex: statusScopeIndex("oos"),
    };
  }

  return PRESET_FILTER_INIT[preset];
}

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

function ruleTemplate(
  patch: Partial<RedirectRule> &
    Pick<
      RedirectRule,
      "id" | "field" | "condition" | "target" | "targetOption"
    >,
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

function rulesForPreset(
  preset: CleanupPreset,
  context: {
    selectedProducts?: SelectedProductMap;
    presetDetails?: PresetDetails;
  } = {},
): RedirectRule[] {
  const products = productListFromSelection(context.selectedProducts);
  const presetDetails = context.presetDetails ?? DEFAULT_PRESET_DETAILS;
  const vendorExample =
    exampleVendorFromProducts(products) || "Vendor to retire";
  const typeExample =
    exampleTypeFromProducts(products) || "Product type to retire";
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
  const vendorRuleValues = valuesOrFallback(
    vendorDetails.vendors,
    vendorExample,
  );
  const vendorTypeValues = valuesOrFallback(
    vendorDetails.productTypes,
    typeExample,
  );
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
  const springTypeValues = valuesOrFallback(
    springDetails.productTypes,
    typeExample,
  );
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

  const springRules = [
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

  return springRules;
}

const PREVIEW_ROWS = [
  {
    id: "1",
    name: "Linen Camp Shirt — Sage",
    from: "/products/lin-cmp-sg",
    to: "/collections/linen-tops",
    via: "Collection",
    confidence: "High",
    tone: "success" as const,
  },
  {
    id: "2",
    name: "Linen Camp Shirt — Rust",
    from: "/products/lin-cmp-rs",
    to: "/collections/linen-tops",
    via: "Collection",
    confidence: "High",
    tone: "success" as const,
  },
  {
    id: "4",
    name: "Cashmere Beanie — Charcoal",
    from: "/products/csh-bn-ch",
    to: "/collections/winter-acc",
    via: "Collection",
    confidence: "Medium",
    tone: "info" as const,
  },
  {
    id: "6",
    name: "Garden Tote — Olive",
    from: "/products/gd-tt-ol",
    to: "/collections/bags",
    via: "Collection",
    confidence: "High",
    tone: "success" as const,
  },
  {
    id: "7",
    name: "Garden Tote — Stone",
    from: "/products/gd-tt-st",
    to: "/collections/bags",
    via: "Collection",
    confidence: "High",
    tone: "success" as const,
  },
  {
    id: "m1",
    name: "Wool Mittens — Navy",
    from: "/products/wl-mt-nv",
    to: "/collections/highline",
    via: "Vendor",
    confidence: "Low",
    tone: "warning" as const,
  },
  {
    id: "c1",
    name: "Field Cap — Khaki",
    from: "/products/fld-cp-kh",
    to: "/collections/all",
    via: "Fallback",
    confidence: "Low",
    tone: "warning" as const,
  },
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

type BrokenTargetFixChoice = "allProducts" | "homepage" | "custom";

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
  status?: ProductRow["status"];
  via: string;
  confidence: "High" | "Medium" | "Low";
  tone: "success" | "info" | "warning";
  originalTo: string;
  targetChoice: PreviewTargetChoice;
  customTarget: string;
  edited: boolean;
};

type TargetValidationResult = {
  target: string;
  status: "valid" | "invalid" | "unchecked" | "skipped";
  resourceType: string;
  reason: string;
};

type SourceValidationResult = {
  source: string;
  status: "available" | "conflict" | "invalid" | "unchecked";
  reason: string;
  existingTarget?: string;
  redirectId?: string;
};

type TargetValidationResponse = {
  results?: TargetValidationResult[];
  sources?: SourceValidationResult[];
};

function skippedPreviewTargetValidation(
  target: string,
): TargetValidationResult | null {
  try {
    const url = new URL(target.trim(), "https://storefront.local");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (
      pathname === "/" ||
      pathname === "/collections/all" ||
      pathname === "/search" ||
      pathname.startsWith("/search/")
    ) {
      return {
        target,
        status: "skipped",
        resourceType: "system",
        reason:
          "System destinations such as homepage, search, and all products are skipped.",
      };
    }
  } catch {
    return null;
  }

  return null;
}

type RedirectReviewStatus =
  | "ready"
  | "lowConfidence"
  | "needsReview"
  | "edited"
  | "skipped"
  | "invalid"
  | "conflict";

type RedirectReviewState = {
  status: RedirectReviewStatus;
  label: string;
  tone?: "success" | "info" | "warning" | "critical";
  explanation: string;
};

function normalizePreviewPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, "https://storefront.local");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return trimmed;
  }
}

function isWeakFallbackDestination(target: string) {
  const normalized = normalizePreviewPath(target);
  return (
    normalized === "/" ||
    normalized === "/collections/all" ||
    normalized === "/search" ||
    normalized.startsWith("/search?")
  );
}

function redirectExplanation(row: GeneratedPreviewRow) {
  if (row.targetChoice === "skip") return "skipped";
  if (row.targetChoice === "custom") return "custom path";
  if (normalizePreviewPath(row.to) === "/") return "homepage fallback";
  if (normalizePreviewPath(row.to) === "/collections/all")
    return "product type fallback";
  if (normalizePreviewPath(row.to).startsWith("/search"))
    return "search results fallback";
  if (row.via === "Collection") return "matching collection";
  if (row.via === "Vendor") return "same vendor";
  if (row.via === "Product type") return "product type fallback";
  if (row.via === "Fallback") return "fallback destination";
  return `${row.via.toLowerCase()} match`;
}

function reviewStateForRow({
  row,
  duplicateSourceCount,
  sourceValidation,
  targetValidation,
  retiredProductPaths,
}: {
  row: GeneratedPreviewRow;
  duplicateSourceCount: number;
  sourceValidation?: SourceValidationResult;
  targetValidation?: TargetValidationResult;
  retiredProductPaths: Set<string>;
}): RedirectReviewState {
  if (row.targetChoice === "skip") {
    return {
      status: "skipped",
      label: "Skipped",
      explanation: "No redirect will be created.",
    };
  }

  const sourcePath = normalizePreviewPath(row.from);
  const targetPath = normalizePreviewPath(row.to);
  const reason =
    targetValidation?.reason || "Fix the destination before applying.";

  if (!isPreviewDestinationValid(row)) {
    return {
      status: "invalid",
      label: "Invalid",
      tone: "critical",
      explanation: "Invalid URL pattern.",
    };
  }

  if (sourcePath && targetPath && sourcePath === targetPath) {
    return {
      status: "invalid",
      label: "Invalid",
      tone: "critical",
      explanation: "Circular redirect.",
    };
  }

  if (targetValidation?.status === "invalid") {
    return {
      status: "invalid",
      label: "Invalid",
      tone: "critical",
      explanation: reason,
    };
  }

  if (targetPath && retiredProductPaths.has(targetPath)) {
    return {
      status: "invalid",
      label: "Invalid",
      tone: "critical",
      explanation: "Redirects to a product also being retired.",
    };
  }

  if (duplicateSourceCount > 1) {
    return {
      status: "conflict",
      label: "Conflict",
      tone: "critical",
      explanation: "Duplicate source URL in this cleanup.",
    };
  }

  if (sourceValidation?.status === "conflict") {
    return {
      status: "conflict",
      label: "Conflict",
      tone: "critical",
      explanation: sourceValidation.existingTarget
        ? `Shopify already redirects this URL to ${sourceValidation.existingTarget}.`
        : sourceValidation.reason,
    };
  }

  if (row.edited) {
    return {
      status: "edited",
      label: "Edited",
      tone: "info",
      explanation: redirectExplanation(row),
    };
  }

  if (row.confidence === "Low") {
    return {
      status: "lowConfidence",
      label: "Low confidence",
      tone: "warning",
      explanation: redirectExplanation(row),
    };
  }

  if (isWeakFallbackDestination(row.to)) {
    return {
      status: "needsReview",
      label: "Needs review",
      tone: "warning",
      explanation: redirectExplanation(row),
    };
  }

  if (
    targetValidation?.status === "unchecked" ||
    sourceValidation?.status === "unchecked"
  ) {
    return {
      status: "needsReview",
      label: "Needs review",
      tone: "warning",
      explanation:
        targetValidation?.reason ||
        sourceValidation?.reason ||
        redirectExplanation(row),
    };
  }

  return {
    status: "ready",
    label: "Ready",
    tone: "success",
    explanation: redirectExplanation(row),
  };
}

const REVIEW_CONFIDENCE_ORDER: GeneratedPreviewRow["confidence"][] = [
  "High",
  "Medium",
  "Low",
];

type CleanupMode = "redirects" | "archive" | "delete";

type CleanupIssue = {
  id: string;
  severity: "critical" | "warning" | "info";
  area: string;
  productName?: string;
  productId?: string;
  from?: string;
  to?: string;
  message: string;
};

type CleanupResult = {
  id: string;
  completedAt: Date;
  mode: CleanupMode;
  redirectsCreated: number;
  redirectsFailed: number;
  productsRetired: number;
  productsFailed: number;
  skipped: number;
  conflicts: number;
  issues: CleanupIssue[];
};

const PREVIEW_TARGET_OPTIONS: { label: string; value: PreviewTargetChoice }[] =
  [
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

function WizardProgressNav({
  currentStep,
  onBack,
  onNext,
  backDisabled,
  nextDisabled,
  nextLoading,
  backLabel = "Back",
  nextLabel = "Next",
}: {
  currentStep: WizardStep;
  onBack?: () => void;
  onNext?: () => void;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  backLabel?: string;
  nextLabel?: string;
}) {
  const currentIndex = WIZARD_NAV_STEPS.findIndex(
    (step) => step.id === currentStep,
  );

  return (
    <div
      className="rml-wizard-nav"
      role="navigation"
      aria-label="Cleanup wizard"
    >
      <div className="rml-wizard-nav__action rml-wizard-nav__action--back">
        <Button
          icon={ArrowLeftIcon}
          disabled={!onBack || backDisabled}
          onClick={onBack ?? (() => {})}
          accessibilityLabel={backLabel}
        >
          {backLabel}
        </Button>
      </div>

      <ol className="rml-wizard-nav__steps" aria-label="Wizard progress">
        {WIZARD_NAV_STEPS.map((step, index) => {
          const state =
            index < currentIndex
              ? "done"
              : index === currentIndex
                ? "current"
                : "upcoming";

          return (
            <li
              key={step.id}
              className={`rml-wizard-nav__step rml-wizard-nav__step--${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="rml-wizard-nav__dot">
                {state === "done" ? "✓" : index + 1}
              </span>
              <span className="rml-wizard-nav__label">{step.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="rml-wizard-nav__action rml-wizard-nav__action--next">
        <Button
          icon={ArrowRightIcon}
          variant="primary"
          disabled={!onNext || nextDisabled}
          loading={nextLoading}
          onClick={onNext ?? (() => {})}
          accessibilityLabel={nextLabel}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

function CatalogValuePicker({
  label,
  kind,
  value,
  displayValue,
  textPlaceholder,
  labelHidden,
  freeform = true,
  allowMultiple = false,
  onChange,
}: {
  label: string;
  kind: CatalogLookupKind;
  value: string | string[];
  displayValue?: string | string[];
  textPlaceholder: string;
  labelHidden?: boolean;
  freeform?: boolean;
  allowMultiple?: boolean;
  onChange(value: string | string[], label: string | string[]): void;
}) {
  const lookupFetcher = useFetcher<typeof productsLoader>();
  const lookupLoadRef = useRef(lookupFetcher.load);
  const lastLookupPathRef = useRef("");
  const valueList = useMemo(
    () =>
      Array.isArray(value)
        ? compactValueList(value)
        : compactValueList([value]),
    [value],
  );
  const displayList = useMemo(() => {
    const rawDisplay = Array.isArray(displayValue)
      ? displayValue
      : displayValue
        ? [displayValue]
        : [];
    const compactDisplay = compactValueList(rawDisplay);
    return valueList.map((item, index) => compactDisplay[index] || item);
  }, [displayValue, valueList]);
  const singleVisibleValue = displayList[0] ?? valueList[0] ?? "";
  const [inputValue, setInputValue] = useState(
    allowMultiple ? "" : singleVisibleValue,
  );
  const query = inputValue.trim();
  const lookupData = (lookupFetcher.data as ProductsLoaderData | undefined)
    ?.lookup;
  const options = useMemo(() => {
    const lookupOptions =
      lookupData?.kind === kind && lookupData.query === query
        ? (lookupData.options as CatalogOption[])
        : [];
    const selectedOptions = valueList.map((item, index) => ({
      label: displayList[index] || item,
      value: item,
    }));
    const merged = new Map<string, CatalogOption>();
    [...selectedOptions, ...lookupOptions].forEach((option) => {
      if (!merged.has(option.value)) merged.set(option.value, option);
    });
    return [...merged.values()];
  }, [displayList, kind, lookupData, query, valueList]);
  const selectedOptions = valueList;
  const loading = lookupFetcher.state !== "idle";
  const canUseTypedValue =
    allowMultiple &&
    freeform &&
    Boolean(query) &&
    !valueList.some((item) => item.toLowerCase() === query.toLowerCase());

  useEffect(() => {
    lookupLoadRef.current = lookupFetcher.load;
  }, [lookupFetcher.load]);

  useEffect(() => {
    if (!allowMultiple) setInputValue(singleVisibleValue);
  }, [allowMultiple, singleVisibleValue]);

  useEffect(() => {
    if (query.length < 2) {
      lastLookupPathRef.current = "";
      return;
    }

    const params = new URLSearchParams({
      lookup: kind,
      q: query,
    });
    const lookupPath = `/app/products?${params.toString()}`;
    if (lookupPath === lastLookupPathRef.current) return;

    const timeout = window.setTimeout(() => {
      lastLookupPathRef.current = lookupPath;
      lookupLoadRef.current(lookupPath);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [kind, query]);

  const handleInputChange = (nextValue: string) => {
    setInputValue(nextValue);
    if (freeform && !allowMultiple) {
      onChange(nextValue, nextValue);
    } else if (!allowMultiple && !nextValue.trim()) {
      onChange("", "");
    }
  };

  const handleSelection = (selected: string[]) => {
    if (allowMultiple) {
      const nextValues = selected;
      const nextLabels = nextValues.map(
        (selectedValue) =>
          options.find((item) => item.value === selectedValue)?.label ??
          selectedValue,
      );
      setInputValue("");
      onChange(nextValues, nextLabels);
      return;
    }

    const selectedValue = selected[0] ?? "";
    const option = options.find((item) => item.value === selectedValue);
    const nextLabel = option?.label ?? "";
    setInputValue(nextLabel);
    onChange(selectedValue, nextLabel);
  };

  const addTypedValue = () => {
    if (!canUseTypedValue) return;
    const nextValues = uniqueSortedValues([...valueList, query]);
    setInputValue("");
    onChange(nextValues, nextValues);
  };

  const clearValue = () => {
    setInputValue("");
    if (!allowMultiple) onChange("", "");
  };

  const emptyState = (
    <Box padding="300">
      <Text variant="bodySm" tone="subdued" as="p">
        {query.length < 2
          ? "Type at least 2 characters to search."
          : freeform
            ? "No suggestions found. You can keep this typed value."
            : "No matching value found."}
      </Text>
    </Box>
  );

  const textField = (
    <Autocomplete.TextField
      label={label}
      labelHidden={labelHidden}
      value={inputValue}
      onChange={handleInputChange}
      placeholder={textPlaceholder}
      prefix={<Icon source={SearchIcon} tone="base" />}
      clearButton
      onClearButtonClick={clearValue}
      autoComplete="off"
    />
  );

  return (
    <BlockStack gap="150">
      <Autocomplete
        options={options}
        selected={selectedOptions}
        textField={textField}
        loading={loading}
        emptyState={emptyState}
        allowMultiple={allowMultiple}
        actionBefore={
          canUseTypedValue
            ? {
                content: `Use "${query}"`,
                onAction: addTypedValue,
              }
            : undefined
        }
        onSelect={handleSelection}
      />
      {allowMultiple && valueList.length ? (
        <InlineStack gap="100" wrap>
          {valueList.map((item, index) => (
            <Tag
              key={item}
              onRemove={() => {
                const nextValues = valueList.filter(
                  (valueItem) => valueItem !== item,
                );
                const nextLabels = displayList.filter(
                  (_, labelIndex) => labelIndex !== index,
                );
                onChange(nextValues, nextLabels);
              }}
            >
              {displayList[index] || item}
            </Tag>
          ))}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}

function PresetValuePicker({
  label,
  kind,
  value,
  displayValue,
  textPlaceholder,
  freeform,
  allowMultiple,
  onChange,
}: {
  label: string;
  kind: CatalogLookupKind;
  value: string | string[];
  displayValue?: string | string[];
  textPlaceholder: string;
  freeform?: boolean;
  allowMultiple?: boolean;
  onChange(value: string | string[], label: string | string[]): void;
}) {
  return (
    <CatalogValuePicker
      label={label}
      kind={kind}
      value={value}
      displayValue={displayValue}
      textPlaceholder={textPlaceholder}
      freeform={freeform}
      allowMultiple={allowMultiple}
      onChange={onChange}
    />
  );
}

function PresetConfigPanel({
  preset,
  presetDetails,
  onChange,
}: {
  preset: CleanupPreset;
  presetDetails: PresetDetails;
  onChange(preset: ConfigurablePreset, patch: PresetDetailPatch): void;
}) {
  if (!isConfigurablePreset(preset)) return null;

  const scenario = SCENARIOS.find((item) => item.id === preset);

  return (
    <div
      className="rml-preset-config"
      style={scenario ? scenarioStyle(scenario) : undefined}
    >
      <InlineStack gap="200" blockAlign="center">
        <div className="rml-preset-config__icon" aria-hidden="true">
          {scenario?.icon}
        </div>
        <BlockStack gap="050">
          <Text variant="headingSm" as="h3">
            {scenario?.title}
          </Text>
          <Text variant="bodySm" tone="subdued" as="p">
            Preset details
          </Text>
        </BlockStack>
      </InlineStack>

      {preset === "seasonal" ? (
        <div className="rml-preset-config__grid">
          <TextField
            label="Season keywords"
            value={presetDetails.seasonal.keywords}
            onChange={(value) => onChange("seasonal", { keywords: value })}
            placeholder="winter, ss26, final sale"
            autoComplete="off"
          />
          <PresetValuePicker
            label="Collections"
            kind="collection"
            value={presetDetails.seasonal.collectionIds}
            displayValue={presetDetails.seasonal.collectionTitles}
            textPlaceholder="Search collections"
            freeform={false}
            allowMultiple
            onChange={(value, label) => {
              onChange("seasonal", {
                collectionIds: Array.isArray(value)
                  ? value
                  : compactValueList([value]),
                collectionTitles: Array.isArray(label)
                  ? label
                  : compactValueList([label]),
              });
            }}
          />
          <PresetValuePicker
            label="Season tags"
            kind="tag"
            value={presetDetails.seasonal.tags}
            textPlaceholder="fw25, clearance"
            allowMultiple
            onChange={(value) =>
              onChange("seasonal", {
                tags: Array.isArray(value) ? value : compactValueList([value]),
              })
            }
          />
          <Select
            label="Inventory scope"
            options={INVENTORY_OPTIONS}
            value={presetDetails.seasonal.inventory}
            onChange={(value) => onChange("seasonal", { inventory: value })}
          />
        </div>
      ) : null}

      {preset === "vendor" ? (
        <div className="rml-preset-config__grid">
          <PresetValuePicker
            label="Vendors"
            kind="vendor"
            value={presetDetails.vendor.vendors}
            textPlaceholder="Vendor to retire"
            allowMultiple
            onChange={(value) =>
              onChange("vendor", {
                vendors: Array.isArray(value)
                  ? value
                  : compactValueList([value]),
              })
            }
          />
          <PresetValuePicker
            label="Product types"
            kind="productType"
            value={presetDetails.vendor.productTypes}
            textPlaceholder="Shoes, Bags, Shirts"
            allowMultiple
            onChange={(value) =>
              onChange("vendor", {
                productTypes: Array.isArray(value)
                  ? value
                  : compactValueList([value]),
              })
            }
          />
        </div>
      ) : null}

      {preset === "oos" ? (
        <div className="rml-preset-config__grid">
          <Select
            label="Last updated"
            options={UPDATED_OPTIONS}
            value={presetDetails.oos.updated}
            onChange={(value) => onChange("oos", { updated: value })}
          />
          <PresetValuePicker
            label="Product types"
            kind="productType"
            value={presetDetails.oos.productTypes}
            textPlaceholder="Product type"
            allowMultiple
            onChange={(value) =>
              onChange("oos", {
                productTypes: Array.isArray(value)
                  ? value
                  : compactValueList([value]),
              })
            }
          />
          <PresetValuePicker
            label="Lifecycle tags"
            kind="tag"
            value={presetDetails.oos.tags}
            textPlaceholder="discontinued, final-sale"
            allowMultiple
            onChange={(value) =>
              onChange("oos", {
                tags: Array.isArray(value) ? value : compactValueList([value]),
              })
            }
          />
        </div>
      ) : null}

      {preset === "spring" ? (
        <div className="rml-preset-config__grid">
          <PresetValuePicker
            label="Cleanup tags"
            kind="tag"
            value={presetDetails.spring.tags}
            textPlaceholder="clearance, outlet"
            allowMultiple
            onChange={(value) =>
              onChange("spring", {
                tags: Array.isArray(value) ? value : compactValueList([value]),
              })
            }
          />
          <Select
            label="Inventory scope"
            options={INVENTORY_OPTIONS}
            value={presetDetails.spring.inventory}
            onChange={(value) => onChange("spring", { inventory: value })}
          />
          <Select
            label="Last updated"
            options={UPDATED_OPTIONS}
            value={presetDetails.spring.updated}
            onChange={(value) => onChange("spring", { updated: value })}
          />
          <PresetValuePicker
            label="Product types"
            kind="productType"
            value={presetDetails.spring.productTypes}
            textPlaceholder="Product type"
            allowMultiple
            onChange={(value) =>
              onChange("spring", {
                productTypes: Array.isArray(value)
                  ? value
                  : compactValueList([value]),
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function PresetConfigDisclosure({
  preset,
  presetDetails,
  open,
  onToggle,
  onChange,
}: {
  preset: CleanupPreset;
  presetDetails: PresetDetails;
  open: boolean;
  onToggle(): void;
  onChange(preset: ConfigurablePreset, patch: PresetDetailPatch): void;
}) {
  if (!isConfigurablePreset(preset)) return null;

  const scenario = SCENARIOS.find((item) => item.id === preset);
  return (
    <div
      className={`rml-preset-disclosure${open ? " rml-preset-disclosure--open" : ""}`}
    >
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="050">
          <Text variant="headingSm" as="h3">
            {open
              ? "Preset setup"
              : `Need to reconfigure ${scenario?.title ?? "this preset"}?`}
          </Text>
          <Text variant="bodySm" tone="subdued" as="p">
            {open
              ? "Changes here update the product filters and generated rules."
              : "Open the preset setup only if the cleanup criteria changed."}
          </Text>
        </BlockStack>
        <Button variant="plain" onClick={onToggle}>
          {open ? "Hide setup" : "Open setup"}
        </Button>
      </InlineStack>
      {open ? (
        <PresetConfigPanel
          preset={preset}
          presetDetails={presetDetails}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function CatalogFilterTile({
  icon,
  title,
  detail,
  active,
  children,
}: {
  icon: string;
  title: string;
  detail: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rml-filter-tile${active ? " rml-filter-tile--active" : ""}`}
    >
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <span className="rml-filter-tile__icon" aria-hidden="true">
          {icon}
        </span>
        <BlockStack gap="050">
          <Text variant="headingSm" as="h3">
            {title}
          </Text>
          <Text variant="bodySm" tone="subdued" as="p">
            {detail}
          </Text>
        </BlockStack>
      </InlineStack>
      <div className="rml-filter-tile__control">{children}</div>
    </div>
  );
}

// ─── Step 1: Onboarding Explainer ────────────────────────────
function OnboardingExplainer({ onNext }: { onNext(): void }) {
  const introSteps = [
    {
      n: 1,
      title: "Pick products",
      description:
        "Select what you're retiring. Filter by tag, vendor, collection, status, or stock signal.",
      icon: ClipboardChecklistIcon,
      accent: "#0f7c8f",
      soft: "#e5f7fa",
    },
    {
      n: 2,
      title: "Review redirects",
      description:
        "Preview every source URL and tune the suggested target before anything changes.",
      icon: DomainRedirectIcon,
      accent: "#b84b43",
      soft: "#fff0ed",
    },
    {
      n: 3,
      title: "Apply or export",
      description:
        "Push redirects to Shopify, archive products, or export a clean CSV trail.",
      icon: PaperCheckIcon,
      accent: "#0f6f5c",
      soft: "#e8f6f1",
    },
  ];

  return (
    <>
      <WizardProgressNav
        currentStep="onboarding-1"
        onNext={onNext}
        nextLabel="Get started"
      />
      <Page
        title="Redirect Pulse: Bulk Redirects"
        subtitle="Pre-delete redirect assistant for seasonal cleanups"
      >
        <Card padding="0">
          <div className="rml-onboarding-card">
            <div className="rml-onboarding-hero">
              <div className="rml-onboarding-copy">
                <div className="rml-cleanup-kicker">Cleanup command center</div>
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2">
                    Retire products without breaking links
                  </Text>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Pick the products you are about to archive or delete. We
                    will suggest where each URL should redirect by collection,
                    vendor, or your own rules before any 404s happen.
                  </Text>
                </BlockStack>
                <div className="rml-onboarding-cta">
                  <Button
                    icon={ArrowRightIcon}
                    variant="primary"
                    size="large"
                    onClick={onNext}
                  >
                    Get started
                  </Button>
                </div>
              </div>

              <div className="rml-onboarding-visual" aria-hidden="true">
                <img src="/hero.jpg" alt="" />
                <div className="rml-onboarding-route-card rml-onboarding-route-card--source">
                  404 risk
                </div>
                <div className="rml-onboarding-route-card rml-onboarding-route-card--target">
                  Redirect ready
                </div>
              </div>
            </div>

            <div className="rml-onboarding-divider" />

            <div className="rml-onboarding-steps">
              {introSteps.map((step) => (
                <div
                  className="rml-onboarding-step"
                  key={step.n}
                  style={
                    {
                      "--rml-step-accent": step.accent,
                      "--rml-step-soft": step.soft,
                    } as CSSProperties
                  }
                >
                  <div className="rml-onboarding-step__top">
                    <span
                      className="rml-onboarding-step__icon"
                      aria-hidden="true"
                    >
                      <Icon source={step.icon} />
                    </span>
                    <span className="rml-onboarding-step__number">
                      {step.n}
                    </span>
                  </div>
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h3">
                      {step.title}
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {step.description}
                    </Text>
                  </BlockStack>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Page>
    </>
  );
}

// ─── Step 2: Onboarding Wizard ───────────────────────────────
function OnboardingWizard({
  onBack,
  onNext,
  selectedPreset,
  setSelectedPreset,
  presetDetails,
  setPresetDetails,
}: {
  onBack(): void;
  onNext(): void;
  selectedPreset: CleanupPreset;
  setSelectedPreset: (preset: CleanupPreset) => void;
  presetDetails: PresetDetails;
  setPresetDetails: Dispatch<SetStateAction<PresetDetails>>;
}) {
  const updatePresetDetails = (
    preset: ConfigurablePreset,
    patch: PresetDetailPatch,
  ) => {
    setPresetDetails((current) => mergePresetDetails(current, preset, patch));
  };

  return (
    <>
      <WizardProgressNav
        currentStep="onboarding-2"
        onBack={onBack}
        onNext={onNext}
        nextLabel="Continue"
      />
      <Page
        title="What kind of cleanup?"
        subtitle="This sets sensible default rules. You can edit any of them after."
        secondaryActions={[
          {
            content: "Skip — I'll set up manually",
            onAction: () => {
              setSelectedPreset("none");
              onNext();
            },
          },
        ]}
      >
        <BlockStack gap="400">
          <Card>
            <div className="rml-cleanup-card">
              <BlockStack gap="500">
                <div className="rml-cleanup-header">
                  <div className="rml-cleanup-kicker">Redirect strategy</div>
                  <Text variant="headingLg" as="h2">
                    Choose the cleanup path
                  </Text>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Start with a scenario that matches the catalog risk, then
                    tune the rules before any product URL changes.
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
                            <span className="rml-scenario-title">
                              {scenario.title}
                            </span>
                          </Text>
                          <p className="rml-scenario-description">
                            {scenario.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <PresetConfigPanel
                  preset={selectedPreset}
                  presetDetails={presetDetails}
                  onChange={updatePresetDetails}
                />

                <Banner tone="info">
                  Defaults are a starting point. The next step lets you review
                  and tweak each rule before any redirect is created.
                </Banner>
              </BlockStack>
            </div>
          </Card>
        </BlockStack>
      </Page>
    </>
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
  presetDetails,
  setPresetDetails,
  productTargetingPrefill,
}: {
  onBack(): void;
  onNext(): void;
  selectedProducts: SelectedProductMap;
  setSelectedProducts: Dispatch<SetStateAction<SelectedProductMap>>;
  selectedPreset: CleanupPreset;
  setSelectedPreset: (preset: CleanupPreset) => void;
  presetDetails: PresetDetails;
  setPresetDetails: Dispatch<SetStateAction<PresetDetails>>;
  productTargetingPrefill?: ProductTargetingPrefill | null;
}) {
  const productsFetcher = useFetcher<typeof productsLoader>();
  const loadProductsRef = useRef(productsFetcher.load);
  const [selectedTab, setSelectedTab] = useState(
    () => initialProductTargeting(selectedPreset, presetDetails).tabIndex,
  );
  const [searchValue, setSearchValue] = useState("");
  const [tableSearchOpen, setTableSearchOpen] = useState(false);
  const [vendors, setVendors] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [collectionTitles, setCollectionTitles] = useState<string[]>([]);
  const [collectionTitlePatterns, setCollectionTitlePatterns] = useState<
    string[]
  >([]);
  const [types, setTypes] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [taxonomyJoin, setTaxonomyJoin] = useState<TaxonomyJoin>("and");
  const [vendorJoin, setVendorJoin] = useState<TaxonomyValueJoin>("any");
  const [collectionJoin, setCollectionJoin] =
    useState<TaxonomyValueJoin>("any");
  const [typeJoin, setTypeJoin] = useState<TaxonomyValueJoin>("any");
  const [tagJoin, setTagJoin] = useState<TaxonomyValueJoin>("any");
  const [inventory, setInventory] = useState(
    () => initialProductTargeting(selectedPreset, presetDetails).inventory,
  );
  const [inventoryValue, setInventoryValue] = useState("");
  const [updated, setUpdated] = useState(
    () => initialProductTargeting(selectedPreset, presetDetails).updated,
  );
  const [presetFiltersApplied, setPresetFiltersApplied] = useState<
    string | null
  >(null);
  const [presetConfigOpen, setPresetConfigOpen] = useState(false);
  const [pageStack, setPageStack] = useState<(string | null)[]>([null]);
  const [pageSize, setPageSize] = useState(
    String(PRODUCT_PAGE_SIZE_OPTIONS[0]),
  );
  const [productsLoadingTimedOut, setProductsLoadingTimedOut] = useState(false);
  const [lastProductsRequestPath, setLastProductsRequestPath] = useState("");
  const [selectionLimitMessage, setSelectionLimitMessage] = useState<
    string | null
  >(null);
  const appliedProductPrefillKeyRef = useRef<string | null>(null);

  const data = productsFetcher.data as ProductsLoaderData | undefined;
  const products = useMemo(
    () => (data?.products ?? []) as ProductRow[],
    [data?.products],
  );
  const pageInfo = data?.pageInfo ?? {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  };
  const isLoading = productsFetcher.state !== "idle";
  const currentAfter = pageStack[pageStack.length - 1] ?? null;
  const selectedIds = useMemo(
    () => new Set(selectedProducts.keys()),
    [selectedProducts],
  );
  const currentPageSelectedCount = useMemo(
    () => products.filter((product) => selectedIds.has(product.id)).length,
    [products, selectedIds],
  );
  const selectedProductLimitReached =
    selectedProducts.size >= MAX_PRODUCTS_PER_CLEANUP_RUN;
  const selectedProductLimitExceeded =
    selectedProducts.size > MAX_PRODUCTS_PER_CLEANUP_RUN;
  const defaultSelectionLimitMessage = `You can select up to ${MAX_PRODUCTS_PER_CLEANUP_RUN} products in one cleanup run. Apply this batch, then start another cleanup for the remaining products.`;
  const selectedScenario = SCENARIOS.find(
    (scenario) => scenario.id === selectedPreset,
  );
  const collectionFilterValues = useMemo(
    () => [...collectionIds, ...collectionTitlePatterns],
    [collectionIds, collectionTitlePatterns],
  );
  const collectionFilterLabels = useMemo(
    () => [...collectionTitles, ...collectionTitlePatterns],
    [collectionTitlePatterns, collectionTitles],
  );

  const selectProductsWithLimit = (candidateProducts: ProductRow[]) => {
    const next = new Map(selectedProducts);
    const seenCandidateIds = new Set<string>();
    const productsToConsider = candidateProducts.filter((product) => {
      if (next.has(product.id) || seenCandidateIds.has(product.id))
        return false;
      seenCandidateIds.add(product.id);
      return true;
    });
    const availableSlots = Math.max(
      0,
      MAX_PRODUCTS_PER_CLEANUP_RUN - next.size,
    );
    productsToConsider.slice(0, availableSlots).forEach((product) => {
      next.set(product.id, product);
    });

    if (productsToConsider.length > availableSlots) {
      setSelectionLimitMessage(defaultSelectionLimitMessage);
    } else if (
      next.size >= MAX_PRODUCTS_PER_CLEANUP_RUN &&
      productsToConsider.length
    ) {
      setSelectionLimitMessage(defaultSelectionLimitMessage);
    } else {
      setSelectionLimitMessage(null);
    }
    setSelectedProducts(next);
  };

  const deselectProducts = (candidateProducts: ProductRow[]) => {
    const next = new Map(selectedProducts);
    candidateProducts.forEach((product) => next.delete(product.id));
    setSelectionLimitMessage(null);
    setSelectedProducts(next);
  };

  const handleSelectionChange = (
    selectionType: string,
    isSelecting: boolean,
    selection?: string | [number, number],
  ) => {
    if (selectionType === "all" || selectionType === "page") {
      if (isSelecting) {
        selectProductsWithLimit(products);
      } else {
        deselectProducts(products);
      }
    } else if (selectionType === "range" && Array.isArray(selection)) {
      const [start, end] = selection;
      const rangeProducts = products.slice(start, end + 1);
      if (isSelecting) {
        selectProductsWithLimit(rangeProducts);
      } else {
        deselectProducts(rangeProducts);
      }
    } else if (selectionType === "single" && typeof selection === "string") {
      const product = products.find((item) => item.id === selection);
      if (!product) return;
      if (isSelecting) {
        selectProductsWithLimit([product]);
      } else {
        deselectProducts([product]);
      }
    }
  };

  const clearSelectedProducts = () => {
    setSelectionLimitMessage(null);
    setSelectedProducts(new Map());
  };

  const tabs = PRODUCT_STATUS_SCOPES;

  const selectedScope = tabs[selectedTab] ?? tabs[0];
  const stockSelectorVisible = selectedScope.id === "custom_stock";
  const selectedTabId =
    selectedScope.id === "custom_stock" ? "all" : selectedScope.id;

  const resetPagination = useCallback(() => setPageStack([null]), []);

  const buildProductParams = useCallback(
    ({
      includePagination,
      bulk,
    }: {
      includePagination: boolean;
      bulk?: boolean;
    }) => {
      const params = new URLSearchParams();
      params.set("first", pageSize);
      if (searchValue.trim()) params.set("q", searchValue.trim());
      if (selectedTabId !== "all") params.set("tab", selectedTabId);
      vendors.forEach((item) => params.append("vendor", item));
      collectionIds.forEach((item) => params.append("collection", item));
      collectionFilterLabels.forEach((item) =>
        params.append("collectionTitle", item),
      );
      types.forEach((item) => params.append("type", item));
      tags.forEach((item) => params.append("tag", item));
      params.set("taxonomyJoin", taxonomyJoin);
      params.set("vendorJoin", vendorJoin);
      params.set("collectionJoin", collectionJoin);
      params.set("typeJoin", typeJoin);
      params.set("tagJoin", tagJoin);
      if (stockSelectorVisible && inventory) params.set("inventory", inventory);
      if (
        stockSelectorVisible &&
        (inventory === "below" || inventory === "above") &&
        inventoryValue.trim()
      ) {
        params.set("inventoryValue", inventoryValue.trim());
      }
      if (updated) params.set("updated", updated);
      if (includePagination && currentAfter) params.set("after", currentAfter);
      if (bulk) params.set("bulk", "1");
      return params;
    },
    [
      collectionIds,
      collectionJoin,
      collectionFilterLabels,
      currentAfter,
      inventory,
      inventoryValue,
      pageSize,
      searchValue,
      selectedTabId,
      stockSelectorVisible,
      tags,
      tagJoin,
      taxonomyJoin,
      types,
      typeJoin,
      updated,
      vendorJoin,
      vendors,
    ],
  );

  const productRequestPath = useMemo(() => {
    const params = buildProductParams({
      includePagination: true,
    });
    return `/app/products?${params.toString()}`;
  }, [buildProductParams]);
  const hasPendingProductRequest =
    productRequestPath !== lastProductsRequestPath;
  const showProductLoading =
    (isLoading || hasPendingProductRequest) && !productsLoadingTimedOut;
  const tableLoading = showProductLoading;

  const inventoryLabel = inventoryFilterLabel(inventory, inventoryValue);
  const inventoryFilterActive =
    Boolean(inventory) &&
    (inventory !== "below" && inventory !== "above"
      ? true
      : Boolean(inventoryValue.trim()));
  const updatedLabel = optionLabel(UPDATED_OPTIONS, updated);
  const activeTargetFilters = [
    selectedTabId !== "all" && {
      key: "status",
      label: selectedScope.label,
    },
    searchValue.trim() && {
      key: "search",
      label: `Search: ${searchValue.trim()}`,
    },
    (vendors.length ||
      collectionFilterLabels.length ||
      types.length ||
      tags.length) && {
      key: "taxonomyJoin",
      label: `Taxonomy: ${taxonomyGroupJoinLabel(taxonomyJoin)}`,
    },
    vendors.length && {
      key: "vendor",
      label: `Vendor: ${taxonomyFilterSummary(vendors, "", vendorJoin)}`,
    },
    collectionFilterLabels.length && {
      key: "collection",
      label: `Collection: ${taxonomyFilterSummary(
        collectionFilterLabels,
        "Selected collections",
        collectionJoin,
      )}`,
    },
    types.length && {
      key: "type",
      label: `Type: ${taxonomyFilterSummary(types, "", typeJoin)}`,
    },
    tags.length && {
      key: "tag",
      label: `Tag: ${taxonomyFilterSummary(tags, "", tagJoin)}`,
    },
    stockSelectorVisible &&
      inventoryFilterActive && { key: "inventory", label: inventoryLabel },
    updated && { key: "updated", label: updatedLabel },
  ].filter(Boolean) as { key: string; label: string }[];

  const clearAllFilters = () => {
    setSearchValue("");
    setTableSearchOpen(false);
    setVendors([]);
    setCollectionIds([]);
    setCollectionTitles([]);
    setCollectionTitlePatterns([]);
    setTypes([]);
    setTags([]);
    setTaxonomyJoin("and");
    setVendorJoin("any");
    setCollectionJoin("any");
    setTypeJoin("any");
    setTagJoin("any");
    setInventory("");
    setInventoryValue("");
    setUpdated("");
    setSelectedTab(0);
    setSelectedPreset("none");
    setPresetFiltersApplied(null);
    resetPagination();
  };

  useEffect(() => {
    loadProductsRef.current = productsFetcher.load;
  }, [productsFetcher.load]);

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

  const handleScopeSelect = (index: number) => {
    const nextScope = tabs[index] ?? tabs[0];
    setSelectedTab(index);
    if (nextScope.id === "custom_stock") {
      setInventory((current) => current || "low");
    } else {
      setInventory("");
      setInventoryValue("");
    }
    resetPagination();
  };

  const handleQueryChange = (value: string) => {
    setSearchValue(value);
    resetPagination();
  };

  const setTabById = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      setSelectedTab(index >= 0 ? index : 0);
    },
    [tabs],
  );

  const applyQuickFilter = useCallback(
    (
      preset: CleanupPreset,
      detailSource = presetDetails,
      applyKey = preset,
    ) => {
      const seasonalDetails = detailSource.seasonal;
      const vendorDetails = detailSource.vendor;
      const oosDetails = detailSource.oos;
      const springDetails = detailSource.spring;

      setSelectedPreset(preset);
      setSearchValue("");
      setTableSearchOpen(false);
      setVendors([]);
      setCollectionIds([]);
      setCollectionTitles([]);
      setCollectionTitlePatterns([]);
      setTypes([]);
      setTags([]);
      setTaxonomyJoin("and");
      setVendorJoin("any");
      setCollectionJoin("any");
      setTypeJoin("any");
      setTagJoin("any");
      setInventoryValue("");
      setPresetFiltersApplied(applyKey);

      if (preset === "none") {
        setInventory("");
        setUpdated("");
        setTabById("all");
      }
      if (preset === "seasonal") {
        const seasonalInventory = seasonalDetails.inventory;
        setUpdated("");
        setTabById(productScopeForInventory(seasonalInventory));
        setInventory(productFilterInventoryValue(seasonalInventory));
        setSearchValue(seasonalDetails.keywords);
        setTableSearchOpen(Boolean(seasonalDetails.keywords.trim()));
        setTags(seasonalDetails.tags);
        setCollectionIds(seasonalDetails.collectionIds);
        setCollectionTitles(seasonalDetails.collectionTitles);
        setCollectionTitlePatterns([]);
      }
      if (preset === "vendor") {
        setVendors(vendorDetails.vendors);
        setTypes(vendorDetails.productTypes);
        setInventory("");
        setUpdated("");
        setTabById("all");
      }
      if (preset === "oos") {
        setInventory("");
        setUpdated(oosDetails.updated);
        setTypes(oosDetails.productTypes);
        setTags(oosDetails.tags);
        setTabById("oos");
      }
      if (preset === "spring") {
        const springInventory = springDetails.inventory;
        setInventory(productFilterInventoryValue(springInventory));
        setUpdated(springDetails.updated);
        setTabById(productScopeForInventory(springInventory));
        setTags(springDetails.tags);
        setTypes(springDetails.productTypes);
      }
      resetPagination();
    },
    [presetDetails, resetPagination, setSelectedPreset, setTabById],
  );

  useEffect(() => {
    if (!productTargetingPrefill) return;
    if (appliedProductPrefillKeyRef.current === productTargetingPrefill.key)
      return;
    appliedProductPrefillKeyRef.current = productTargetingPrefill.key;

    const requestedTab =
      productTargetingPrefill.tab ||
      productScopeForInventory(productTargetingPrefill.inventory);
    const stockTab =
      productTargetingPrefill.inventory && requestedTab === "all"
        ? "custom_stock"
        : requestedTab;

    setSearchValue(productTargetingPrefill.q);
    setTableSearchOpen(Boolean(productTargetingPrefill.q.trim()));
    setVendors(productTargetingPrefill.vendors);
    setCollectionIds(productTargetingPrefill.collectionIds);
    setCollectionTitles(productTargetingPrefill.collectionTitles);
    setCollectionTitlePatterns(productTargetingPrefill.collectionTitlePatterns);
    setTypes(productTargetingPrefill.types);
    setTags(productTargetingPrefill.tags);
    setTaxonomyJoin(productTargetingPrefill.taxonomyJoin);
    setVendorJoin(productTargetingPrefill.vendorJoin);
    setCollectionJoin(productTargetingPrefill.collectionJoin);
    setTypeJoin(productTargetingPrefill.typeJoin);
    setTagJoin(productTargetingPrefill.tagJoin);
    setUpdated(productTargetingPrefill.updated);
    setInventoryValue(productTargetingPrefill.inventoryValue);
    setTabById(stockTab);
    setInventory(
      stockTab === "custom_stock" ? productTargetingPrefill.inventory : "",
    );
    setPresetFiltersApplied(selectedPreset);
    resetPagination();
  }, [productTargetingPrefill, resetPagination, selectedPreset, setTabById]);

  const updatePresetDetailsForProducts = (
    preset: ConfigurablePreset,
    patch: PresetDetailPatch,
  ) => {
    const nextDetails = mergePresetDetails(presetDetails, preset, patch);
    setPresetDetails(nextDetails);
    if (selectedPreset === preset) {
      applyQuickFilter(preset, nextDetails, preset);
    }
  };

  useEffect(() => {
    if (productTargetingPrefill) return;
    const applyKey = selectedPreset;
    if (presetFiltersApplied === applyKey) return;
    applyQuickFilter(selectedPreset, presetDetails, applyKey);
  }, [
    presetFiltersApplied,
    presetDetails,
    productTargetingPrefill,
    selectedPreset,
    applyQuickFilter,
  ]);

  const hasActiveProductFilters =
    Boolean(searchValue.trim()) ||
    selectedTabId !== "all" ||
    activeTargetFilters.length > 0;
  const tableSearchVisible = tableSearchOpen || Boolean(searchValue.trim());

  const productMarkup = products.map((product: ProductRow, index: number) => {
    const productTitle = truncateProductTitle(product.name);

    return (
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
                <span title={product.name}>{productTitle}</span>
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
          <Text variant="bodyMd" as="span">
            {product.vendor || "None"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {product.type || "None"}
          </Text>
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
    );
  });

  return (
    <>
      <WizardProgressNav
        currentStep="products"
        onBack={onBack}
        onNext={onNext}
        nextDisabled={
          selectedProducts.size === 0 || selectedProductLimitExceeded
        }
        nextLabel={
          selectedProducts.size
            ? `Continue with ${selectedProducts.size}`
            : "Select products"
        }
      />
      <Page
        title="Pick products to retire"
        subtitle="Select the products you're about to archive or delete"
      >
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
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
              <PresetConfigDisclosure
                preset={selectedPreset}
                presetDetails={presetDetails}
                open={presetConfigOpen}
                onToggle={() => setPresetConfigOpen((open) => !open)}
                onChange={updatePresetDetailsForProducts}
              />
            </BlockStack>
          </Card>

          <Card>
            <div className="rml-targeting-panel">
              <div className="rml-targeting-header">
                <BlockStack gap="100">
                  <div className="rml-cleanup-kicker">Catalog targeting</div>
                  <Text variant="headingMd" as="h2">
                    {selectedScenario?.title ?? "Manual cleanup"}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    {selectedScenario?.description ??
                      "Combine store fields, campaign signals, and product lifecycle filters."}
                  </Text>
                </BlockStack>
                <div className="rml-reset-action">
                  <Button
                    icon={ResetIcon}
                    tone="critical"
                    variant="primary"
                    onClick={clearAllFilters}
                  >
                    Reset targeting
                  </Button>
                </div>
              </div>

              <div
                className="rml-status-scope-grid"
                role="list"
                aria-label="Product status scope"
              >
                {tabs.map((scope, index) => {
                  const selected = selectedTab === index;
                  return (
                    <button
                      key={scope.id}
                      type="button"
                      className={`rml-status-scope${selected ? " rml-status-scope--selected" : ""}`}
                      style={
                        { "--rml-scope-accent": scope.accent } as CSSProperties
                      }
                      aria-pressed={selected}
                      onClick={() => handleScopeSelect(index)}
                    >
                      <span className="rml-status-scope__label">
                        {scope.label}
                      </span>
                      <span className="rml-status-scope__detail">
                        {scope.detail}
                      </span>
                    </button>
                  );
                })}
              </div>

              {stockSelectorVisible ? (
                <div className="rml-stock-strip">
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <span className="rml-filter-tile__icon" aria-hidden="true">
                      ●
                    </span>
                    <BlockStack gap="050">
                      <Text variant="headingSm" as="h3">
                        Stock targeting
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {inventoryLabel || "Any inventory level"}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <div className="rml-stock-strip__controls">
                    {inventory === "below" || inventory === "above" ? (
                      <div className="rml-stock-strip__threshold">
                        <TextField
                          label="Threshold units"
                          type="number"
                          min={0}
                          value={inventoryValue}
                          onChange={(value) => {
                            setInventoryValue(value);
                            resetPagination();
                          }}
                          placeholder="Units"
                          autoComplete="off"
                        />
                      </div>
                    ) : (
                      <div
                        className="rml-stock-strip__threshold"
                        aria-hidden="true"
                      />
                    )}
                    <div className="rml-stock-strip__selector">
                      <Select
                        label="Stock rule"
                        options={INVENTORY_FILTER_OPTIONS}
                        value={inventory}
                        onChange={(value) => {
                          setInventory(value);
                          if (value !== "below" && value !== "above")
                            setInventoryValue("");
                          resetPagination();
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rml-filter-section">
                <div className="rml-filter-section__title rml-taxonomy-header">
                  <div>
                    <Text variant="headingSm" as="h3">
                      Shopify taxonomy
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Vendor, collection, product type, and tag come from the
                      store catalog.
                    </Text>
                  </div>
                  <div className="rml-taxonomy-header__control">
                    <Select
                      label="Combine taxonomy groups"
                      options={TAXONOMY_GROUP_JOIN_OPTIONS}
                      value={taxonomyJoin}
                      onChange={(value) => {
                        setTaxonomyJoin(value as TaxonomyJoin);
                        resetPagination();
                      }}
                    />
                  </div>
                </div>
                <div className="rml-filter-grid">
                  <CatalogFilterTile
                    icon="🏷️"
                    title="Vendor"
                    detail={taxonomyFilterSummary(
                      vendors,
                      "Any vendor",
                      vendorJoin,
                    )}
                    active={vendors.length > 0}
                  >
                    <div className="rml-filter-tile__logic">
                      <Select
                        label="Match selected vendors"
                        labelHidden
                        options={TAXONOMY_VALUE_JOIN_OPTIONS}
                        value={vendorJoin}
                        onChange={(value) => {
                          setVendorJoin(value as TaxonomyValueJoin);
                          resetPagination();
                        }}
                      />
                    </div>
                    <CatalogValuePicker
                      label="Vendor"
                      labelHidden
                      kind="vendor"
                      value={vendors}
                      textPlaceholder="Search vendors"
                      allowMultiple
                      onChange={(value) => {
                        setVendors(
                          Array.isArray(value)
                            ? value
                            : compactValueList([value]),
                        );
                        resetPagination();
                      }}
                    />
                  </CatalogFilterTile>
                  <CatalogFilterTile
                    icon="🗂️"
                    title="Collection"
                    detail={taxonomyFilterSummary(
                      collectionFilterLabels,
                      "Any collection",
                      collectionJoin,
                    )}
                    active={collectionFilterLabels.length > 0}
                  >
                    <div className="rml-filter-tile__logic">
                      <Select
                        label="Match selected collections"
                        labelHidden
                        options={TAXONOMY_VALUE_JOIN_OPTIONS}
                        value={collectionJoin}
                        onChange={(value) => {
                          setCollectionJoin(value as TaxonomyValueJoin);
                          resetPagination();
                        }}
                      />
                    </div>
                    <CatalogValuePicker
                      label="Collection"
                      labelHidden
                      kind="collection"
                      value={collectionFilterValues}
                      displayValue={collectionFilterLabels}
                      textPlaceholder="Search collections"
                      freeform
                      allowMultiple
                      onChange={(value, label) => {
                        const nextValues = Array.isArray(value)
                          ? compactValueList(value)
                          : compactValueList([value]);
                        const nextLabels = Array.isArray(label)
                          ? compactValueList(label)
                          : compactValueList([label]);
                        const nextIds: string[] = [];
                        const nextTitles: string[] = [];
                        const nextPatterns: string[] = [];

                        nextValues.forEach((item, index) => {
                          const display = nextLabels[index] || item;
                          if (item.startsWith("gid://")) {
                            nextIds.push(item);
                            nextTitles.push(display);
                          } else {
                            nextPatterns.push(display);
                          }
                        });

                        setCollectionIds(nextIds);
                        setCollectionTitles(nextTitles);
                        setCollectionTitlePatterns(nextPatterns);
                        resetPagination();
                      }}
                    />
                  </CatalogFilterTile>
                  <CatalogFilterTile
                    icon="◧"
                    title="Product type"
                    detail={taxonomyFilterSummary(types, "Any type", typeJoin)}
                    active={types.length > 0}
                  >
                    <div className="rml-filter-tile__logic">
                      <Select
                        label="Match selected product types"
                        labelHidden
                        options={TAXONOMY_VALUE_JOIN_OPTIONS}
                        value={typeJoin}
                        onChange={(value) => {
                          setTypeJoin(value as TaxonomyValueJoin);
                          resetPagination();
                        }}
                      />
                    </div>
                    <CatalogValuePicker
                      label="Product type"
                      labelHidden
                      kind="productType"
                      value={types}
                      textPlaceholder="Search product types"
                      allowMultiple
                      onChange={(value) => {
                        setTypes(
                          Array.isArray(value)
                            ? value
                            : compactValueList([value]),
                        );
                        resetPagination();
                      }}
                    />
                  </CatalogFilterTile>
                  <CatalogFilterTile
                    icon="#"
                    title="Tag"
                    detail={taxonomyFilterSummary(tags, "Any tag", tagJoin)}
                    active={tags.length > 0}
                  >
                    <div className="rml-filter-tile__logic">
                      <Select
                        label="Match selected tags"
                        labelHidden
                        options={TAXONOMY_VALUE_JOIN_OPTIONS}
                        value={tagJoin}
                        onChange={(value) => {
                          setTagJoin(value as TaxonomyValueJoin);
                          resetPagination();
                        }}
                      />
                    </div>
                    <CatalogValuePicker
                      label="Tag"
                      labelHidden
                      kind="tag"
                      value={tags}
                      textPlaceholder="Search tags"
                      allowMultiple
                      onChange={(value) => {
                        setTags(
                          Array.isArray(value)
                            ? value
                            : compactValueList([value]),
                        );
                        resetPagination();
                      }}
                    />
                  </CatalogFilterTile>
                </div>
              </div>

              <div className="rml-filter-section">
                <div className="rml-filter-section__title">
                  <Text variant="headingSm" as="h3">
                    Lifecycle signals
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Update age narrows stale catalog items without changing the
                    preset setup.
                  </Text>
                </div>
                <div className="rml-filter-grid rml-filter-grid--signals">
                  <CatalogFilterTile
                    icon="↻"
                    title="Last updated"
                    detail={updatedLabel || "Any update age"}
                    active={Boolean(updated)}
                  >
                    <Select
                      label="Last updated"
                      labelHidden
                      options={UPDATED_OPTIONS}
                      value={updated}
                      onChange={(value) => {
                        setUpdated(value);
                        resetPagination();
                      }}
                    />
                  </CatalogFilterTile>
                </div>
              </div>

              <div className="rml-active-filter-row">
                {activeTargetFilters.length ? (
                  <>
                    <span className="rml-active-filter-row__label">
                      Applied to product table
                    </span>
                    {activeTargetFilters.map((filter) => (
                      <span className="rml-active-filter-pill" key={filter.key}>
                        {filter.label}
                      </span>
                    ))}
                  </>
                ) : (
                  <Text variant="bodySm" tone="subdued" as="span">
                    No extra targeting filters applied
                  </Text>
                )}
              </div>
            </div>
          </Card>

          <Card padding="0">
            <Box padding="400">
              <div className="rml-table-toolbar">
                <div className="rml-table-toolbar__summary">
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingMd" as="h2">
                        Matching products
                      </Text>
                      <Badge
                        tone={selectedProducts.size > 0 ? "success" : "info"}
                      >
                        {`${selectedProducts.size} / ${MAX_PRODUCTS_PER_CLEANUP_RUN} selected`}
                      </Badge>
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued" as="p">
                      {showProductLoading
                        ? "Loading Shopify products..."
                        : `${products.length} products on this page`}
                    </Text>
                  </BlockStack>
                </div>
                <div className="rml-table-toolbar__actions">
                  <Select
                    label="Products per page"
                    labelInline
                    options={PRODUCT_PAGE_SIZE_SELECT_OPTIONS}
                    value={pageSize}
                    onChange={(value) => {
                      setPageSize(value);
                      resetPagination();
                    }}
                  />
                  <Button
                    icon={SearchIcon}
                    accessibilityLabel="Search products"
                    pressed={tableSearchVisible}
                    onClick={() =>
                      setTableSearchOpen((open) =>
                        searchValue.trim() ? true : !open,
                      )
                    }
                  />
                  {selectedProducts.size > 0 ? (
                    <Button
                      icon={DeleteIcon}
                      tone="critical"
                      onClick={clearSelectedProducts}
                    >
                      Clear all selected
                    </Button>
                  ) : null}
                </div>
                {tableSearchVisible ? (
                  <div className="rml-table-toolbar__search-row">
                    <div className="rml-table-search">
                      <TextField
                        label="Search products"
                        labelHidden
                        value={searchValue}
                        onChange={handleQueryChange}
                        onClearButtonClick={() => {
                          handleQueryChange("");
                          setTableSearchOpen(false);
                        }}
                        clearButton
                        placeholder="Search products"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </Box>
            <Divider />
            {selectionLimitMessage || selectedProductLimitReached ? (
              <Box padding="400">
                <Banner
                  tone={selectedProductLimitExceeded ? "critical" : "warning"}
                  title={
                    selectedProductLimitExceeded
                      ? "Too many products selected"
                      : "Selection limit reached"
                  }
                >
                  {selectionLimitMessage ?? defaultSelectionLimitMessage}
                </Banner>
              </Box>
            ) : null}
            {data?.error ? (
              <Box padding="400">
                <Banner tone="critical" title="Shopify could not load products">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">
                      {data.error}
                    </Text>
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
                <Banner
                  tone="warning"
                  title="Product sync is taking longer than expected"
                >
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">
                      Shopify has not returned product data yet. You can retry
                      the sync or clear filters to load a broader product list.
                    </Text>
                    <InlineStack gap="200">
                      <Button onClick={retryProductsLoad}>Retry</Button>
                      <Button onClick={clearAllFilters}>Clear filters</Button>
                    </InlineStack>
                  </BlockStack>
                </Banner>
              </Box>
            ) : null}
            {!showProductLoading &&
            !data?.error &&
            products.length === 0 &&
            hasActiveProductFilters ? (
              <Box padding="400">
                <Banner tone="warning" title="No products match these filters">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">
                      Broaden the filters, search by product title or handle, or
                      clear targeting and select products manually.
                    </Text>
                    <InlineStack gap="200">
                      <Button onClick={clearAllFilters}>Clear filters</Button>
                      <Button onClick={() => setTableSearchOpen(true)}>
                        Search manually
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Banner>
              </Box>
            ) : null}
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={products.length}
              selectedItemsCount={currentPageSelectedCount}
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
            <div
              style={{
                padding: "12px",
                borderTop: "1px solid var(--p-color-border-secondary, #ebebeb)",
                background: "var(--p-color-bg-surface-secondary, #fafafa)",
              }}
            >
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="bodySm" tone="subdued" as="span">
                  Showing {products.length} products on this page
                </Text>
                <Text variant="bodySm" tone="subdued" as="span">
                  {currentPageSelectedCount} selected on this page ·{" "}
                  {selectedProducts.size} / {MAX_PRODUCTS_PER_CLEANUP_RUN} total
                  selected
                </Text>
              </InlineStack>
            </div>
          </Card>
        </BlockStack>
      </Page>
    </>
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
  presetDetails,
  setPresetDetails,
}: {
  onBack(): void;
  onNext(): void;
  rules: RedirectRule[];
  setRules: Dispatch<SetStateAction<RedirectRule[]>>;
  selectedProducts: SelectedProductMap;
  selectedPreset: CleanupPreset;
  setSelectedPreset: (preset: CleanupPreset) => void;
  presetDetails: PresetDetails;
  setPresetDetails: Dispatch<SetStateAction<PresetDetails>>;
}) {
  const createRule = (): RedirectRule => ({
    id: `rule-${Date.now()}`,
    field: "collection",
    condition: FIELD_CONFIG.collection.conditions[0].value,
    value: "",
    target: "sameCollection",
    targetOption: TARGET_CONFIG.sameCollection.options?.[0]?.value ?? "",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  });

  const [draftRule, setDraftRule] = useState<RedirectRule>(createRule);
  const [showAddForm, setShowAddForm] = useState(true);
  const [presetConfigOpen, setPresetConfigOpen] = useState(false);

  const enabledRules = rules.filter((rule) => rule.enabled);
  const rulesNeedingValue = rules.filter(
    (rule) => getRuleErrors(rule).length > 0,
  );
  const fallbackEnabled = rules.some(
    (rule) => rule.enabled && rule.field === "fallback",
  );
  const ruleMatchDetails = useMemo(() => {
    const details = new Map<
      string,
      { count: number; example: RuleRedirectExample | null }
    >();
    Array.from(selectedProducts.values()).forEach((product) => {
      const matchedRule = findMatchingRule(product, rules);
      if (matchedRule) {
        const current = details.get(matchedRule.id) ?? {
          count: 0,
          example: null,
        };
        details.set(matchedRule.id, {
          count: current.count + 1,
          example:
            current.example ?? redirectExampleForProduct(product, matchedRule),
        });
      }
    });
    return details;
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
    setRules(rulesForPreset(preset, { selectedProducts, presetDetails }));
  }

  function updatePresetDetailsForRules(
    preset: ConfigurablePreset,
    patch: PresetDetailPatch,
  ) {
    const nextDetails = mergePresetDetails(presetDetails, preset, patch);
    setPresetDetails(nextDetails);
    if (selectedPreset === preset) {
      setRules(
        rulesForPreset(preset, {
          selectedProducts,
          presetDetails: nextDetails,
        }),
      );
    }
  }

  return (
    <>
      <WizardProgressNav
        currentStep="rules"
        onBack={onBack}
        onNext={onNext}
        nextDisabled={rulesNeedingValue.length > 0 || enabledRules.length === 0}
        nextLabel="Review redirects"
      />
      <Page
        title="Redirect rules"
        subtitle="Evaluated top-down — first match wins"
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
            <BlockStack gap="300">
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
              <PresetConfigDisclosure
                preset={selectedPreset}
                presetDetails={presetDetails}
                open={presetConfigOpen}
                onToggle={() => setPresetConfigOpen((open) => !open)}
                onChange={updatePresetDetailsForRules}
              />
            </BlockStack>
          </Card>

          {rulesNeedingValue.length > 0 ? (
            <Banner tone="critical" title="Some rules need attention">
              Fill in the required match values or destination before
              continuing.
            </Banner>
          ) : null}

          {!fallbackEnabled ? (
            <Banner tone="warning" title="No fallback rule is enabled">
              Products that do not match an enabled rule will be skipped in the
              redirect preview.
            </Banner>
          ) : null}

          <BlockStack gap="400">
            <Card padding="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text variant="headingMd" as="h2">
                      Rule priority
                    </Text>
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

              <div className="rml-rule-list">
                {rules.map((rule, index) => {
                  const ruleErrors = getRuleErrors(rule);
                  const ruleDetails = ruleMatchDetails.get(rule.id);
                  const coverageCount = ruleDetails?.count ?? 0;
                  const coveragePercent =
                    selectedProducts.size > 0
                      ? Math.round(
                          (coverageCount / selectedProducts.size) * 100,
                        )
                      : null;
                  const hasCoverage = rule.enabled && coverageCount > 0;
                  const hasZeroCoverage =
                    rule.enabled &&
                    selectedProducts.size > 0 &&
                    coverageCount === 0;
                  const coverageLabel =
                    coveragePercent === null
                      ? "Select products first"
                      : `${coverageCount}/${selectedProducts.size} (${coveragePercent}%)`;
                  const coverageTone = !rule.enabled
                    ? undefined
                    : coveragePercent === null
                      ? "info"
                      : hasCoverage
                        ? "success"
                        : "critical";

                  return (
                    <div
                      key={rule.id}
                      className={`rml-rule-card${
                        rule.enabled ? "" : " rml-rule-card--disabled"
                      }${hasCoverage ? " rml-rule-card--covered" : ""}${
                        hasZeroCoverage ? " rml-rule-card--zero-coverage" : ""
                      }`}
                    >
                      <div className="rml-rule-rail">
                        <div
                          className="rml-rule-position"
                          aria-label={`Rule ${index + 1}`}
                        >
                          {index + 1}
                        </div>
                        <div className="rml-rule-order-actions">
                          <span className="rml-rule-order-action">
                            <Button
                              icon={ArrowUpIcon}
                              size="slim"
                              variant="tertiary"
                              disabled={index === 0}
                              accessibilityLabel={`Move rule ${index + 1} up`}
                              onClick={() => moveRule(index, -1)}
                            />
                          </span>
                          <span className="rml-rule-order-action">
                            <Button
                              icon={ArrowDownIcon}
                              size="slim"
                              variant="tertiary"
                              disabled={index === rules.length - 1}
                              accessibilityLabel={`Move rule ${index + 1} down`}
                              onClick={() => moveRule(index, 1)}
                            />
                          </span>
                        </div>
                      </div>

                      <div className="rml-rule-card__body">
                        <BlockStack gap="300">
                          <div className="rml-rule-card__header">
                            <InlineStack gap="200" blockAlign="center">
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
                              <Badge tone={coverageTone}>
                                {`Coverage: ${coverageLabel}`}
                              </Badge>
                              <span
                                className={`rml-rule-health${
                                  hasCoverage ? " rml-rule-health--covered" : ""
                                }${hasZeroCoverage ? " rml-rule-health--empty" : ""}`}
                                title={
                                  hasZeroCoverage
                                    ? "This enabled rule is not reaching any selected product. Adjust the value, move it earlier, or delete it."
                                    : hasCoverage
                                      ? "This rule reaches selected products and will be used in the preview."
                                      : "Select products to calculate rule coverage."
                                }
                                aria-label={
                                  hasZeroCoverage
                                    ? "Rule has no coverage"
                                    : hasCoverage
                                      ? "Rule has coverage"
                                      : "Coverage pending"
                                }
                              >
                                {hasZeroCoverage
                                  ? "!"
                                  : hasCoverage
                                    ? "✓"
                                    : "i"}
                              </span>
                            </InlineStack>

                            <InlineStack
                              gap="200"
                              blockAlign="center"
                              align="end"
                            >
                              <div className="rml-rule-status-toggle">
                                <Checkbox
                                  label={
                                    rule.enabled
                                      ? "Rule active"
                                      : "Rule disabled"
                                  }
                                  checked={rule.enabled}
                                  onChange={(checked) =>
                                    updateRule(rule.id, { enabled: checked })
                                  }
                                />
                              </div>
                              <span className="rml-rule-action rml-rule-action--duplicate">
                                <Button
                                  icon={DuplicateIcon}
                                  size="slim"
                                  variant="secondary"
                                  accessibilityLabel={`Duplicate rule ${index + 1}`}
                                  onClick={() => duplicateRule(index)}
                                />
                              </span>
                              <span className="rml-rule-action rml-rule-action--delete">
                                <Button
                                  icon={DeleteIcon}
                                  size="slim"
                                  tone="critical"
                                  variant="secondary"
                                  accessibilityLabel={`Delete rule ${index + 1}`}
                                  onClick={() => removeRule(rule.id)}
                                />
                              </span>
                            </InlineStack>
                          </div>

                          <RuleFlowEditor
                            rule={rule}
                            selectedProducts={selectedProducts}
                            errors={ruleErrors}
                            redirectExample={ruleDetails?.example ?? null}
                            onChange={(patch) => updateRule(rule.id, patch)}
                          />
                        </BlockStack>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {showAddForm ? (
              <div className="rml-add-rule-panel">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h2">
                        Add a rule
                      </Text>
                      <Button onClick={() => setShowAddForm(false)}>
                        Close
                      </Button>
                    </InlineStack>
                    <RuleEditor
                      rule={draftRule}
                      selectedProducts={selectedProducts}
                      onChange={(patch) =>
                        setDraftRule((current) =>
                          normalizeRule({ ...current, ...patch }),
                        )
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
              </div>
            ) : null}
          </BlockStack>
        </BlockStack>
      </Page>
    </>
  );
}

function ruleFieldCandidates(
  field: RuleField,
  selectedProducts: SelectedProductMap,
) {
  const products = Array.from(selectedProducts.values());

  switch (field) {
    case "collection":
      return uniqueSortedValues(
        products.flatMap((product) => product.collections),
      );
    case "vendor":
      return uniqueSortedValues(products.map((product) => product.vendor));
    case "productType":
      return uniqueSortedValues(products.map((product) => product.type));
    case "tag":
      return uniqueSortedValues(products.flatMap((product) => product.tags));
    case "sku":
      return uniqueSortedValues(products.map((product) => product.sku));
    case "titleHandle":
      return uniqueSortedValues(
        products.flatMap((product) => [product.name, product.handle]),
      );
    default:
      return [];
  }
}

function isMultiValueCondition(condition: string) {
  return [
    "in",
    "notIn",
    "hasAny",
    "hasAll",
    "contains",
    "notContains",
  ].includes(condition);
}

function shouldUseContextualValuePicker(field: RuleField) {
  return [
    "collection",
    "vendor",
    "productType",
    "tag",
    "sku",
    "titleHandle",
  ].includes(field);
}

function mergeSelectedValue(
  values: string[],
  value: string,
  allowMultiple: boolean,
) {
  const nextValue = value.trim();
  if (!nextValue) return values;
  if (!allowMultiple) return [nextValue];
  return uniqueSortedValues([...values, nextValue]);
}

function removeSelectedValue(values: string[], value: string) {
  return values.filter((item) => item !== value);
}

function getRuleMatchValueError(errors: string[]) {
  return errors.find(
    (error) =>
      error.includes("match value") ||
      error.includes("valid number") ||
      error.includes("two numbers"),
  );
}

function getRuleTargetValueError(errors: string[]) {
  return errors.find((error) => error.toLowerCase().includes("destination"));
}

function RuleValueInput({
  rule,
  selectedProducts,
  error,
  onChange,
}: {
  rule: RedirectRule;
  selectedProducts: SelectedProductMap;
  error?: string;
  onChange(patch: Partial<RedirectRule>): void;
}) {
  const fieldConfig = FIELD_CONFIG[rule.field];
  const valueDisabled = fieldConfig.valuesDisabled || isValueDisabled(rule);
  const allowMultiple = isMultiValueCondition(rule.condition);
  const candidates = useMemo(
    () => ruleFieldCandidates(rule.field, selectedProducts),
    [rule.field, selectedProducts],
  );
  const selectedValues = useMemo(
    () => splitRuleInputValues(rule.value),
    [rule.value],
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery(allowMultiple ? "" : rule.value);
  }, [allowMultiple, rule.field, rule.value]);

  if (fieldConfig.options) {
    return (
      <Select
        label="Value"
        options={fieldConfig.options}
        value={rule.value || fieldConfig.options[0].value}
        onChange={(value) => onChange({ value })}
        disabled={valueDisabled}
        helpText={fieldConfig.valueHelpText}
      />
    );
  }

  if (!shouldUseContextualValuePicker(rule.field)) {
    return (
      <TextField
        label="Value"
        value={rule.value}
        onChange={(value) => onChange({ value })}
        placeholder={fieldConfig.placeholder}
        disabled={valueDisabled}
        error={error}
        helpText={fieldConfig.valueHelpText}
        autoComplete="off"
      />
    );
  }

  if (valueDisabled) {
    return (
      <TextField
        label="Value"
        value=""
        onChange={() => {}}
        placeholder="No value needed"
        disabled
        helpText={fieldConfig.valueHelpText}
        autoComplete="off"
      />
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCandidates = candidates
    .filter((candidate) =>
      normalizedQuery
        ? candidate.toLowerCase().includes(normalizedQuery)
        : true,
    )
    .slice(0, 30);
  const optionValues = new Set(
    filteredCandidates.map((candidate) => candidate.toLowerCase()),
  );
  const preservedSelectedValues = selectedValues.filter(
    (value) => !optionValues.has(value.toLowerCase()),
  );
  const options = [...preservedSelectedValues, ...filteredCandidates].map(
    (value) => ({
      label: value,
      value,
    }),
  );
  const canUseTypedValue =
    Boolean(query.trim()) &&
    !selectedValues.some(
      (value) => value.toLowerCase() === query.trim().toLowerCase(),
    );

  const applyValues = (values: string[]) => {
    onChange({ value: compactValues(values) });
  };

  const handleSelect = (values: string[]) => {
    const nextValues = allowMultiple ? values : values.slice(-1);
    applyValues(nextValues);
    setQuery("");
  };

  const addTypedValue = () => {
    const nextValues = mergeSelectedValue(selectedValues, query, allowMultiple);
    applyValues(nextValues);
    setQuery("");
  };

  const emptyState = (
    <Box padding="300">
      <Text variant="bodySm" tone="subdued" as="p">
        {selectedProducts.size
          ? "No matching selected-product values. Use the typed value if it is intentional."
          : "Select products first to get contextual suggestions."}
      </Text>
    </Box>
  );

  const textField = (
    <Autocomplete.TextField
      label="Value"
      value={query}
      onChange={(value) => {
        setQuery(value);
        if (!allowMultiple) onChange({ value });
      }}
      placeholder={
        selectedProducts.size
          ? `Search ${getOptionLabel(RULE_FIELD_OPTIONS, rule.field).toLowerCase()} values`
          : fieldConfig.placeholder
      }
      prefix={<Icon source={SearchIcon} tone="base" />}
      clearButton
      onClearButtonClick={() => {
        setQuery("");
        if (!allowMultiple) onChange({ value: "" });
      }}
      error={error}
      autoComplete="off"
    />
  );

  return (
    <BlockStack gap="150">
      <Autocomplete
        options={options}
        selected={
          allowMultiple ? selectedValues : rule.value ? [rule.value] : []
        }
        textField={textField}
        allowMultiple={allowMultiple}
        emptyState={emptyState}
        actionBefore={
          canUseTypedValue
            ? {
                content: `Use "${query.trim()}"`,
                onAction: addTypedValue,
              }
            : undefined
        }
        onSelect={handleSelect}
      />
      {allowMultiple && selectedValues.length ? (
        <InlineStack gap="100" wrap>
          {selectedValues.map((value) => (
            <Tag
              key={value}
              onRemove={() =>
                applyValues(removeSelectedValue(selectedValues, value))
              }
            >
              {value}
            </Tag>
          ))}
        </InlineStack>
      ) : null}
      <Text variant="bodySm" tone="subdued" as="p">
        {candidates.length
          ? `${candidates.length} suggestions from selected products.`
          : fieldConfig.valueHelpText}
      </Text>
    </BlockStack>
  );
}

function RuleRedirectExampleView({
  example,
}: {
  example: RuleRedirectExample | null;
}) {
  return (
    <div className="rml-rule-example">
      <InlineStack gap="150" blockAlign="center">
        <span className="rml-rule-example__label">Example redirect</span>
        {example ? (
          <span
            className="rml-rule-example__product"
            title={example.productName}
          >
            {truncateProductTitle(example.productName, 42)}
          </span>
        ) : null}
      </InlineStack>
      {example ? (
        <div className="rml-rule-example__paths">
          <code>{example.source}</code>
          <span aria-hidden="true">→</span>
          <code>{example.target || "No redirect"}</code>
        </div>
      ) : (
        <Text variant="bodySm" tone="subdued" as="p">
          No selected product currently reaches this rule, so there is no
          redirect example yet.
        </Text>
      )}
    </div>
  );
}

function RuleFlowEditor({
  rule,
  selectedProducts,
  errors,
  redirectExample,
  onChange,
}: {
  rule: RedirectRule;
  selectedProducts: SelectedProductMap;
  errors: string[];
  redirectExample: RuleRedirectExample | null;
  onChange(patch: Partial<RedirectRule>): void;
}) {
  const fieldConfig = FIELD_CONFIG[rule.field];
  const targetConfig = TARGET_CONFIG[rule.target];
  const targetOptions = targetConfig.options ?? [];
  const targetOptionVisible = targetOptions.length > 1;
  const targetValueVisible = targetNeedsValue(rule.target, rule.targetOption);
  const targetGridClass =
    targetOptionVisible && targetValueVisible
      ? " rml-rule-editor-grid--target-value"
      : "";

  return (
    <div className="rml-rule-flow">
      <div className="rml-rule-panel rml-rule-panel--match">
        <div className="rml-rule-panel__header">
          <span className="rml-rule-panel__eyebrow">When</span>
          <Text variant="headingSm" as="h3">
            Product matches these conditions
          </Text>
        </div>
        <div className="rml-rule-editor-grid rml-rule-editor-grid--match">
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
          <RuleValueInput
            rule={rule}
            selectedProducts={selectedProducts}
            error={getRuleMatchValueError(errors)}
            onChange={onChange}
          />
        </div>
      </div>

      <div className="rml-rule-flow-arrow" aria-hidden="true">
        ↓
      </div>

      <div className="rml-rule-panel rml-rule-panel--redirect">
        <div className="rml-rule-panel__header">
          <span className="rml-rule-panel__eyebrow">Then</span>
          <Text variant="headingSm" as="h3">
            Redirect shoppers to the best destination
          </Text>
        </div>
        <div className={`rml-rule-editor-grid${targetGridClass}`}>
          <Select
            label="Redirect to"
            options={RULE_TARGET_OPTIONS}
            value={rule.target}
            onChange={(value) => {
              const nextTarget = value as RuleTarget;
              const nextTargetOption =
                TARGET_CONFIG[nextTarget].options?.[0]?.value ?? "";
              const nextTargetValue = targetNeedsValue(
                nextTarget,
                nextTargetOption,
              )
                ? defaultTargetValueForOption(nextTarget, nextTargetOption)
                : "";

              onChange({
                target: nextTarget,
                targetOption: nextTargetOption,
                targetValue: nextTargetValue,
              });
            }}
            helpText={targetConfig.helpText}
          />
          {targetOptionVisible ? (
            <Select
              label={targetConfig.optionLabel}
              options={targetOptions}
              value={rule.targetOption || targetOptions[0]?.value}
              onChange={(value) => {
                const nextNeedsTargetValue = targetNeedsValue(
                  rule.target,
                  value,
                );
                const nextTargetValue =
                  nextNeedsTargetValue &&
                  targetValueFitsOption(rule.target, value, rule.targetValue)
                    ? rule.targetValue
                    : defaultTargetValueForOption(rule.target, value);

                onChange({
                  targetOption: value,
                  targetValue: nextNeedsTargetValue ? nextTargetValue : "",
                });
              }}
              helpText={targetConfig.optionHelpText}
            />
          ) : null}
          {targetValueVisible ? (
            <BlockStack gap="150">
              <TextField
                label={targetValueLabel(rule)}
                value={rule.targetValue}
                onChange={(value) => onChange({ targetValue: value })}
                placeholder={targetValuePlaceholder(rule)}
                error={getRuleTargetValueError(errors)}
                helpText={targetValueHelpText(rule)}
                autoComplete="off"
              />
              <RedirectVariableHelp visible={targetSupportsVariables(rule)} />
            </BlockStack>
          ) : null}
        </div>
        <RuleRedirectExampleView example={redirectExample} />
      </div>
    </div>
  );
}

function RuleEditor({
  rule,
  selectedProducts,
  onChange,
}: {
  rule: RedirectRule;
  selectedProducts: SelectedProductMap;
  onChange(patch: Partial<RedirectRule>): void;
}) {
  const errors = getRuleErrors(rule);
  const redirectExample = firstDirectRuleExample(rule, selectedProducts);

  return (
    <BlockStack gap="400">
      <RuleFlowEditor
        rule={rule}
        selectedProducts={selectedProducts}
        errors={errors}
        redirectExample={redirectExample}
        onChange={onChange}
      />

      <InlineStack gap="400" blockAlign="center">
        <Checkbox
          label="Enable this rule immediately"
          checked={rule.enabled}
          onChange={(checked) => onChange({ enabled: checked })}
        />
      </InlineStack>
    </BlockStack>
  );
}

function normalizeRule(rule: RedirectRule): RedirectRule {
  const normalizedTargetRule = normalizeRuleTarget(rule);
  const fieldConfig = FIELD_CONFIG[normalizedTargetRule.field];
  const condition = fieldConfig.conditions.some(
    (option) => option.value === normalizedTargetRule.condition,
  )
    ? normalizedTargetRule.condition
    : fieldConfig.conditions[0].value;
  const value =
    fieldConfig.valuesDisabled ||
    isValueDisabled({ ...normalizedTargetRule, condition })
      ? ""
      : fieldConfig.options &&
          !fieldConfig.options.some(
            (option) => option.value === normalizedTargetRule.value,
          )
        ? fieldConfig.options[0].value
        : normalizedTargetRule.value;

  const targetOptions =
    TARGET_CONFIG[normalizedTargetRule.target].options ?? [];
  const targetOption = targetOptions.some(
    (option) => option.value === normalizedTargetRule.targetOption,
  )
    ? normalizedTargetRule.targetOption
    : (targetOptions[0]?.value ?? "");
  const needsTargetValue = targetNeedsValue(
    normalizedTargetRule.target,
    targetOption,
  );

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

  const needsTargetValue = targetNeedsValue(rule.target, rule.targetOption);
  const targetValue = rule.targetValue.trim();

  if (needsTargetValue && !targetValue) {
    errors.push(
      rule.target === "searchResults"
        ? "Enter a custom search destination."
        : "Enter a destination.",
    );
  }

  if (
    needsTargetValue &&
    targetValue &&
    rule.target !== "searchResults" &&
    rule.target === "customPath" &&
    rule.targetOption === "externalUrl" &&
    !isExternalRedirectDestination(targetValue)
  ) {
    errors.push("External destinations must start with http:// or https://.");
  }

  if (
    needsTargetValue &&
    targetValue &&
    rule.target !== "searchResults" &&
    !(rule.target === "customPath" && rule.targetOption === "externalUrl") &&
    !targetValue.startsWith("/")
  ) {
    errors.push("Storefront destination paths must start with /.");
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
    return (
      values.length === 2 &&
      values.every((item) => Number.isFinite(Number(item)))
    );
  }

  return values.length === 1 && Number.isFinite(Number(values[0]));
}

function getOptionLabel<T extends string>(
  options: { label: string; value: T }[],
  value: T,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function normalizeRuleTarget(rule: RedirectRule): RedirectRule {
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

  if (
    rule.target === "searchResults" &&
    rule.targetOption === "titleKeywords"
  ) {
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

function slugifyPathPart(value: string) {
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

function isValidRedirectDestination(value: string) {
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    (trimmed.startsWith("/") || isExternalRedirectDestination(trimmed))
  );
}

function normalizeGeneratedDestination(
  value: string,
  fallback = "/collections/all",
) {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (isExternalRedirectDestination(trimmed)) return trimmed;

  return (trimmed.startsWith("/") ? trimmed : `/${trimmed}`).replace(
    /\/{2,}/g,
    "/",
  );
}

function firstRuleValue(rule: RedirectRule) {
  return splitRuleInputValues(rule.value)[0] ?? "";
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

function targetVariableValues(
  product: ProductRow,
  rule: RedirectRule,
  { slugValues = true }: { slugValues?: boolean } = {},
) {
  const firstCollection = product.collections[0] ?? "";
  const lastCollection = product.collections.at(-1) ?? "";
  const matchedCollection =
    matchedCollectionForRule(product, rule) || firstCollection;
  const firstTag = product.tags[0] ?? "";
  const matchedTag =
    matchedTagForRule(product, rule) || firstRuleValue(rule) || firstTag;
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
      return (
        matchedCollectionForRule(product, rule) || product.collections[0] || ""
      );
    case "firstCollection":
    default:
      return product.collections[0] ?? "";
  }
}

function tagForRuleTarget(product: ProductRow, rule: RedirectRule) {
  switch (rule.targetOption) {
    case "matchedTagHandle":
      return (
        matchedTagForRule(product, rule) ||
        firstRuleValue(rule) ||
        product.tags[0] ||
        ""
      );
    case "firstProductTag":
      return product.tags[0] ?? "";
    case "tagHandle":
    default:
      return (
        firstRuleValue(rule) ||
        matchedTagForRule(product, rule) ||
        product.tags[0] ||
        ""
      );
  }
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
  return isValidRedirectDestination(value);
}

function reviewRowSort(a: GeneratedPreviewRow, b: GeneratedPreviewRow) {
  const confidenceDelta =
    REVIEW_CONFIDENCE_ORDER.indexOf(a.confidence) -
    REVIEW_CONFIDENCE_ORDER.indexOf(b.confidence);

  return confidenceDelta || a.name.localeCompare(b.name);
}

function exportRedirectsCsv(
  rows: GeneratedPreviewRow[],
  filename = "redirects.csv",
) {
  const header = [
    "Redirect from",
    "Redirect to",
    "Product",
    "Rule",
    "Confidence",
  ];
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

function tagRuleMatches(
  values: string[],
  productTags: string[],
  condition: string,
) {
  if (condition === "empty") return productTags.length === 0;

  const normalizedTags = productTags.map((tag) => tag.toLowerCase());
  if (condition === "hasAll") {
    return values.every((value) => normalizedTags.some((tag) => tag === value));
  }
  if (condition === "hasAny") {
    return values.some((value) => normalizedTags.some((tag) => tag === value));
  }
  if (condition === "notIn") {
    return values.every((value) =>
      normalizedTags.every((tag) => tag !== value),
    );
  }
  if (condition === "contains") {
    return values.some((value) =>
      normalizedTags.some((tag) => tag.includes(value)),
    );
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
  const createdAt = product.createdAt
    ? new Date(product.createdAt).getTime()
    : null;
  const updatedAt = product.updatedAt
    ? new Date(product.updatedAt).getTime()
    : null;

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
      return numericConditionMatches(
        product.inventory,
        rule.value,
        rule.condition,
      );
    case "sku":
      if (rule.condition === "empty") return !product.sku;
      return valueMatches(values, product.sku, rule.condition);
    case "titleHandle":
      return valueMatches(
        values,
        `${product.name} ${product.handle}`,
        rule.condition,
      );
    case "tag":
      return tagRuleMatches(values, product.tags, rule.condition);
    case "age":
      return ageRuleMatches(product, rule.value, rule.condition);
    case "price":
      return false;
  }
}

function numericConditionMatches(
  actual: number,
  value: string,
  condition: string,
) {
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
      return (
        numbers.length >= 2 && actual >= numbers[0] && actual <= numbers[1]
      );
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
    case "sameCollection": {
      const collection = collectionForRuleTarget(product, rule);
      return collection
        ? `/collections/${slugifyPathPart(collection)}`
        : "/collections/all";
    }
    case "bestSiblingProduct":
      if (
        rule.targetOption === "vendorType" &&
        product.vendor &&
        product.type
      ) {
        return `/search?q=${encodeURIComponent(`${product.vendor} ${product.type}`)}`;
      }
      if (rule.targetOption === "typeCollection" && product.type) {
        return `/collections/${slugifyPathPart(product.type)}`;
      }
      if (product.collections[0]) {
        return `/collections/${slugifyPathPart(product.collections[0])}`;
      }
      return product.type
        ? `/collections/${slugifyPathPart(product.type)}`
        : "/collections/all";
    case "productTypeCollection":
      if (rule.targetOption === "customPattern") {
        return destinationFromPattern(
          rule.targetValue || "/collections/{productType}",
          product,
          rule,
        );
      }
      return product.type
        ? `/collections/${slugifyPathPart(product.type)}`
        : "/collections/all";
    case "vendorCollection":
      if (rule.targetOption === "customPattern") {
        return destinationFromPattern(
          rule.targetValue || "/collections/{vendor}",
          product,
          rule,
        );
      }
      return product.vendor
        ? `/collections/${slugifyPathPart(product.vendor)}`
        : "/collections/all";
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
          searchQuery = interpolateTargetTemplate(
            rule.targetValue,
            product,
            rule,
            {
              slugValues: false,
            },
          );
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
      if (rule.targetOption === "searchAll") return "/search";
      if (rule.targetOption === "customCatalogPath") {
        return destinationFromPattern(
          rule.targetValue || "/collections/all",
          product,
          rule,
        );
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

function firstDirectRuleExample(
  rule: RedirectRule,
  selectedProducts: SelectedProductMap,
) {
  const product = Array.from(selectedProducts.values()).find((item) =>
    ruleMatchesProduct(rule, item),
  );

  return product ? redirectExampleForProduct(product, rule) : null;
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
  const exactRuleConditions = [
    "in",
    "hasAny",
    "hasAll",
    "equals",
    "zero",
    "anything",
  ];
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
      score += isValidRedirectDestination(rule.targetValue) ? 4 : -8;
      break;
    case "allProducts":
      score -= 22;
      break;
    case "homepage":
      score -= 30;
      break;
  }

  if (rule.field === "fallback" && rule.target === "allProducts")
    score = Math.min(score, 42);
  if (rule.target === "homepage") score = Math.min(score, 35);
  if (
    rule.target === "sameCollection" &&
    hasCollection &&
    rule.field === "collection"
  ) {
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
      status: product.status,
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
  const [customTargetEditor, setCustomTargetEditor] = useState<{
    rowId: string;
    value: string;
  } | null>(null);
  const [lowConfidenceModalOpen, setLowConfidenceModalOpen] = useState(false);
  const [brokenTargetFixModalOpen, setBrokenTargetFixModalOpen] =
    useState(false);
  const [brokenTargetFixChoice, setBrokenTargetFixChoice] =
    useState<BrokenTargetFixChoice>("allProducts");
  const [brokenTargetFixCustomPath, setBrokenTargetFixCustomPath] =
    useState("");
  const [targetValidationByTarget, setTargetValidationByTarget] = useState<
    Record<string, TargetValidationResult>
  >({});
  const targetValidationByTargetRef = useRef<
    Record<string, TargetValidationResult>
  >({});
  const [sourceValidationBySource, setSourceValidationBySource] = useState<
    Record<string, SourceValidationResult>
  >({});
  const sourceValidationBySourceRef = useRef<
    Record<string, SourceValidationResult>
  >({});
  const [targetValidationLoading, setTargetValidationLoading] = useState(false);
  const [targetValidationPendingCount, setTargetValidationPendingCount] =
    useState(0);
  const [targetValidationError, setTargetValidationError] = useState<
    string | null
  >(null);

  useEffect(() => {
    targetValidationByTargetRef.current = targetValidationByTarget;
  }, [targetValidationByTarget]);

  useEffect(() => {
    sourceValidationBySourceRef.current = sourceValidationBySource;
  }, [sourceValidationBySource]);

  useEffect(() => {
    const rowIdentity = (row: GeneratedPreviewRow) =>
      `${row.id}:${row.originalTo}:${row.via}`;
    const currentSignature = rows.map(rowIdentity).join("|");
    const nextSignature = generatedRows.map(rowIdentity).join("|");

    if (currentSignature !== nextSignature) {
      setRows(generatedRows);
      setCustomTargetEditor(null);
      setOpenTargetMenuId(null);
    }
  }, [generatedRows, rows, setRows]);

  const validationTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const row of rows) {
      const target = row.to.trim();
      if (
        row.targetChoice !== "skip" &&
        target &&
        isPreviewDestinationValid(row)
      ) {
        targets.add(target);
      }
    }
    return Array.from(targets).sort();
  }, [rows]);
  const validationSources = useMemo(() => {
    const sources = new Set<string>();
    for (const row of rows) {
      if (row.targetChoice !== "skip" && row.from.trim()) {
        sources.add(normalizePreviewPath(row.from));
      }
    }
    return Array.from(sources).sort();
  }, [rows]);
  const validationSignature = JSON.stringify({
    targets: validationTargets,
    sources: validationSources,
  });

  useEffect(() => {
    if (!validationTargets.length && !validationSources.length) {
      setTargetValidationByTarget({});
      targetValidationByTargetRef.current = {};
      setSourceValidationBySource({});
      sourceValidationBySourceRef.current = {};
      setTargetValidationLoading(false);
      setTargetValidationPendingCount(0);
      setTargetValidationError(null);
      return;
    }

    const controller = new AbortController();
    const targets = validationTargets;
    const sources = validationSources;
    let cachedValidationByTarget = targetValidationByTargetRef.current;
    const cachedSourceValidationBySource = sourceValidationBySourceRef.current;
    const skippedValidationByTarget = Object.fromEntries(
      targets
        .map((target) => skippedPreviewTargetValidation(target))
        .filter((result): result is TargetValidationResult => Boolean(result))
        .filter((result) => !cachedValidationByTarget[result.target])
        .map((result) => [result.target, result]),
    );

    if (Object.keys(skippedValidationByTarget).length) {
      cachedValidationByTarget = {
        ...cachedValidationByTarget,
        ...skippedValidationByTarget,
      };
      targetValidationByTargetRef.current = cachedValidationByTarget;
      setTargetValidationByTarget(cachedValidationByTarget);
    }

    const targetsToValidate = targets.filter(
      (target) => !cachedValidationByTarget[target],
    );
    const sourcesToValidate = sources.filter(
      (source) => !cachedSourceValidationBySource[source],
    );

    if (!targetsToValidate.length && !sourcesToValidate.length) {
      setTargetValidationLoading(false);
      setTargetValidationPendingCount(0);
      setTargetValidationError(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      setTargetValidationLoading(true);
      setTargetValidationPendingCount(
        targetsToValidate.length + sourcesToValidate.length,
      );
      setTargetValidationError(null);

      fetch("/app/validate-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: targetsToValidate,
          sources: sourcesToValidate,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              `Validation request failed with ${response.status}`,
            );
          }
          return (await response.json()) as TargetValidationResponse;
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          const validationByTarget = Object.fromEntries(
            (data.results ?? []).map((result) => [result.target, result]),
          );
          const validationBySource = Object.fromEntries(
            (data.sources ?? []).map((result) => [
              normalizePreviewPath(result.source),
              result,
            ]),
          );
          setTargetValidationByTarget((prev) => {
            const next = { ...prev, ...validationByTarget };
            targetValidationByTargetRef.current = next;
            return next;
          });
          setSourceValidationBySource((prev) => {
            const next = { ...prev, ...validationBySource };
            sourceValidationBySourceRef.current = next;
            return next;
          });
          setRows((prev) => {
            let changed = false;
            const nextRows = prev.map((row) => {
              if (
                validationByTarget[row.to.trim()]?.status === "invalid" &&
                row.confidence !== "Low"
              ) {
                changed = true;
                return {
                  ...row,
                  confidence: "Low" as const,
                  tone: "warning" as const,
                };
              }
              return row;
            });
            return changed ? nextRows : prev;
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setTargetValidationError(
            error instanceof Error
              ? error.message
              : "Target validation failed.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setTargetValidationLoading(false);
            setTargetValidationPendingCount(0);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [setRows, validationSignature, validationSources, validationTargets]);

  useEffect(() => {
    if (!validationTargets.length) return;

    setRows((prev) => {
      let changed = false;
      const nextRows = prev.map((row) => {
        if (
          row.targetChoice !== "skip" &&
          targetValidationByTarget[row.to.trim()]?.status === "invalid" &&
          row.confidence !== "Low"
        ) {
          changed = true;
          return {
            ...row,
            confidence: "Low" as const,
            tone: "warning" as const,
          };
        }
        return row;
      });
      return changed ? nextRows : prev;
    });
  }, [setRows, targetValidationByTarget, validationTargets.length]);

  const duplicateSourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      if (row.targetChoice === "skip") return;
      const source = normalizePreviewPath(row.from);
      counts.set(source, (counts.get(source) ?? 0) + 1);
    });
    return counts;
  }, [rows]);
  const retiredProductPaths = useMemo(
    () =>
      new Set(
        Array.from(selectedProducts.values())
          .map((product) => normalizePreviewPath(`/products/${product.handle}`))
          .filter(Boolean),
      ),
    [selectedProducts],
  );
  const reviewStateByRowId = useMemo(() => {
    const states = new Map<string, RedirectReviewState>();
    rows.forEach((row) => {
      const source = normalizePreviewPath(row.from);
      states.set(
        row.id,
        reviewStateForRow({
          row,
          duplicateSourceCount: duplicateSourceCounts.get(source) ?? 0,
          sourceValidation: sourceValidationBySource[source],
          targetValidation: targetValidationByTarget[row.to.trim()],
          retiredProductPaths,
        }),
      );
    });
    return states;
  }, [
    duplicateSourceCounts,
    retiredProductPaths,
    rows,
    sourceValidationBySource,
    targetValidationByTarget,
  ]);
  const getReviewState = (row: GeneratedPreviewRow) =>
    reviewStateByRowId.get(row.id) ?? {
      status: "needsReview" as const,
      label: "Needs review",
      tone: "warning" as const,
      explanation: "Review this redirect before applying.",
    };

  const filteredRows = rows.filter((row) => {
    const matchesConfidence =
      confidenceFilter === "All" || row.confidence === confidenceFilter;
    const matchesRule = ruleFilter === "All" || row.via === ruleFilter;
    return matchesConfidence && matchesRule;
  });
  const visibleAttentionRows = filteredRows
    .filter((row) => {
      const status = getReviewState(row).status;
      return ["lowConfidence", "needsReview", "invalid", "conflict"].includes(
        status,
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const visibleReadyRows = filteredRows
    .filter((row) => !visibleAttentionRows.includes(row))
    .sort(reviewRowSort);

  const rowsByStatus = rows.reduce((counts, row) => {
    const status = getReviewState(row).status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
    return counts;
  }, new Map<RedirectReviewStatus, number>());
  const readyCount =
    (rowsByStatus.get("ready") ?? 0) + (rowsByStatus.get("edited") ?? 0);
  const needsReviewCount =
    (rowsByStatus.get("lowConfidence") ?? 0) +
    (rowsByStatus.get("needsReview") ?? 0);
  const conflictCount = rowsByStatus.get("conflict") ?? 0;
  const invalidStatusCount = rowsByStatus.get("invalid") ?? 0;
  const applicableRows = rows.filter((row) => {
    const status = getReviewState(row).status;
    return (
      row.targetChoice !== "skip" &&
      isPreviewDestinationValid(row) &&
      status !== "invalid" &&
      status !== "conflict"
    );
  });
  const selectedApplicableCount = applicableRows.length;
  const selectedInvalidCount = invalidStatusCount;

  const updatePreviewRow = (
    id: string,
    patch: Partial<Pick<PreviewRedirectRow, "targetChoice" | "customTarget">>,
  ) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        const to = getPreviewDestination(next, next.targetChoice);
        return {
          ...next,
          to,
          confidence: "High",
          tone: "success",
          edited: true,
        };
      }),
    );
  };

  const openCustomTargetEditor = (row: GeneratedPreviewRow) => {
    setCustomTargetEditor({
      rowId: row.id,
      value: row.targetChoice === "custom" ? row.customTarget : "",
    });
    setOpenTargetMenuId(null);
  };

  const updateCustomTargetDraft = (row: GeneratedPreviewRow, value: string) => {
    setCustomTargetEditor({
      rowId: row.id,
      value,
    });
  };

  const cancelCustomTargetEditor = (rowId: string) => {
    setCustomTargetEditor((current) =>
      current?.rowId === rowId ? null : current,
    );
  };

  const applyCustomTargetEditor = (rowId: string) => {
    if (customTargetEditor?.rowId !== rowId) return;
    const value = customTargetEditor.value.trim();
    if (!isValidRedirectDestination(value)) return;

    updatePreviewRow(rowId, {
      targetChoice: "custom",
      customTarget: value,
    });
    setCustomTargetEditor(null);
  };

  const approvePreviewRow = (id: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const state = getReviewState(row);
        if (state.status === "invalid" || state.status === "conflict") {
          return {
            ...row,
            confidence: "Low" as const,
            tone: "warning" as const,
            edited: true,
          };
        }
        return {
          ...row,
          confidence: "High" as const,
          tone: "success" as const,
          edited: true,
        };
      }),
    );
  };

  const approveAllReviewableRows = () => {
    setRows((prev) =>
      prev.map((row) => {
        const state = getReviewState(row);
        if (
          state.status !== "lowConfidence" &&
          state.status !== "needsReview"
        ) {
          return row;
        }
        return {
          ...row,
          confidence: "High" as const,
          tone: "success" as const,
          edited: true,
        };
      }),
    );
  };

  const highCount = rows.filter((r) => r.confidence === "High").length;
  const mediumCount = rows.filter((r) => r.confidence === "Medium").length;
  const lowCount = rows.filter((r) => r.confidence === "Low").length;
  const editedCount = rows.filter((r) => r.edited).length;
  const skippedCount = rows.filter((r) => r.targetChoice === "skip").length;
  const invalidCount = selectedInvalidCount;
  const lowConfidenceRedirectCount = rows.filter((row) => {
    const status = getReviewState(row).status;
    return status === "lowConfidence" || status === "needsReview";
  }).length;
  const brokenTargetResults = Object.values(targetValidationByTarget).filter(
    (result) => result.status === "invalid",
  );
  const brokenTargetRows = rows.filter(
    (row) => targetValidationByTarget[row.to.trim()]?.status === "invalid",
  );
  const brokenTargetRowCount = brokenTargetRows.length;
  const brokenTargetGroups = Array.from(
    brokenTargetRows.reduce((groups, row) => {
      const target = row.to.trim();
      const validation = targetValidationByTarget[target];
      if (!validation) return groups;
      const current = groups.get(target) ?? {
        target,
        reason: validation.reason,
        resourceType: validation.resourceType,
        rows: [] as GeneratedPreviewRow[],
      };
      current.rows.push(row);
      groups.set(target, current);
      return groups;
    }, new Map<string, { target: string; reason: string; resourceType: string; rows: GeneratedPreviewRow[] }>()),
  ).map(([, group]) => group);
  const brokenTargetFixDestination =
    brokenTargetFixChoice === "allProducts"
      ? "/collections/all"
      : brokenTargetFixChoice === "homepage"
        ? "/"
        : brokenTargetFixCustomPath.trim();
  const brokenTargetFixInvalid =
    brokenTargetFixChoice === "custom" &&
    !isValidRedirectDestination(brokenTargetFixCustomPath.trim());

  const fixBrokenTargets = () => {
    if (!brokenTargetRows.length || brokenTargetFixInvalid) return;

    const fixedTargetChoice: PreviewTargetChoice =
      brokenTargetFixChoice === "custom" ? "custom" : brokenTargetFixChoice;
    const brokenTargets = new Set(brokenTargetRows.map((row) => row.to.trim()));
    setRows((prev) =>
      prev.map((row) => {
        if (!brokenTargets.has(row.to.trim())) return row;
        return {
          ...row,
          to: brokenTargetFixDestination,
          targetChoice: fixedTargetChoice,
          customTarget:
            fixedTargetChoice === "custom" ? brokenTargetFixDestination : "",
          confidence: "High" as const,
          tone: "success" as const,
          edited: true,
        };
      }),
    );
    setBrokenTargetFixModalOpen(false);
    setConfidenceFilter("All");
    setRuleFilter("All");
  };

  const handleApplyRedirects = () => {
    if (selectedInvalidCount > 0 || conflictCount > 0) {
      return;
    }

    if (lowConfidenceRedirectCount > 0) {
      setLowConfidenceModalOpen(true);
      return;
    }

    onNext();
  };

  const confirmLowConfidenceRedirects = () => {
    approveAllReviewableRows();
    setLowConfidenceModalOpen(false);
    onNext();
  };

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

  const renderRedirectCard = (row: GeneratedPreviewRow) => {
    const reviewState = getReviewState(row);
    const targetIsInvalid =
      !isPreviewDestinationValid(row) || reviewState.status === "invalid";
    const targetValidation = targetValidationByTarget[row.to.trim()];
    const targetMay404 = targetValidation?.status === "invalid";
    const lowConfidence =
      reviewState.status === "lowConfidence" ||
      reviewState.status === "needsReview" ||
      targetMay404;
    const hasConflict = reviewState.status === "conflict";
    const displayedConfidence = targetMay404 ? "Low" : row.confidence;
    const displayedTone = targetMay404 ? "warning" : row.tone;
    const customTargetDraft =
      customTargetEditor?.rowId === row.id
        ? customTargetEditor.value
        : row.customTarget;
    const isEditingCustomTarget = customTargetEditor?.rowId === row.id;
    const showCustomTargetEditor =
      row.targetChoice === "custom" || isEditingCustomTarget;
    const customTargetDraftInvalid = Boolean(
      isEditingCustomTarget &&
      customTargetDraft.trim() &&
      !isValidRedirectDestination(customTargetDraft.trim()),
    );
    const customTargetCanApply = Boolean(
      isEditingCustomTarget &&
      isValidRedirectDestination(customTargetDraft.trim()),
    );

    return (
      <div
        key={row.id}
        className={`rml-review-card${
          lowConfidence ? " rml-review-card--low" : ""
        }${targetIsInvalid || targetMay404 ? " rml-review-card--invalid" : ""}${
          hasConflict ? " rml-review-card--conflict" : ""
        }`}
      >
        <div className="rml-review-card__media">
          <Thumbnail
            size="large"
            source={row.imageUrl || "/favicon.ico"}
            alt={row.imageAlt || row.name}
          />
        </div>
        <div className="rml-review-card__main">
          <div className="rml-review-card__header">
            <BlockStack gap="050">
              <Text variant="headingSm" as="h3">
                {truncateProductTitle(row.name, 72)}
              </Text>
            </BlockStack>
            <InlineStack gap="100" blockAlign="center">
              <Badge
                tone={
                  row.via === "Collection"
                    ? "info"
                    : row.via === "Vendor"
                      ? "new"
                      : "warning"
                }
              >
                {row.via}
              </Badge>
              <Badge tone={displayedTone}>{displayedConfidence}</Badge>
              <Badge tone={reviewState.tone}>{reviewState.label}</Badge>
              {row.targetChoice === "skip" ? (
                <Badge>Skipped</Badge>
              ) : row.edited ? (
                <Badge tone="info">Reviewed</Badge>
              ) : null}
            </InlineStack>
          </div>

          <div className="rml-review-flow">
            <div className="rml-review-flow__side">
              <span className="rml-review-flow__label">From</span>
              <span className="rml-review-flow__value">{row.from}</span>
            </div>
            <span className="rml-review-flow__arrow" aria-hidden="true">
              ↓
            </span>
            <div className="rml-review-flow__side rml-review-flow__side--target">
              <div className="rml-review-flow__target-copy">
                <span className="rml-review-flow__label">Redirect to</span>
                {showCustomTargetEditor ? (
                  <BlockStack gap="150">
                    <TextField
                      label="Custom target"
                      labelHidden
                      value={customTargetDraft}
                      onFocus={() => {
                        if (!isEditingCustomTarget) {
                          updateCustomTargetDraft(row, row.customTarget);
                        }
                      }}
                      onChange={(value) => updateCustomTargetDraft(row, value)}
                      placeholder="/collections/sale"
                      error={
                        isEditingCustomTarget
                          ? customTargetDraftInvalid
                            ? "Use a /path or full https:// destination."
                            : undefined
                          : targetIsInvalid
                            ? "Use a /path destination"
                            : targetMay404
                              ? targetValidation.reason
                              : undefined
                      }
                      autoComplete="off"
                    />
                    {isEditingCustomTarget ? (
                      <InlineStack gap="150" align="end">
                        <Button
                          size="slim"
                          onClick={() => cancelCustomTargetEditor(row.id)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="slim"
                          variant="primary"
                          disabled={!customTargetCanApply}
                          onClick={() => applyCustomTargetEditor(row.id)}
                        >
                          OK
                        </Button>
                      </InlineStack>
                    ) : null}
                  </BlockStack>
                ) : (
                  <span
                    className={`rml-review-flow__value${
                      row.targetChoice === "skip"
                        ? " rml-review-flow__value--muted"
                        : ""
                    }`}
                  >
                    {row.targetChoice === "skip"
                      ? "No redirect will be created"
                      : row.to}
                  </span>
                )}
              </div>
              <div className="rml-review-card__target-actions">
                <Popover
                  active={openTargetMenuId === row.id}
                  activator={
                    <Tooltip content="Change the redirect target for this product">
                      <Button
                        icon={TargetIcon}
                        size="slim"
                        onClick={() =>
                          setOpenTargetMenuId((current) =>
                            current === row.id ? null : row.id,
                          )
                        }
                        accessibilityLabel={`Change redirect target for ${row.name}`}
                      />
                    </Tooltip>
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
                        if (option.value === "custom") {
                          openCustomTargetEditor(row);
                          return;
                        }
                        updatePreviewRow(row.id, {
                          targetChoice: option.value,
                        });
                        cancelCustomTargetEditor(row.id);
                        setOpenTargetMenuId(null);
                      },
                    }))}
                  />
                </Popover>
                {lowConfidence && !targetMay404 ? (
                  <Tooltip content="Approve this redirect and mark it as reviewed">
                    <Button
                      icon={CheckIcon}
                      size="slim"
                      variant="primary"
                      onClick={() => approvePreviewRow(row.id)}
                      accessibilityLabel={`Approve redirect for ${row.name}`}
                    />
                  </Tooltip>
                ) : !row.edited &&
                  row.targetChoice !== "skip" &&
                  reviewState.status !== "invalid" &&
                  reviewState.status !== "conflict" ? (
                  <Tooltip content="Approve this redirect">
                    <Button
                      icon={CheckIcon}
                      size="slim"
                      onClick={() => approvePreviewRow(row.id)}
                      accessibilityLabel={`Approve redirect for ${row.name}`}
                    />
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </div>

          <InlineStack gap="100" blockAlign="center">
            <Text variant="bodySm" tone="subdued" as="span">
              Rule applied:
            </Text>
            <Badge tone={row.via === "Fallback" ? "warning" : "info"}>
              {row.via}
            </Badge>
            {targetIsInvalid ? (
              <Badge tone="critical">Invalid target</Badge>
            ) : null}
            {targetMay404 ? (
              <Tooltip content={targetValidation.reason}>
                <span className="rml-review-target-warning">
                  <Icon source={AlertTriangleIcon} />
                  <Badge tone="critical">Destination may 404</Badge>
                </span>
              </Tooltip>
            ) : null}
            {hasConflict ? (
              <span className="rml-review-target-warning">
                <Icon source={AlertTriangleIcon} />
                <Badge tone="critical">Conflict</Badge>
              </span>
            ) : null}
            <Text variant="bodySm" tone="subdued" as="span">
              {reviewState.explanation}
            </Text>
          </InlineStack>
        </div>
      </div>
    );
  };

  return (
    <>
      <WizardProgressNav
        currentStep="preview"
        onBack={onBack}
        onNext={handleApplyRedirects}
        nextDisabled={
          selectedApplicableCount === 0 ||
          selectedInvalidCount > 0 ||
          conflictCount > 0
        }
        backLabel="Back to rules"
        nextLabel="Continue to apply"
      />
      <Page
        title="Review redirects"
        subtitle={`${readyCount} ready · ${needsReviewCount} need review · ${conflictCount} conflicts · ${selectedInvalidCount} invalid`}
      >
        <>
          <BlockStack gap="400">
            {targetValidationLoading ? (
              <Banner tone="info" title="Checking redirect destinations">
                <BlockStack gap="200">
                  <Text variant="bodyMd" as="p">
                    Validating{" "}
                    {targetValidationPendingCount || validationTargets.length}{" "}
                    redirect destination and source path check
                    {(targetValidationPendingCount ||
                      validationTargets.length) === 1
                      ? ""
                      : "s"}{" "}
                    so redirects do not send shoppers from one broken page to
                    another.
                  </Text>
                  <div
                    className="rml-target-validation-progress"
                    role="progressbar"
                    aria-label="Validating redirect destination URLs"
                    aria-valuetext="Checking redirect destinations"
                  >
                    <span />
                  </div>
                </BlockStack>
              </Banner>
            ) : null}

            {targetValidationError ? (
              <Banner
                tone="warning"
                title="Redirect destination validation could not complete"
              >
                {targetValidationError}
              </Banner>
            ) : null}

            {brokenTargetGroups.length > 0 ? (
              <div className="rml-broken-target-panel">
                <div className="rml-broken-target-panel__icon">
                  <Icon source={AlertTriangleIcon} />
                </div>
                <div className="rml-broken-target-panel__body">
                  <InlineStack
                    gap="200"
                    align="space-between"
                    blockAlign="start"
                  >
                    <BlockStack gap="150">
                      <Text variant="headingMd" as="h2">
                        {brokenTargetRowCount} redirect
                        {brokenTargetRowCount === 1 ? "" : "s"} may send
                        shoppers to a 404
                      </Text>
                      <Text variant="bodyMd" as="p">
                        These products are already marked as low confidence. Fix
                        the destinations before applying so retired product URLs
                        do not redirect into another broken page.
                      </Text>
                    </BlockStack>
                    <Button
                      icon={TargetIcon}
                      tone="critical"
                      variant="primary"
                      onClick={() => setBrokenTargetFixModalOpen(true)}
                    >
                      Auto fix
                    </Button>
                  </InlineStack>
                  <div className="rml-broken-target-panel__list">
                    {brokenTargetGroups.slice(0, 6).map((group) => (
                      <div
                        className="rml-broken-target-item"
                        key={group.target}
                      >
                        <div className="rml-broken-target-item__url">
                          {group.target}
                        </div>
                        <div className="rml-broken-target-item__meta">
                          <Badge tone="critical">
                            {`${group.rows.length} product${group.rows.length === 1 ? "" : "s"}`}
                          </Badge>
                          <span>{group.reason}</span>
                        </div>
                      </div>
                    ))}
                    {brokenTargetGroups.length > 6 ? (
                      <Text variant="bodySm" tone="subdued" as="p">
                        Showing 6 of {brokenTargetResults.length} unique broken
                        destinations.
                      </Text>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {invalidCount > 0 ? (
              <Banner
                tone="critical"
                title={`${invalidCount} redirect${invalidCount === 1 ? "" : "s"} need a valid destination`}
              >
                Fix invalid paths, circular redirects, missing destinations, or
                redirects into products being retired before continuing.
              </Banner>
            ) : null}

            {conflictCount > 0 ? (
              <Banner
                tone="critical"
                title={`${conflictCount} redirect conflict${conflictCount === 1 ? "" : "s"}`}
              >
                Resolve duplicate source URLs or existing Shopify redirects
                before continuing.
              </Banner>
            ) : null}

            <Card padding="0">
              <div className="rml-review-toolbar">
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
                    {filteredRows.length} shown · {readyCount} ready ·{" "}
                    {needsReviewCount} need review
                    {targetValidationLoading ? " · checking safety" : ""}
                  </Text>
                </InlineStack>
              </div>

              <div className="rml-review-sections">
                {visibleAttentionRows.length ? (
                  <section className="rml-review-section rml-review-section--low">
                    <div className="rml-review-section__header">
                      <InlineStack
                        gap="150"
                        blockAlign="center"
                        align="space-between"
                      >
                        <Text variant="headingMd" as="h2">
                          Review attention items first
                        </Text>
                        <Badge tone="warning">{`${visibleAttentionRows.length} need review`}</Badge>
                      </InlineStack>
                      <Text variant="bodyMd" tone="subdued" as="p">
                        These redirects have broad fallbacks, low confidence,
                        invalid destinations, or source conflicts. Approve safe
                        suggestions, edit targets, or skip redirects before
                        continuing.
                      </Text>
                    </div>
                    <div className="rml-review-card-list">
                      {visibleAttentionRows.map(renderRedirectCard)}
                    </div>
                  </section>
                ) : needsReviewCount > 0 ||
                  conflictCount > 0 ||
                  selectedInvalidCount > 0 ? (
                  <section className="rml-review-section rml-review-section--low rml-review-section--empty">
                    <div className="rml-review-section__header">
                      <InlineStack
                        gap="150"
                        blockAlign="center"
                        align="space-between"
                      >
                        <Text variant="headingMd" as="h2">
                          Attention items
                        </Text>
                        <Badge tone="success">Reviewed or filtered</Badge>
                      </InlineStack>
                      <Text variant="bodyMd" tone="subdued" as="p">
                        No attention items match the current filters.
                      </Text>
                    </div>
                  </section>
                ) : null}

                <section className="rml-review-section">
                  <div className="rml-review-section__header">
                    <InlineStack
                      gap="150"
                      blockAlign="center"
                      align="space-between"
                    >
                      <Text variant="headingMd" as="h2">
                        Ready redirects
                      </Text>
                      <Badge tone="success">{`${visibleReadyRows.length} shown`}</Badge>
                    </InlineStack>
                    <Text variant="bodyMd" tone="subdued" as="p">
                      Approved, edited, skipped, and ready redirects are listed
                      after the items that need manual review.
                    </Text>
                  </div>
                  {visibleReadyRows.length ? (
                    <div className="rml-review-card-list">
                      {visibleReadyRows.map(renderRedirectCard)}
                    </div>
                  ) : (
                    <Box padding="400">
                      <Text variant="bodyMd" tone="subdued" as="p">
                        No ready redirects match the current filters.
                      </Text>
                    </Box>
                  )}
                </section>

                {!filteredRows.length ? (
                  <Box padding="400">
                    <Text variant="bodyMd" tone="subdued" as="p">
                      No redirects match the current filters.
                    </Text>
                  </Box>
                ) : null}
              </div>

              <div className="rml-review-footer">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="150">
                    <Badge tone="success">{`${highCount} high`}</Badge>
                    <Badge tone="info">{`${mediumCount} medium`}</Badge>
                    <Badge tone="warning">{`${lowCount} low`}</Badge>
                    <Text variant="bodySm" tone="subdued" as="span">
                      · {readyCount} ready · {editedCount} approved/edited ·{" "}
                      {skippedCount} skipped · {conflictCount} conflicts
                    </Text>
                  </InlineStack>
                  {needsReviewCount > 0 && confidenceFilter !== "Low" ? (
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
                  ) : confidenceFilter !== "All" || ruleFilter !== "All" ? (
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
                  ) : null}
                </InlineStack>
              </div>
            </Card>
          </BlockStack>
          <Modal
            open={lowConfidenceModalOpen}
            onClose={() => setLowConfidenceModalOpen(false)}
            title="Approve redirects that need review?"
            primaryAction={{
              content: "Approve reviewable and continue",
              onAction: confirmLowConfidenceRedirects,
            }}
            secondaryActions={[
              {
                content: "Keep reviewing",
                onAction: () => setLowConfidenceModalOpen(false),
              },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  {`${lowConfidenceRedirectCount} redirects still need review.`}
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">
                  Continuing approves only reviewable redirects. Invalid
                  destinations and conflicts must be fixed before you can
                  continue.
                </Text>
              </BlockStack>
            </Modal.Section>
          </Modal>
          <Modal
            open={brokenTargetFixModalOpen}
            onClose={() => setBrokenTargetFixModalOpen(false)}
            title="Auto fix 404 destinations"
            primaryAction={{
              content: `Fix ${brokenTargetRowCount} redirect${brokenTargetRowCount === 1 ? "" : "s"}`,
              disabled: brokenTargetFixInvalid || !brokenTargetRows.length,
              onAction: fixBrokenTargets,
            }}
            secondaryActions={[
              {
                content: "Cancel",
                onAction: () => setBrokenTargetFixModalOpen(false),
              },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="300">
                <Text variant="bodyMd" as="p">
                  Choose a safe fallback destination for every redirect
                  currently pointing to a destination that may 404.
                </Text>
                <BlockStack gap="200">
                  <RadioButton
                    label="Send to all products"
                    helpText="Best default for collection, tag, vendor, or broad catalog redirects."
                    checked={brokenTargetFixChoice === "allProducts"}
                    id="broken-target-fix-all-products"
                    name="broken-target-fix"
                    onChange={() => setBrokenTargetFixChoice("allProducts")}
                  />
                  <RadioButton
                    label="Send to homepage"
                    helpText="Use when the store does not have a reliable catalog landing page."
                    checked={brokenTargetFixChoice === "homepage"}
                    id="broken-target-fix-homepage"
                    name="broken-target-fix"
                    onChange={() => setBrokenTargetFixChoice("homepage")}
                  />
                  <RadioButton
                    label="Send to a custom storefront path"
                    helpText="Use a known working path, such as /collections/sale or /pages/contact."
                    checked={brokenTargetFixChoice === "custom"}
                    id="broken-target-fix-custom"
                    name="broken-target-fix"
                    onChange={() => setBrokenTargetFixChoice("custom")}
                  />
                  {brokenTargetFixChoice === "custom" ? (
                    <TextField
                      label="Custom fallback path"
                      value={brokenTargetFixCustomPath}
                      onChange={setBrokenTargetFixCustomPath}
                      placeholder="/collections/all"
                      error={
                        brokenTargetFixInvalid
                          ? "Enter a valid storefront path or full URL."
                          : undefined
                      }
                      autoComplete="off"
                    />
                  ) : null}
                </BlockStack>
                <div className="rml-broken-target-fix-preview">
                  <Text variant="bodySm" tone="subdued" as="span">
                    Selected fallback
                  </Text>
                  <span>
                    {brokenTargetFixDestination || "No valid path yet"}
                  </span>
                </div>
              </BlockStack>
            </Modal.Section>
          </Modal>
        </>
      </Page>
    </>
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
  const [confirmApplyModalOpen, setConfirmApplyModalOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasCompletedApply, setHasCompletedApply] = useState(false);
  const applyData = applyFetcher.data;

  const applyRows = useMemo(
    () =>
      rows.filter(
        (row) => row.targetChoice !== "skip" && isPreviewDestinationValid(row),
      ),
    [rows],
  );
  const invalidRows = useMemo(
    () =>
      rows.filter(
        (row) => row.targetChoice !== "skip" && !isPreviewDestinationValid(row),
      ),
    [rows],
  );
  const skippedRows = useMemo(
    () => rows.filter((row) => row.targetChoice === "skip"),
    [rows],
  );
  const lowConfidenceRows = useMemo(
    () =>
      applyRows.filter(
        (row) => row.confidence === "Low" || row.tone === "warning",
      ),
    [applyRows],
  );
  const reviewedRows = useMemo(() => rows.filter((row) => row.edited), [rows]);
  const preArchivedRows = useMemo(
    () =>
      cleanupMode === "archive"
        ? applyRows.filter((row) => row.status === "archived")
        : [],
    [applyRows, cleanupMode],
  );
  const conflicts = useMemo(
    () =>
      applyRows.filter(
        (row, index) =>
          applyRows.findIndex((item) => item.from === row.from) !== index,
      ),
    [applyRows],
  );
  const productsRetired = cleanupMode === "redirects" ? 0 : applyRows.length;
  const currentUsage = planInfo.redirectsUsed;
  const planLimit = planInfo.redirectLimit;
  const overCleanupRunLimit = applyRows.length > MAX_PRODUCTS_PER_CLEANUP_RUN;
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
    ...(applyData?.redirects ?? []).filter((result) => !result.ok),
    ...(applyData?.products ?? []).filter((result) => !result.ok),
  ];
  const applyErrorMessage =
    applyData && !applyData.ok && applyData.message && !operationErrors.length
      ? applyData.message
      : null;
  const devShopifyApiLogs = applyData?.dev?.shopifyApiLogs;
  const productById = useMemo(
    () => new Map(applyRows.map((row) => [row.id, row])),
    [applyRows],
  );

  const modes = [
    {
      id: "redirects" as const,
      title: "Redirects only",
      description: "Create redirects and leave products unchanged.",
      icon: DomainRedirectIcon,
      detail: `${applyRows.length} redirects`,
    },
    {
      id: "archive" as const,
      title: "Redirects + archive",
      description: "Archive selected products after redirects are created.",
      icon: ArchiveIcon,
      detail: `${applyRows.length} redirects, ${applyRows.length} archives`,
      recommended: true,
    },
    {
      id: "delete" as const,
      title: "Redirects + delete",
      description: "Delete selected products after redirects are created.",
      icon: DeleteIcon,
      detail: `${applyRows.length} redirects, ${applyRows.length} deletes`,
      danger: true,
    },
  ];

  const confidenceSummary = REVIEW_CONFIDENCE_ORDER.map((confidence) => ({
    label: confidence,
    value: applyRows.filter((row) => row.confidence === confidence).length,
  }));
  const ruleSummary = useMemo(() => {
    const counts = new Map<string, number>();
    applyRows.forEach((row) => {
      counts.set(row.via, (counts.get(row.via) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value }));
  }, [applyRows]);
  const selectedMode =
    modes.find((mode) => mode.id === cleanupMode) ?? modes[0];
  const summaryStats = [
    { label: "Products selected", value: rows.length, icon: ProductIcon },
    {
      label: "Redirects to create",
      value: applyRows.length,
      icon: DomainRedirectIcon,
    },
    {
      label:
        cleanupMode === "redirects" ? "Products changed" : "Products to retire",
      value: productsRetired,
      icon: selectedMode.icon,
    },
    {
      label: "Skipped",
      value: skippedRows.length,
      icon: ClipboardChecklistIcon,
    },
    { label: "Conflicts", value: conflicts.length, icon: ChartDonutIcon },
    {
      label: "Low confidence",
      value: lowConfidenceRows.length,
      icon: AlertTriangleIcon,
    },
    {
      label: "Reviewed edits",
      value: reviewedRows.length,
      icon: PaperCheckIcon,
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
  const estimatedImpactItems = [
    { label: "Cleanup mode", value: selectedMode.title },
    { label: "Products selected", value: String(rows.length) },
    { label: "Redirects to create", value: String(applyRows.length) },
    {
      label:
        cleanupMode === "redirects"
          ? "Products to change"
          : cleanupMode === "archive"
            ? "Products to archive"
            : "Products to delete",
      value: String(productsRetired),
    },
    { label: "Skipped", value: String(skippedRows.length) },
    { label: "Conflicts", value: String(conflicts.length) },
    { label: "Low confidence", value: String(lowConfidenceRows.length) },
    {
      label: "Estimated impact",
      value:
        cleanupMode === "redirects"
          ? `${applyRows.length} redirects only`
          : `${applyRows.length} redirects + ${productsRetired} ${cleanupMode === "archive" ? "archives" : "deletes"}`,
    },
  ];
  const estimatedApplyMs = useMemo(() => {
    const perRedirectMs = 420;
    const perProductMutationMs =
      cleanupMode === "delete" ? 820 : cleanupMode === "archive" ? 620 : 0;
    const estimated =
      2600 + applyRows.length * (perRedirectMs + perProductMutationMs);
    return Math.min(90000, Math.max(3800, estimated));
  }, [applyRows.length, cleanupMode]);
  const applyProgressCopy = useMemo(() => {
    if (progress < 14) {
      return {
        label: "Preparing Shopify cleanup",
        description:
          "Packaging the selected products and opening the Shopify write step.",
      };
    }

    if (progress < 60) {
      return {
        label: "Creating Shopify redirects",
        description: `Creating ${applyRows.length} URL redirect${applyRows.length === 1 ? "" : "s"} for the retired product paths.`,
      };
    }

    if (cleanupMode !== "redirects" && progress < 88) {
      const verb = cleanupMode === "archive" ? "Archiving" : "Deleting";
      return {
        label: `${verb} selected products`,
        description: `${verb} ${productsRetired} product${productsRetired === 1 ? "" : "s"} after redirect creation.`,
      };
    }

    if (progress < 94) {
      return {
        label: "Checking Shopify responses",
        description:
          "Confirming which redirects and product updates Shopify accepted.",
      };
    }

    return {
      label: "Saving cleanup record",
      description:
        "Writing the cleanup summary and attention items into History.",
    };
  }, [applyRows.length, cleanupMode, productsRetired, progress]);

  useEffect(() => {
    if (!isApplying) {
      return undefined;
    }

    const startedAt = window.Date.now();
    setProgress(4);
    const interval = window.setInterval(() => {
      const elapsedMs = window.Date.now() - startedAt;
      const baseProgress =
        elapsedMs <= estimatedApplyMs
          ? 4 + (elapsedMs / estimatedApplyMs) * 86
          : 90 + 7 * (1 - Math.exp(-(elapsedMs - estimatedApplyMs) / 30000));
      const nextProgress = Math.min(97, Math.max(4, Math.round(baseProgress)));
      setProgress((current) => Math.max(current, nextProgress));
    }, 500);

    return () => window.clearInterval(interval);
  }, [estimatedApplyMs, isApplying]);

  useEffect(() => {
    if (!applyData || !applyData.cleanupId || hasCompletedApply) return;

    setProgress(100);
    setHasCompletedApply(true);
    window.setTimeout(() => {
      const redirectsCreated = applyData.redirects.filter(
        (result) => result.ok,
      ).length;
      const redirectFailures = applyData.redirects.filter(
        (result) => !result.ok,
      );
      const productsChanged = applyData.products.filter(
        (result) => result.ok,
      ).length;
      const productFailures = applyData.products.filter((result) => !result.ok);
      const issues: CleanupIssue[] = [
        ...redirectFailures.map((failure) => ({
          id: `redirect-${failure.productId}-${failure.from}`,
          severity: "critical" as const,
          area: "Redirect",
          productName: failure.productName,
          productId: failure.productId,
          from: failure.from,
          to: failure.to,
          message:
            failure.message ?? "Shopify did not create this URL redirect.",
        })),
        ...productFailures.map((failure) => {
          const product = productById.get(failure.productId);
          return {
            id: `product-${failure.productId}-${failure.operation ?? "update"}`,
            severity: "critical" as const,
            area:
              failure.operation === "delete"
                ? "Product delete"
                : failure.operation === "archive"
                  ? "Product archive"
                  : "Product update",
            productName: product?.name,
            productId: failure.productId,
            message: failure.message ?? "Shopify did not update this product.",
          };
        }),
        ...(preArchivedRows.length
          ? [
              {
                id: "pre-archived-products",
                severity: "warning" as const,
                area: "Product archive",
                productName: `${preArchivedRows.length} already archived`,
                message:
                  "Some selected products were already archived before this run. Shopify still accepted the cleanup, but no visible product-status change was needed for those items.",
              },
            ]
          : []),
        ...(conflicts.length
          ? [
              {
                id: "source-url-conflicts",
                severity: "warning" as const,
                area: "Source URL",
                productName: `${conflicts.length} duplicate source URL${conflicts.length === 1 ? "" : "s"}`,
                message:
                  "Duplicate source URLs were detected before applying. Review the saved cleanup if Shopify rejected any duplicates.",
              },
            ]
          : []),
      ];
      onComplete({
        id: applyData.cleanupId ?? String(Date.now()),
        completedAt: applyData.completedAt
          ? new Date(applyData.completedAt)
          : new Date(),
        mode: cleanupMode,
        redirectsCreated,
        redirectsFailed: redirectFailures.length,
        productsRetired: cleanupMode === "redirects" ? 0 : productsChanged,
        productsFailed: productFailures.length,
        skipped: skippedRows.length,
        conflicts: conflicts.length,
        issues,
      });
    }, 650);
  }, [
    applyData,
    cleanupMode,
    conflicts.length,
    conflicts,
    hasCompletedApply,
    onComplete,
    preArchivedRows,
    productById,
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
    conflicts.length > 0 ||
    isApplying ||
    overCleanupRunLimit ||
    (mustConfirmDelete && !confirmed) ||
    (overPlanLimit && !effectivePlanOverrideAllowed);

  const requestApplyConfirmation = () => {
    if (primaryDisabled) return;
    setConfirmApplyModalOpen(true);
  };

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
          confidence: row.confidence === "Low" ? undefined : row.confidence,
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
    setConfirmApplyModalOpen(false);
    setProgress(0);
    setHasCompletedApply(false);
    applyFetcher.submit(formData, {
      method: "post",
      action: "/app/apply",
    });
  };

  return (
    <>
      <WizardProgressNav
        currentStep="apply"
        onBack={onBack}
        onNext={requestApplyConfirmation}
        nextDisabled={primaryDisabled}
        nextLoading={isApplying}
        backLabel="Back to review"
        nextLabel={isApplying ? "Applying..." : "Apply now"}
      />
      <Page
        title="Summary"
        subtitle="Review cleanup mode, redirect coverage, and final Shopify changes before applying"
      >
        <BlockStack gap="400">
          {isApplying ? (
            <div className="rml-apply-progress-panel">
              <InlineStack gap="300" blockAlign="start" wrap={false}>
                <span
                  className="rml-apply-progress-panel__icon"
                  aria-hidden="true"
                >
                  <Icon source={selectedMode.icon} />
                </span>
                <BlockStack gap="200">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      {applyProgressCopy.label}
                    </Text>
                    <Text variant="bodyMd" as="p">
                      {applyProgressCopy.description}
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Keep this page open until the cleanup finishes. Larger
                      batches move more slowly because each product requires
                      Shopify API work.
                    </Text>
                  </BlockStack>
                  <ProgressBar
                    progress={progress}
                    tone="primary"
                    size="small"
                  />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodySm" tone="subdued" as="span">
                      Shopify operations are running in order. Do not close this
                      page.
                    </Text>
                    <Text variant="bodySm" fontWeight="semibold" as="span">
                      {progress}%
                    </Text>
                  </InlineStack>
                </BlockStack>
              </InlineStack>
            </div>
          ) : null}

          {operationErrors.length ? (
            <Banner
              tone="critical"
              title={`${operationErrors.length} operation${operationErrors.length > 1 ? "s" : ""} failed`}
            >
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  The following Shopify operations could not be completed. No
                  partial changes were rolled back — check History for what was
                  saved.
                </Text>
                <BlockStack gap="100">
                  {operationErrors.map((err, i) => (
                    <div key={i} className="rml-apply-error">
                      {"productId" in err && !("from" in err) ? (
                        <>
                          <div>
                            <strong>Product ID:</strong>{" "}
                            {(err as { productId: string }).productId}
                          </div>
                          <div>
                            <strong>Operation:</strong>{" "}
                            {(err as { operation?: string }).operation ??
                              "product"}
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>Product:</strong>{" "}
                            {(err as { productName: string }).productName}
                          </div>
                          <div>
                            <strong>From:</strong>{" "}
                            {(err as { from: string }).from}
                          </div>
                          <div>
                            <strong>To:</strong> {(err as { to: string }).to}
                          </div>
                        </>
                      )}
                      <div>
                        <strong>Error:</strong>{" "}
                        {err.message ?? "No error message returned by Shopify."}
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Banner>
          ) : null}

          {applyErrorMessage ? (
            <Banner tone="critical" title="Cleanup could not be applied">
              {applyErrorMessage}
            </Banner>
          ) : null}

          {invalidRows.length ? (
            <Banner
              tone="critical"
              title={`${invalidRows.length} invalid redirect targets`}
            >
              Go back to review and fix custom destinations before applying.
            </Banner>
          ) : null}

          {overCleanupRunLimit ? (
            <Banner
              tone="critical"
              title="Too many products for one cleanup run"
            >
              This cleanup has {applyRows.length} products. The app can safely
              process up to {MAX_PRODUCTS_PER_CLEANUP_RUN} products per run;
              split the cleanup into multiple batches and apply them separately.
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
                  Applying these redirects would use {projectedUsage} of{" "}
                  {planLimit} redirect slots.
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
                      {effectivePlanOverrideAllowed
                        ? "Free override enabled"
                        : "Apply changes anyway"}
                    </Button>
                    {effectivePlanOverrideAllowed ? (
                      <Text variant="bodySm" tone="subdued" as="span">
                        You can apply this cleanup now. Free overrides are
                        available up to {FREE_PLAN_OVERRIDE_REDIRECT_LIMIT}{" "}
                        redirects.
                      </Text>
                    ) : null}
                  </InlineStack>
                ) : (
                  <Text variant="bodyMd" as="p">
                    Free overrides are available only up to{" "}
                    {FREE_PLAN_OVERRIDE_REDIRECT_LIMIT} redirects created with
                    the app. Upgrade to continue applying redirects from here.
                  </Text>
                )}
              </BlockStack>
            </Banner>
          ) : null}

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingLg" as="h2">
                    Cleanup mode
                  </Text>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Choose whether this run only creates redirects or also
                    retires the selected products after redirects are created.
                  </Text>
                </BlockStack>
                <Badge
                  tone={
                    selectedMode.danger
                      ? "critical"
                      : selectedMode.recommended
                        ? "success"
                        : undefined
                  }
                >
                  {selectedMode.title}
                </Badge>
              </InlineStack>
              <div className="rml-cleanup-mode-grid">
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
                    className={`rml-cleanup-mode-card${cleanupMode === mode.id ? " rml-cleanup-mode-card--selected" : ""}${mode.danger ? " rml-cleanup-mode-card--danger" : ""}`}
                  >
                    {mode.recommended && (
                      <div className="rml-cleanup-mode-card__badge">
                        <Badge tone="success">Recommended</Badge>
                      </div>
                    )}
                    <div className="rml-cleanup-mode-card__header">
                      <span className="rml-cleanup-mode-card__icon">
                        <Icon source={mode.icon} />
                      </span>
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
                    </div>
                    <BlockStack gap="150">
                      <Text
                        variant="headingSm"
                        tone={mode.danger ? "critical" : undefined}
                        as="h3"
                      >
                        {mode.title}
                      </Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        {mode.description}
                      </Text>
                      <Text variant="bodySm" fontWeight="semibold" as="p">
                        {mode.detail}
                      </Text>
                    </BlockStack>
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
            <Banner
              tone="warning"
              title={`${conflicts.length} source URL conflicts`}
            >
              Duplicate source URLs were found in the selected redirects. Go
              back to review if you want to remove duplicates.
            </Banner>
          ) : null}

          <div className="rml-apply-layout">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    What will happen
                  </Text>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    Redirects are created first. Product archive or delete
                    actions run only after each product has a valid redirect
                    target.
                  </Text>
                  <BlockStack gap="200">
                    {steps.map((text, i) => (
                      <InlineStack
                        key={text}
                        gap="200"
                        blockAlign="start"
                        wrap={false}
                      >
                        <span className="rml-apply-step-number">{i + 1}</span>
                        <Text variant="bodyMd" as="span">
                          {text}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      Final safety summary
                    </Text>
                    <Badge
                      tone={
                        selectedMode.danger
                          ? "critical"
                          : selectedMode.recommended
                            ? "success"
                            : "info"
                      }
                    >
                      {selectedMode.title}
                    </Badge>
                  </InlineStack>
                  <div className="rml-apply-safety-grid">
                    {estimatedImpactItems.map((item) => (
                      <div key={item.label} className="rml-apply-safety-item">
                        <Text variant="bodySm" tone="subdued" as="span">
                          {item.label}
                        </Text>
                        <Text variant="bodyMd" fontWeight="semibold" as="span">
                          {item.value}
                        </Text>
                      </div>
                    ))}
                  </div>
                  {cleanupMode === "delete" ? (
                    <Banner tone="critical" title="Delete is permanent">
                      Products are deleted only after redirect creation
                      succeeds, but Shopify product deletion cannot be undone
                      from this cleanup record.
                    </Banner>
                  ) : cleanupMode === "archive" ? (
                    <Banner tone="warning" title="Products will be archived">
                      Products are archived only after redirect creation
                      succeeds. You can roll back redirects from History.
                    </Banner>
                  ) : null}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Rules summary
                  </Text>
                  {ruleSummary.length ? (
                    <div className="rml-apply-breakdown">
                      {ruleSummary.map((item) => (
                        <InlineStack
                          key={item.label}
                          align="space-between"
                          blockAlign="center"
                        >
                          <Text variant="bodyMd" as="span">
                            {item.label}
                          </Text>
                          <Badge tone="info">{`${item.value} products`}</Badge>
                        </InlineStack>
                      ))}
                    </div>
                  ) : (
                    <Text variant="bodyMd" tone="subdued" as="p">
                      No rules currently apply to valid redirects.
                    </Text>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Confidence summary
                  </Text>
                  <div className="rml-apply-breakdown">
                    {confidenceSummary.map((item) => (
                      <InlineStack
                        key={item.label}
                        align="space-between"
                        blockAlign="center"
                      >
                        <Text variant="bodyMd" as="span">
                          {item.label}
                        </Text>
                        <Badge
                          tone={
                            item.label === "High"
                              ? "success"
                              : item.label === "Medium"
                                ? "info"
                                : "warning"
                          }
                        >
                          {String(item.value)}
                        </Badge>
                      </InlineStack>
                    ))}
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="bodyMd" as="span">
                        Skipped
                      </Text>
                      <Badge>{String(skippedRows.length)}</Badge>
                    </InlineStack>
                  </div>
                </BlockStack>
              </Card>
            </BlockStack>

            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Run summary
                  </Text>
                  <div className="rml-apply-stat-grid">
                    {summaryStats.map((item) => (
                      <div key={item.label} className="rml-apply-stat">
                        <span className="rml-apply-stat__icon">
                          <Icon source={item.icon} />
                        </span>
                        <BlockStack gap="050">
                          <Text variant="headingLg" as="p">
                            {item.value}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {item.label}
                          </Text>
                        </BlockStack>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">
                    Plan usage
                  </Text>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyMd" tone="subdued" as="span">
                      {planInfo.plan === "free"
                        ? "Free plan usage"
                        : "Standard plan usage"}
                    </Text>
                    <Text
                      variant="bodyMd"
                      fontWeight="semibold"
                      tone={overPlanLimit ? "critical" : undefined}
                      as="span"
                    >
                      {hasLimit
                        ? `${projectedUsage} / ${planLimit}`
                        : `${projectedUsage} (unlimited)`}
                    </Text>
                  </InlineStack>
                  {hasLimit ? (
                    <ProgressBar
                      progress={planProgress}
                      tone={overPlanLimit ? "critical" : "primary"}
                      size="small"
                    />
                  ) : null}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">
                    Export instead
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    Download the selected redirects as a Shopify-compatible CSV
                    without writing to the store.
                  </Text>
                  <Button
                    fullWidth
                    icon={ExportIcon}
                    disabled={!applyRows.length}
                    onClick={() => exportRedirectsCsv(applyRows)}
                  >
                    Download redirects.csv
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </div>
        </BlockStack>
      </Page>
      <Modal
        open={confirmApplyModalOpen}
        onClose={() => setConfirmApplyModalOpen(false)}
        title="Apply cleanup changes?"
        primaryAction={{
          content: "Apply changes",
          destructive: cleanupMode === "delete",
          loading: isApplying,
          onAction: submitApply,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmApplyModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodyMd" as="p">
              This will create {applyRows.length} Shopify URL redirects
              {cleanupMode === "redirects"
                ? " and leave products unchanged."
                : cleanupMode === "archive"
                  ? ` and archive ${productsRetired} products.`
                  : ` and delete ${productsRetired} products.`}
            </Text>
            <div className="rml-apply-safety-grid">
              <div className="rml-apply-safety-item">
                <Text variant="bodySm" tone="subdued" as="span">
                  Cleanup mode
                </Text>
                <Text variant="bodyMd" fontWeight="semibold" as="span">
                  {selectedMode.title}
                </Text>
              </div>
              <div className="rml-apply-safety-item">
                <Text variant="bodySm" tone="subdued" as="span">
                  Skipped
                </Text>
                <Text variant="bodyMd" fontWeight="semibold" as="span">
                  {skippedRows.length}
                </Text>
              </div>
              <div className="rml-apply-safety-item">
                <Text variant="bodySm" tone="subdued" as="span">
                  Conflicts
                </Text>
                <Text
                  variant="bodyMd"
                  fontWeight="semibold"
                  tone={conflicts.length ? "critical" : undefined}
                  as="span"
                >
                  {conflicts.length}
                </Text>
              </div>
              <div className="rml-apply-safety-item">
                <Text variant="bodySm" tone="subdued" as="span">
                  Low confidence
                </Text>
                <Text
                  variant="bodyMd"
                  fontWeight="semibold"
                  tone={lowConfidenceRows.length ? "caution" : undefined}
                  as="span"
                >
                  {lowConfidenceRows.length}
                </Text>
              </div>
            </div>
            {cleanupMode === "delete" ? (
              <Banner tone="critical" title="Permanent delete selected">
                Delete runs only after redirect creation succeeds for each
                product. Deleted Shopify products cannot be restored from
                History.
              </Banner>
            ) : cleanupMode === "archive" ? (
              <Banner tone="warning" title="Archive selected">
                Archive runs only after redirect creation succeeds for each
                product.
              </Banner>
            ) : null}
            <Text variant="bodyMd" as="p">
              The process can take some time on larger cleanups. Keep this page
              open while redirects and product updates are applied.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={reviewModalOpen && canUseFreePlanOverride}
        onClose={() => setReviewModalOpen(false)}
        title="Keep using Redirect Pulse for free"
        primaryAction={{
          content: "Continue",
          onAction: () => setReviewModalOpen(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text variant="bodyMd" as="p">
              You can keep using the app for free, even when this cleanup goes
              over the free plan limit.
            </Text>
            <Text variant="bodyMd" as="p">
              This temporary exception is limited to{" "}
              {FREE_PLAN_OVERRIDE_REDIRECT_LIMIT} redirects created with the
              app.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

// ─── Step 7: Success ─────────────────────────────────────────
function SuccessStep({
  result,
  rows,
}: {
  result: CleanupResult | null;
  rows: GeneratedPreviewRow[];
}) {
  const navigate = useNavigate();

  const appliedRows = rows.filter(
    (row) => row.targetChoice !== "skip" && isPreviewDestinationValid(row),
  );
  const fallbackResult: CleanupResult = {
    id: String(Date.now()),
    completedAt: new Date(),
    mode: "archive",
    redirectsCreated: appliedRows.length,
    redirectsFailed: 0,
    productsRetired: appliedRows.length,
    productsFailed: 0,
    skipped: rows.filter((row) => row.targetChoice === "skip").length,
    conflicts: 0,
    issues: [],
  };
  const cleanup = result ?? fallbackResult;
  const cleanupLabel = `cleanup-${cleanup.id}`;
  const productsAction =
    cleanup.mode === "redirects"
      ? "Products unchanged"
      : cleanup.mode === "archive"
        ? "Products archived"
        : "Products deleted";
  const redirectTotal = cleanup.redirectsCreated + cleanup.redirectsFailed;
  const productTotal = cleanup.productsRetired + cleanup.productsFailed;
  const hasFailures = cleanup.redirectsFailed > 0 || cleanup.productsFailed > 0;
  const hasWarnings = cleanup.issues.some(
    (issue) => issue.severity !== "critical",
  );
  const completionTone = hasFailures
    ? "critical"
    : hasWarnings
      ? "warning"
      : "success";
  const resultStats = [
    {
      label: "Redirects applied",
      value: `${cleanup.redirectsCreated}/${redirectTotal || appliedRows.length}`,
      icon: DomainRedirectIcon,
      tone: cleanup.redirectsFailed ? "warning" : "success",
    },
    cleanup.mode !== "redirects" && {
      label: productsAction,
      value: `${cleanup.productsRetired}/${productTotal || cleanup.productsRetired}`,
      icon: cleanup.mode === "archive" ? ArchiveIcon : DeleteIcon,
      tone: cleanup.productsFailed ? "warning" : "success",
    },
    cleanup.redirectsFailed > 0 && {
      label: "Redirect failures",
      value: String(cleanup.redirectsFailed),
      icon: AlertTriangleIcon,
      tone: "critical",
    },
    cleanup.productsFailed > 0 && {
      label: "Product failures",
      value: String(cleanup.productsFailed),
      icon: AlertTriangleIcon,
      tone: "critical",
    },
    cleanup.skipped > 0 && {
      label: "Skipped",
      value: String(cleanup.skipped),
      icon: ClipboardChecklistIcon,
      tone: "info",
    },
    cleanup.conflicts > 0 && {
      label: "Source conflicts",
      value: String(cleanup.conflicts),
      icon: ChartDonutIcon,
      tone: "warning",
    },
  ].filter(Boolean) as {
    label: string;
    value: string;
    icon: typeof DomainRedirectIcon;
    tone: "success" | "warning" | "critical" | "info";
  }[];

  return (
    <>
      <WizardProgressNav
        currentStep="success"
        backDisabled
        nextDisabled
        backLabel="Back"
        nextLabel="Done"
      />
      <Page
        title="Cleanup complete"
        subtitle={`${cleanup.redirectsCreated} of ${redirectTotal || cleanup.redirectsCreated} redirects applied · ${productsAction.toLowerCase()}`}
      >
        <BlockStack gap="400">
          <div
            className={`rml-success-result-panel rml-success-result-panel--${completionTone}`}
          >
            <InlineStack gap="400" blockAlign="center" wrap={false}>
              <span
                className="rml-success-result-panel__icon"
                aria-hidden="true"
              >
                <Icon source={hasFailures ? AlertTriangleIcon : CheckIcon} />
              </span>
              <BlockStack gap="100">
                <Text variant="headingLg" as="h2">
                  {hasFailures
                    ? "Cleanup finished with attention needed"
                    : hasWarnings
                      ? "Cleanup applied with warnings"
                      : "Cleanup applied successfully"}
                </Text>
                <Text variant="bodyMd" tone="subdued" as="p">
                  {cleanupLabel} was saved to History. Review the items below
                  only when Shopify reported failures or warnings.
                </Text>
              </BlockStack>
            </InlineStack>
          </div>

          <div className="rml-success-result-grid">
            {resultStats.map((stat) => (
              <div
                key={stat.label}
                className={`rml-success-result-stat rml-success-result-stat--${stat.tone}`}
              >
                <span
                  className="rml-success-result-stat__icon"
                  aria-hidden="true"
                >
                  <Icon source={stat.icon} />
                </span>
                <BlockStack gap="050">
                  <Text variant="headingLg" as="p">
                    {stat.value}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    {stat.label}
                  </Text>
                </BlockStack>
              </div>
            ))}
          </div>

          <Card padding="0">
            <div className="rml-success-issues-header">
              <BlockStack gap="050">
                <Text variant="headingMd" as="h2">
                  Attention items
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  Errors and warnings reported by the cleanup process.
                  Successful redirects are saved in History and are not repeated
                  here.
                </Text>
              </BlockStack>
            </div>
            {cleanup.issues.length ? (
              <IndexTable
                resourceName={{
                  singular: "attention item",
                  plural: "attention items",
                }}
                itemCount={cleanup.issues.length}
                selectable={false}
                headings={[
                  { title: "Severity" },
                  { title: "Area" },
                  { title: "Details" },
                  { title: "Product or URL" },
                ]}
              >
                {cleanup.issues.map((issue, index) => (
                  <IndexTable.Row id={issue.id} key={issue.id} position={index}>
                    <IndexTable.Cell>
                      <Badge
                        tone={
                          issue.severity === "critical"
                            ? "critical"
                            : issue.severity === "warning"
                              ? "warning"
                              : "info"
                        }
                      >
                        {issue.severity === "critical"
                          ? "Error"
                          : issue.severity === "warning"
                            ? "Warning"
                            : "Info"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {issue.area}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <div className="rml-success-issue-details">
                        <Text variant="bodySm" as="span">
                          {issue.message}
                        </Text>
                      </div>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text variant="bodySm" as="span">
                          <span className="rml-success-issue-product">
                            {issue.productName ??
                              issue.productId ??
                              issue.from ??
                              "Cleanup run"}
                          </span>
                        </Text>
                        {issue.from || issue.to ? (
                          <Text variant="bodySm" tone="subdued" as="span">
                            <span className="rml-success-issue-path">
                              {[issue.from, issue.to]
                                .filter(Boolean)
                                .join(" -> ")}
                            </span>
                          </Text>
                        ) : null}
                      </BlockStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <Box padding="500">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">No issues</Badge>
                  <Text variant="bodyMd" tone="subdued" as="span">
                    Shopify did not report redirect failures, product update
                    failures, or review warnings for this cleanup.
                  </Text>
                </InlineStack>
              </Box>
            )}
          </Card>

          <Card>
            <div className="rml-success-history-cta">
              <InlineStack gap="400" blockAlign="center" align="space-between">
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <span
                    className="rml-success-history-cta__icon"
                    aria-hidden="true"
                  >
                    <Icon source={ClipboardChecklistIcon} />
                  </span>
                  <BlockStack gap="050">
                    <Text variant="headingMd" as="h2">
                      Review this cleanup anytime
                    </Text>
                    <Text variant="bodyMd" tone="subdued" as="p">
                      Open the saved cleanup record to audit redirects, export
                      details, or roll back changes.
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Button
                  variant="primary"
                  icon={ClipboardChecklistIcon}
                  onClick={() => navigate(`/app/history?cleanup=${cleanup.id}`)}
                >
                  View cleanup history
                </Button>
              </InlineStack>
            </div>
          </Card>
        </BlockStack>
      </Page>
    </>
  );
}

const AI_WIZARD_EXAMPLES: {
  id: string;
  label: string;
  icon: typeof MagicIcon;
  prompt: string;
  tags?: string[];
  description: string;
}[] = [
  {
    id: "vendor-exit",
    label: "Vendor",
    icon: ArchiveIcon,
    prompt:
      "Retire products from [VENDOR], redirect each product URL to the closest active collection or product type collection, and prepare archive mode for final review.",
    tags: ["[VENDOR]"],
    description:
      "Use when a supplier is leaving and product URLs need safe collection destinations.",
  },
  {
    id: "discontinued-tag",
    label: "Discontinued",
    icon: DeleteIcon,
    prompt:
      "Delete products tagged [DISCONTINUED_TAG], redirect traffic to matching product type collections, and flag broad fallbacks for review.",
    tags: ["[DISCONTINUED_TAG]"],
    description:
      "For discontinued catalog lines that should be removed after redirect review.",
  },
  {
    id: "old-out-of-stock",
    label: "Sold out",
    icon: AlertTriangleIcon,
    prompt:
      "Archive products with zero inventory that are not coming back, redirect them to matching collections first, then product type collections.",
    description:
      "For sold-out products that should leave the storefront without creating 404s.",
  },
  {
    id: "seasonal-retire",
    label: "Seasonal",
    icon: SearchIcon,
    prompt:
      "Clean up products from [SEASON_OR_CAMPAIGN], prioritize out-of-stock items, and redirect shoppers to the closest current collection.",
    tags: ["[SEASON_OR_CAMPAIGN]"],
    description: "For retiring past-season, capsule, or campaign inventory.",
  },
  {
    id: "collection-sunset",
    label: "Collection",
    icon: ClipboardChecklistIcon,
    prompt:
      "Retire products from [OLD_COLLECTION], redirect to [NEW_COLLECTION] when relevant, otherwise use the closest active collection.",
    tags: ["[OLD_COLLECTION]", "[NEW_COLLECTION]"],
    description: "Use when replacing or closing a merchandising collection.",
  },
  {
    id: "final-sale",
    label: "Final sale",
    icon: ChartDonutIcon,
    prompt:
      "Clean up final-sale products with zero inventory, redirect to sale or outlet collections first, then product type collections as fallback.",
    description: "For sell-through cleanup after promotions or markdowns.",
  },
  {
    id: "product-type-sunset",
    label: "Type",
    icon: ProductIcon,
    prompt:
      "Remove old [PRODUCT_TYPE] products, redirect to [ALTERNATIVE_COLLECTION] or matching product type collections, and review low-confidence targets.",
    tags: ["[PRODUCT_TYPE]", "[ALTERNATIVE_COLLECTION]"],
    description: "For stopping a category while preserving shopper intent.",
  },
  {
    id: "draft-import",
    label: "Import",
    icon: ClipboardChecklistIcon,
    prompt:
      "Clean up draft or unavailable products tagged [IMPORT_TAG], redirect any public product URLs to safe catalog destinations, and review products before Summary.",
    tags: ["[IMPORT_TAG]"],
    description: "Useful after imports, feed syncs, or bulk catalog edits.",
  },
  {
    id: "archived-products",
    label: "Archived",
    icon: DomainRedirectIcon,
    prompt:
      "Create redirects only for archived products tagged [ARCHIVED_TAG], send traffic to the closest active collection, and do not change product status.",
    tags: ["[ARCHIVED_TAG]"],
    description:
      "For products already removed from sale that still need redirect coverage.",
  },
  {
    id: "clearance-cleanup",
    label: "Clearance",
    icon: TargetIcon,
    prompt:
      "Archive clearance products tagged [CLEARANCE_TAG] with low or zero inventory, redirect to outlet collections first, then product type collections.",
    tags: ["[CLEARANCE_TAG]"],
    description:
      "For cleaning up sale stock after markdowns or end-of-life campaigns.",
  },
];

const AI_WIZARD_REVIEW_STEP_BY_NEXT_STEP: Record<
  AiWizardPlan["nextStep"],
  WizardStep
> = {
  ask_clarifying_question: "onboarding-2",
  prefill_cleanup_type: "onboarding-2",
  prefill_product_filters: "products",
  prefill_redirect_rules: "rules",
  review_redirects: "preview",
  ready_for_merchant_review: "products",
};

const AI_CLEANUP_MODE_OPTIONS: {
  id: CleanupMode;
  title: string;
  description: string;
  icon: typeof DomainRedirectIcon;
  tone?: "critical";
}[] = [
  {
    id: "redirects",
    title: "Redirects only",
    description: "Create redirects and leave products unchanged.",
    icon: DomainRedirectIcon,
  },
  {
    id: "archive",
    title: "Redirects + archive",
    description: "Archive products after redirects are reviewed.",
    icon: ArchiveIcon,
  },
  {
    id: "delete",
    title: "Redirects + delete",
    description: "Delete products only after final confirmation.",
    icon: DeleteIcon,
    tone: "critical",
  },
];

const AI_EMPTY_PRESET_DETAILS: PresetDetails = {
  seasonal: {
    keywords: "",
    collectionIds: [],
    collectionTitles: [],
    tags: [],
    inventory: "",
  },
  vendor: {
    vendors: [],
    productTypes: [],
  },
  oos: {
    updated: "",
    productTypes: [],
    tags: [],
  },
  spring: {
    tags: [],
    inventory: "",
    updated: "",
    productTypes: [],
  },
};

function formatAiNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  return new Intl.NumberFormat("en-US").format(value);
}

function isAiCleanupPreset(value: string): value is CleanupPreset {
  return ["seasonal", "vendor", "oos", "spring", "none"].includes(value);
}

function isAiCleanupMode(value: string): value is CleanupMode {
  return ["redirects", "archive", "delete"].includes(value);
}

function aiPlanPreset(plan: AiWizardPlan): CleanupPreset {
  if (isAiCleanupPreset(plan.prefill.cleanupPreset))
    return plan.prefill.cleanupPreset;
  if (isAiCleanupPreset(plan.cleanupPreset)) return plan.cleanupPreset;
  return "none";
}

function aiPlanCleanupMode(plan: AiWizardPlan): CleanupMode {
  if (isAiCleanupMode(plan.prefill.cleanupMode))
    return plan.prefill.cleanupMode;
  if (isAiCleanupMode(plan.cleanupType)) return plan.cleanupType;
  return "archive";
}

function aiConfidencePercent(confidence: number) {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

function aiConfidenceTone(confidence: number): "success" | "info" | "warning" {
  if (confidence >= 0.75) return "success";
  if (confidence >= 0.55) return "info";
  return "warning";
}

function aiWarningTone(severity: AiWizardPlan["warnings"][number]["severity"]) {
  if (severity === "critical") return "critical" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
}

function aiStringValues(values: unknown) {
  return Array.isArray(values)
    ? uniqueSortedValues(
        values.filter((value): value is string => typeof value === "string"),
      )
    : [];
}

function normalizeAiDisplayValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function aiUniqueDisplayItems<T extends { label: string; value: string }>(
  items: T[],
  limit = 8,
) {
  const unique = new Map<string, T>();
  items.forEach((item) => {
    const label = normalizeAiDisplayValue(item.label);
    const value = normalizeAiDisplayValue(item.value);
    if (!label || !value) return;
    const key = `${label.toLowerCase()}::${value.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, { ...item, label, value });
  });
  return [...unique.values()].slice(0, limit);
}

function aiFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function aiSuggestedFilterValues(
  plan: AiWizardPlan,
  field: AiWizardPlan["suggestedFilters"][number]["field"],
) {
  return uniqueSortedValues(
    plan.suggestedFilters
      .filter((filter) => filter.field === field)
      .flatMap((filter) => aiStringValues(filter.values)),
  );
}

function aiMergeFilterValues(...values: string[][]) {
  return uniqueSortedValues(values.flatMap((value) => value));
}

function aiPresetDetails(plan: AiWizardPlan): PresetDetails {
  const details = plan.prefill.presetDetails ?? AI_EMPTY_PRESET_DETAILS;
  const filters = plan.prefill.productFilters;
  const vendors = aiMergeFilterValues(
    aiStringValues(details.vendor.vendors),
    aiStringValues(filters.vendors),
    aiSuggestedFilterValues(plan, "vendor"),
  );
  const productTypes = aiMergeFilterValues(
    aiStringValues(details.vendor.productTypes),
    aiStringValues(details.oos.productTypes),
    aiStringValues(details.spring.productTypes),
    aiStringValues(filters.types),
    aiSuggestedFilterValues(plan, "productType"),
  );
  const tags = aiMergeFilterValues(
    aiStringValues(details.seasonal.tags),
    aiStringValues(details.oos.tags),
    aiStringValues(details.spring.tags),
    aiStringValues(filters.tags),
    aiSuggestedFilterValues(plan, "tag"),
  );
  const collectionIds = aiMergeFilterValues(
    aiStringValues(details.seasonal.collectionIds),
    aiStringValues(filters.collectionIds),
  );
  const collectionTitles = aiMergeFilterValues(
    aiStringValues(details.seasonal.collectionTitles),
    aiStringValues(filters.collectionTitles),
    aiSuggestedFilterValues(plan, "collection"),
  );
  const seasonalKeyword = aiFirstString(
    details.seasonal.keywords,
    filters.season,
    filters.q,
    aiSuggestedFilterValues(plan, "season")[0],
    aiSuggestedFilterValues(plan, "query")[0],
  );

  return {
    seasonal: {
      keywords: seasonalKeyword,
      collectionIds,
      collectionTitles: collectionIds.length
        ? collectionTitles.slice(0, collectionIds.length)
        : [],
      tags,
      inventory: aiFirstString(filters.inventory),
    },
    vendor: {
      vendors,
      productTypes,
    },
    oos: {
      updated: aiFirstString(filters.updated),
      productTypes,
      tags,
    },
    spring: {
      tags,
      inventory: aiFirstString(filters.inventory),
      updated: aiFirstString(filters.updated),
      productTypes,
    },
  };
}

function aiProductTargetingPrefill(
  plan: AiWizardPlan,
  presetDetails: PresetDetails,
): ProductTargetingPrefill {
  const filters = plan.prefill.productFilters;
  const q = aiFirstString(
    filters.q,
    filters.season,
    presetDetails.seasonal.keywords,
  );
  const inventory = aiFirstString(filters.inventory);
  const tab = aiFirstString(filters.tab) || productScopeForInventory(inventory);
  const collectionIds = aiMergeFilterValues(
    aiStringValues(filters.collectionIds),
    presetDetails.seasonal.collectionIds,
  );
  const filterCollectionTitles = aiStringValues(filters.collectionTitles);
  const collectionTitles = collectionIds.length
    ? (filterCollectionTitles.length
        ? filterCollectionTitles
        : aiStringValues(presetDetails.seasonal.collectionTitles)
      ).slice(0, collectionIds.length)
    : [];
  const collectionTitlePatterns = filterCollectionTitles.slice(
    collectionTitles.length,
  );

  return {
    key: `${plan.userGoal}:${plan.nextStep}:${JSON.stringify(filters)}`,
    q,
    vendors: aiMergeFilterValues(
      aiStringValues(filters.vendors),
      presetDetails.vendor.vendors,
    ),
    collectionIds,
    collectionTitles,
    collectionTitlePatterns,
    types: aiMergeFilterValues(
      aiStringValues(filters.types),
      presetDetails.vendor.productTypes,
      presetDetails.oos.productTypes,
      presetDetails.spring.productTypes,
    ),
    tags: aiMergeFilterValues(
      aiStringValues(filters.tags),
      presetDetails.seasonal.tags,
      presetDetails.oos.tags,
      presetDetails.spring.tags,
    ),
    taxonomyJoin: normalizeTaxonomyJoinValue(filters.taxonomyJoin),
    vendorJoin: normalizeTaxonomyValueJoinValue(filters.vendorJoin),
    collectionJoin: normalizeTaxonomyValueJoinValue(filters.collectionJoin),
    typeJoin: normalizeTaxonomyValueJoinValue(filters.typeJoin),
    tagJoin: normalizeTaxonomyValueJoinValue(filters.tagJoin),
    inventory,
    inventoryValue:
      typeof filters.inventoryValue === "number"
        ? String(filters.inventoryValue)
        : aiFirstString(filters.inventoryValue),
    updated: aiFirstString(filters.updated),
    tab,
  };
}

function aiProductSelectionSubset(plan: AiWizardPlan) {
  const text = plan.userGoal.toLowerCase();
  const countMatch =
    text.match(
      /\b(?:only|just|limit(?:ed to)?|solo|solamente|limitar(?: a)?)\D{0,12}(\d{1,3})\s+(?:products?|items?|productos?|art[ií]culos)\b/,
    ) ??
    text.match(
      /\b(?:first|top|primeros|primeras)\s+(\d{1,3})(?:\s+(?:products?|items?|productos?|art[ií]culos))?\b/,
    ) ??
    text.match(
      /\b(?:last|bottom|ultimos|ultimas|últimos|últimas)\s+(\d{1,3})\s+(?:products?|items?|productos?|art[ií]culos)\b/,
    ) ??
    text.match(/\b(\d{1,3})\s+(?:products?|items?|productos?|art[ií]culos)\b/);
  const hasSubsetIntent = Boolean(
    countMatch ||
    /\b(?:some|sample|random|algunos|algunas|muestra|aleatorio|aleatoria)\s+(?:products?|items?|productos?|art[ií]culos)\b/.test(
      text,
    ) ||
    /\b(?:first|top|primeros|primeras)\s+(?:products?|items?|productos?|art[ií]culos)\b/.test(
      text,
    ) ||
    /\b(?:last|bottom|ultimos|ultimas|últimos|últimas)\s+(?:products?|items?|productos?|art[ií]culos)\b/.test(
      text,
    ) ||
    /\b(?:middle (?:products?|items?)|productos? del medio|art[ií]culos del medio|del medio)\b/.test(
      text,
    ),
  );

  if (!hasSubsetIntent) return null;

  const count = countMatch?.[1]
    ? Math.max(1, Math.min(MAX_PRODUCTS_PER_CLEANUP_RUN, Number(countMatch[1])))
    : null;
  const position =
    /\b(?:last|bottom|ultimos|ultimas|últimos|últimas)\s+(?:\d{1,3}\s+)?(?:products?|items?|productos?|art[ií]culos)\b/.test(
      text,
    )
      ? "last"
      : /\b(middle (?:products?|items?)|productos? del medio|art[ií]culos del medio|del medio)\b/.test(
            text,
          )
        ? "middle"
        : "first";

  return {
    count,
    position,
  };
}

function aiProductIdsForSubset(
  products: AiWizardPlan["productMatchPreview"]["products"],
  subset: ReturnType<typeof aiProductSelectionSubset>,
) {
  const ids = products
    .slice(0, MAX_PRODUCTS_PER_CLEANUP_RUN)
    .map((product) => product.id)
    .filter(Boolean);
  if (!subset?.count) return ids;
  if (subset.position === "last") return ids.slice(-subset.count);
  if (subset.position === "middle") {
    const start = Math.max(0, Math.floor((ids.length - subset.count) / 2));
    return ids.slice(start, start + subset.count);
  }
  return ids.slice(0, subset.count);
}

function aiProductStatus(status: string): ProductRow["status"] {
  const normalized = status.toLowerCase();
  if (normalized === "archived" || normalized === "draft") return normalized;
  return "active";
}

function aiProductToRow(
  product: AiWizardPlan["productMatchPreview"]["products"][number],
): ProductRow {
  return {
    id: product.id,
    name: product.name || product.handle || product.id,
    handle: product.handle || product.id.split("/").pop() || product.id,
    status: aiProductStatus(product.status),
    vendor: product.vendor || "",
    type: product.productType || "",
    inventory: product.inventory,
    sku: "",
    imageUrl: "",
    imageAlt: product.name || "Product",
    collections: aiStringValues(product.collections),
    tags: aiStringValues(product.tags),
    createdAt: null,
    updatedAt: null,
  };
}

function aiProductToDisplayRow(
  product: AiWizardPlan["productMatchPreview"]["products"][number],
): AiWizardProductDisplayRow {
  return {
    id: product.id,
    name: product.name || product.handle || product.id,
    handle: product.handle || product.id.split("/").pop() || product.id,
    status: product.status || "status unknown",
    vendor: product.vendor || "",
    productType: product.productType || "",
    inventory: product.inventory,
    collections: aiStringValues(product.collections),
    tags: aiStringValues(product.tags),
  };
}

function productRowToAiDisplayRow(
  product: ProductRow,
): AiWizardProductDisplayRow {
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

function defaultAiSelectedProductIds(plan: AiWizardPlan): AiSelectedProductIds {
  return new Set(
    aiProductIdsForSubset(
      plan.productMatchPreview.products,
      aiProductSelectionSubset(plan),
    ),
  );
}

function aiSelectedProducts(
  plan: AiWizardPlan,
  selectedProductIds?: AiSelectedProductIds,
): SelectedProductMap {
  const productMap: SelectedProductMap = new Map();
  plan.productMatchPreview.products
    .slice(0, MAX_PRODUCTS_PER_CLEANUP_RUN)
    .forEach((product) => {
      if (selectedProductIds && !selectedProductIds.has(product.id)) return;
      if (product.id) productMap.set(product.id, aiProductToRow(product));
    });
  return productMap;
}

function selectedProductMapForSubset(
  products: SelectedProductMap,
  subset: ReturnType<typeof aiProductSelectionSubset>,
) {
  if (!subset?.count) return products;
  const entries = Array.from(products.entries());
  const middleStart = Math.max(
    0,
    Math.floor((entries.length - subset.count) / 2),
  );
  const selectedEntries =
    subset.position === "last"
      ? entries.slice(-subset.count)
      : subset.position === "middle"
        ? entries.slice(middleStart, middleStart + subset.count)
        : entries.slice(0, subset.count);
  return new Map(selectedEntries);
}

function aiPlanHasPreparedProductFilters(plan: AiWizardPlan) {
  return productTargetingPrefillHasFilters(
    aiProductTargetingPrefill(plan, aiPresetDetails(plan)),
  );
}

function aiPlanPreparationKey(plan: AiWizardPlan) {
  return `${plan.userGoal}:${plan.nextStep}:${plan.confidenceReason}:${JSON.stringify(plan.prefill.productFilters)}`;
}

function productTargetingPrefillHasFilters(prefill: ProductTargetingPrefill) {
  return Boolean(
    prefill.q.trim() ||
    prefill.inventory ||
    prefill.updated ||
    (prefill.tab && prefill.tab !== "all") ||
    prefill.vendors.length ||
    prefill.collectionIds.length ||
    prefill.collectionTitles.length ||
    prefill.collectionTitlePatterns.length ||
    prefill.types.length ||
    prefill.tags.length,
  );
}

function productTargetingPrefillParams(prefill: ProductTargetingPrefill) {
  const params = new URLSearchParams();
  params.set("first", String(MAX_PRODUCTS_PER_CLEANUP_RUN));
  params.set("bulk", "1");
  if (prefill.q.trim()) params.set("q", prefill.q.trim());
  if (prefill.tab && prefill.tab !== "all") params.set("tab", prefill.tab);
  prefill.vendors.forEach((item) => params.append("vendor", item));
  prefill.collectionIds.forEach((item) => params.append("collection", item));
  [...prefill.collectionTitles, ...prefill.collectionTitlePatterns].forEach(
    (item) => params.append("collectionTitle", item),
  );
  prefill.types.forEach((item) => params.append("type", item));
  prefill.tags.forEach((item) => params.append("tag", item));
  params.set("taxonomyJoin", prefill.taxonomyJoin);
  params.set("vendorJoin", prefill.vendorJoin);
  params.set("collectionJoin", prefill.collectionJoin);
  params.set("typeJoin", prefill.typeJoin);
  params.set("tagJoin", prefill.tagJoin);
  if (prefill.inventory) params.set("inventory", prefill.inventory);
  if (prefill.inventoryValue.trim()) {
    params.set("inventoryValue", prefill.inventoryValue.trim());
  }
  if (prefill.updated) params.set("updated", prefill.updated);
  return params;
}

async function loadAiProductsFromPreparedFilters(
  prefill: ProductTargetingPrefill,
  fallback: SelectedProductMap,
) {
  if (!productTargetingPrefillHasFilters(prefill)) return fallback;

  try {
    const response = await fetch(
      `/app/products?${productTargetingPrefillParams(prefill)}`,
    );
    if (!response.ok) return fallback;
    const data = (await response.json()) as ProductsLoaderData;
    const products = Array.isArray(data.products) ? data.products : [];
    if (!products.length) return fallback;
    return new Map(
      products
        .slice(0, MAX_PRODUCTS_PER_CLEANUP_RUN)
        .filter((product) => Boolean(product?.id))
        .map((product) => [product.id, product as ProductRow]),
    );
  } catch {
    return fallback;
  }
}

function aiRulesForPlan(
  plan: AiWizardPlan,
  preset: CleanupPreset,
  selectedProducts: SelectedProductMap,
  presetDetails: PresetDetails,
) {
  const sourceRules = plan.prefill.redirectRules.length
    ? plan.prefill.redirectRules
    : plan.suggestedRedirectRules;
  const normalizedRules = sourceRules.map((rule, index) =>
    normalizeRule({
      ...rule,
      id: rule.id || `ai-rule-${index + 1}`,
      enabled: rule.enabled,
      stopOnMatch: rule.stopOnMatch,
    }),
  );

  return normalizedRules.length
    ? normalizedRules
    : rulesForPreset(preset, { selectedProducts, presetDetails });
}

function aiFilterItems(plan: AiWizardPlan) {
  const filters = plan.prefill.productFilters;
  const vendors = aiStringValues(filters.vendors);
  const types = aiStringValues(filters.types);
  const tags = aiStringValues(filters.tags);
  const collectionIds = aiStringValues(filters.collectionIds);
  const collectionTitles = aiStringValues(filters.collectionTitles);
  const items = [
    filters.q && { label: "Search", value: filters.q },
    filters.season && { label: "Season", value: filters.season },
    filters.tab &&
      filters.tab !== "all" && { label: "Status", value: filters.tab },
    vendors.length && {
      label: "Vendors",
      value: selectedValueSummary(vendors, ""),
    },
    types.length && {
      label: "Product types",
      value: selectedValueSummary(types, ""),
    },
    tags.length && { label: "Tags", value: selectedValueSummary(tags, "") },
    (collectionIds.length || collectionTitles.length) && {
      label: "Collections",
      value: collectionTitles.length
        ? selectedValueSummary(collectionTitles, "")
        : `${collectionIds.length} selected`,
    },
    (filters.taxonomyJoin === "or" ||
      filters.vendorJoin === "all" ||
      filters.typeJoin === "all" ||
      filters.tagJoin === "all" ||
      filters.collectionJoin === "all") && {
      label: "Filter logic",
      value: [
        filters.taxonomyJoin === "or" ? "Any group" : "All groups",
        filters.vendorJoin === "all" ? "all vendors" : "",
        filters.typeJoin === "all" ? "all product types" : "",
        filters.tagJoin === "all" ? "all tags" : "",
        filters.collectionJoin === "all" ? "all collections" : "",
      ]
        .filter(Boolean)
        .join(", "),
    },
    filters.inventory && {
      label: "Inventory",
      value: inventoryFilterLabel(
        filters.inventory,
        String(filters.inventoryValue ?? ""),
      ),
    },
    filters.updated && {
      label: "Updated",
      value: optionLabel(UPDATED_OPTIONS, filters.updated) || filters.updated,
    },
  ].filter(Boolean) as { label: string; value: string }[];

  if (items.length) return aiUniqueDisplayItems(items);

  return aiUniqueDisplayItems(
    plan.suggestedFilters.map((filter) => ({
      label: getAiFilterLabel(filter.field),
      value: filter.values.length
        ? selectedValueSummary(filter.values, "")
        : filter.operator,
    })),
  );
}

function aiFilterRefinementOptions(plan: AiWizardPlan) {
  const optionMap = new Map<
    string,
    { id: string; label: string; value: string }
  >();

  aiUniqueDisplayItems(aiFilterItems(plan)).forEach((item, index) => {
    const key = `${item.label.toLowerCase()}::${item.value.toLowerCase()}`;
    optionMap.set(key, {
      id: `prefill-${index}`,
      label: item.label,
      value: item.value,
    });
  });

  plan.suggestedFilters.slice(0, 8).forEach((filter, index) => {
    const label = getAiFilterLabel(filter.field);
    const value = filter.values.length
      ? selectedValueSummary(filter.values, "")
      : filter.operator;
    const normalizedLabel = normalizeAiDisplayValue(label);
    const normalizedValue = normalizeAiDisplayValue(value);
    if (!normalizedLabel || !normalizedValue) return;
    const key = `${normalizedLabel.toLowerCase()}::${normalizedValue.toLowerCase()}`;
    if (!optionMap.has(key))
      optionMap.set(key, {
        id: `${filter.field}-${index}`,
        label: normalizedLabel,
        value: normalizedValue,
      });
  });

  return Array.from(optionMap.values()).slice(0, 8);
}

function getAiFilterLabel(
  field: AiWizardPlan["suggestedFilters"][number]["field"],
) {
  switch (field) {
    case "productType":
      return "Product types";
    case "updated":
      return "Updated";
    default:
      return field.charAt(0).toUpperCase() + field.slice(1);
  }
}

function aiScenarioForPlan(plan: AiWizardPlan) {
  const preset = aiPlanPreset(plan);
  return SCENARIOS.find((scenario) => scenario.id === preset) ?? null;
}

function aiDisplayRedirectTargets(plan: AiWizardPlan) {
  const unique = new Map<
    string,
    AiWizardPlan["suggestedRedirectTargets"][number]
  >();
  plan.suggestedRedirectTargets.forEach((target) => {
    const normalizedTarget = normalizeAiDisplayValue(target.target);
    const reason = normalizeAiDisplayValue(
      target.reason || target.validationReason,
    );
    if (!normalizedTarget || !reason) return;
    const key = `${target.targetKind}::${normalizedTarget.toLowerCase()}`;
    if (unique.has(key)) return;
    unique.set(key, {
      ...target,
      target: normalizedTarget,
      reason,
      validationReason: normalizeAiDisplayValue(target.validationReason),
    });
  });
  return [...unique.values()].slice(0, 4);
}

function aiRuleLine(rule: RedirectRule) {
  const normalizedRule = normalizeRule(rule);
  const fieldLabel = getOptionLabel(RULE_FIELD_OPTIONS, normalizedRule.field);
  const targetLabel = getOptionLabel(
    RULE_TARGET_OPTIONS,
    normalizedRule.target,
  );
  const matchValue = FIELD_CONFIG[normalizedRule.field].valuesDisabled
    ? "Any product"
    : normalizedRule.value || "Needs value";
  return `${fieldLabel}: ${matchValue} -> ${targetLabel}`;
}

function AiWizardStepCard({
  step,
  title,
  description,
  icon,
  complete = true,
  children,
  actions,
}: {
  step: number;
  title: string;
  description: string;
  icon: typeof InfoIcon;
  complete?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`rml-ai-step-card${complete ? " rml-ai-step-card--complete" : ""}`}
    >
      <div className="rml-ai-step-card__rail">
        <span className="rml-ai-step-card__check">
          <Icon source={complete ? CheckCircleIcon : icon} />
        </span>
        <span className="rml-ai-step-card__number">{step}</span>
      </div>
      <div className="rml-ai-step-card__body">
        <InlineStack
          align="space-between"
          gap="300"
          blockAlign="start"
          wrap={false}
        >
          <BlockStack gap="050">
            <Text variant="headingSm" as="h3">
              {title}
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              {description}
            </Text>
          </BlockStack>
          <span className="rml-ai-step-card__icon" aria-hidden="true">
            <Icon source={icon} />
          </span>
        </InlineStack>
        <div className="rml-ai-step-card__content">{children}</div>
        {actions ? (
          <div className="rml-ai-step-card__actions">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

function AiWizardConfidenceCard({
  plan,
  actionData,
}: {
  plan: AiWizardPlan;
  actionData?: AiWizardActionData;
}) {
  const confidence = aiConfidencePercent(plan.confidence);
  const confidenceTone = aiConfidenceTone(plan.confidence);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" gap="300" blockAlign="center">
          <BlockStack gap="050">
            <Text variant="headingSm" as="h2">
              AI suggested setup
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Generated from your catalog data. Review before applying.
            </Text>
          </BlockStack>
          <InlineStack gap="150" blockAlign="center">
            <Badge tone={confidenceTone}>{`${confidence}% confidence`}</Badge>
            {actionData?.ok && actionData.fallbackUsed ? (
              <Badge tone="info">Reviewed with fallback</Badge>
            ) : null}
          </InlineStack>
        </InlineStack>
        <ProgressBar
          progress={confidence}
          tone={confidenceTone === "warning" ? "critical" : "primary"}
          size="small"
        />
        <Text variant="bodySm" tone="subdued" as="p">
          {plan.confidenceReason || plan.safeExplanation}
        </Text>
      </BlockStack>
    </Card>
  );
}

function fallbackAiClarifyingQuestions(plan: AiWizardPlan) {
  const questions = plan.questions?.length
    ? plan.questions
    : ["Which catalog detail should I use to target this cleanup?"];

  return questions.slice(0, 3).map((question, index) => ({
    id: `clarify_${index + 1}`,
    questionType: "catalog_value" as const,
    question,
    selectionMode: "multiple" as const,
    options: [
      {
        id: "vendor",
        label: "Vendor",
        value: "Target a vendor.",
        description: "Use a real vendor from the catalog.",
      },
      {
        id: "tag_or_season",
        label: "Tag or season",
        value: "Target a tag or season.",
        description: "Use catalog tags or campaign labels.",
      },
      {
        id: "product_type",
        label: "Product type",
        value: "Target a product type.",
        description: "Use product type as the cleanup scope.",
      },
      {
        id: "ignore_and_continue",
        label: "Ignore and continue",
        value:
          "Ignore this question and continue with the best available filters.",
        description: "Continue with the current setup.",
      },
    ],
  }));
}

function aiClarifyingOptionIsIgnore(
  option: AiWizardPlan["clarifyingQuestions"][number]["options"][number],
) {
  const text =
    `${option.id} ${option.label} ${option.value} ${option.description}`.toLowerCase();
  return (
    option.id === "ignore_and_continue" ||
    ((/\b(ignore|ignorar)\b/.test(text) ||
      option.id.toLowerCase().includes("ignore")) &&
      /\b(continue|continuar|seguir adelante)\b/.test(text))
  );
}

const AI_DISALLOWED_CLARIFICATION_TEXT_PATTERN =
  /\b(confirm|confirmation|confirmar|confirmación|approve|approval|aplicar|apply|final|later|después|despues|review later|revisar después|revisar despues|decide later|decidir después|decidir despues|acceptable|aceptable|homepage|home page|all products|todos los productos|redirect destination|destino de redirecci[oó]n|destination strategy|estrategia de destino)\b/;

function aiClarifyingQuestionIsAllowed(
  question: AiWizardPlan["clarifyingQuestions"][number],
) {
  const text = `${question.questionType} ${question.question}`.toLowerCase();
  return (
    question.questionType !== "destination_strategy" &&
    question.questionType !== "cleanup_mode" &&
    question.questionType !== "manual_fallback" &&
    !AI_DISALLOWED_CLARIFICATION_TEXT_PATTERN.test(text)
  );
}

function aiClarifyingOptionIsResolutive(
  option: AiWizardPlan["clarifyingQuestions"][number]["options"][number],
  questionType: AiWizardPlan["clarifyingQuestions"][number]["questionType"],
) {
  if (aiClarifyingOptionIsIgnore(option)) return true;
  if (questionType === "destination_strategy") return false;
  const text =
    `${option.id} ${option.label} ${option.value} ${option.description}`.toLowerCase();
  if (
    AI_DISALLOWED_CLARIFICATION_TEXT_PATTERN.test(text) ||
    /\b(review|manual|later|before redirect|before setup|affected products|selected|specific)\b/.test(
      text,
    ) ||
    /\b(vendor|collection|product type|tag|season)\(s\)/.test(text)
  ) {
    return false;
  }
  if (questionType === "catalog_value" || questionType === "cleanup_scope") {
    return !/^(vendor|collection|product type|tag|season|tag or season|manual setup)$/i.test(
      option.label.trim(),
    );
  }
  return true;
}

function aiQuestionShouldAllowMultiple(
  question: AiWizardPlan["clarifyingQuestions"][number],
) {
  return ["cleanup_scope", "catalog_value", "timeframe", "inventory"].includes(
    question.questionType,
  );
}

function aiNormalizedClarifyingQuestions(
  questions: AiWizardPlan["clarifyingQuestions"],
) {
  return questions
    .filter(aiClarifyingQuestionIsAllowed)
    .map((question, questionIndex) => {
      const questionId =
        normalizeAiDisplayValue(question.id) || `clarify_${questionIndex + 1}`;
      const usedOptionIds = new Set<string>();
      const uniqueOptions = new Map<
        string,
        AiWizardPlan["clarifyingQuestions"][number]["options"][number]
      >();

      const optionsWithIgnore = [
        ...question.options,
        {
          id: "ignore_and_continue",
          label: "Ignore and continue",
          value:
            "Ignore this question and continue with the best available filters.",
          description: "Continue with the current setup.",
        },
      ];

      optionsWithIgnore.forEach((option, optionIndex) => {
        const label = normalizeAiDisplayValue(option.label);
        const value = normalizeAiDisplayValue(option.value);
        if (!label || !value) return;
        if (
          !aiClarifyingOptionIsIgnore({ ...option, label, value }) &&
          !aiClarifyingOptionIsResolutive(
            { ...option, label, value },
            question.questionType,
          )
        ) {
          return;
        }
        const isIgnore = aiClarifyingOptionIsIgnore({
          ...option,
          label,
          value,
        });
        const key = isIgnore
          ? "ignore_and_continue"
          : `${label.toLowerCase()}::${value.toLowerCase()}`;
        if (uniqueOptions.has(key)) return;
        const rawId =
          normalizeAiDisplayValue(option.id) ||
          `${questionId}_option_${optionIndex + 1}`;
        const id = isIgnore
          ? "ignore_and_continue"
          : usedOptionIds.has(rawId)
            ? `${rawId}_${optionIndex + 1}`
            : rawId;
        usedOptionIds.add(id);
        uniqueOptions.set(key, {
          id,
          label: isIgnore ? "Ignore and continue" : label,
          value: isIgnore
            ? "Ignore this question and continue with the best available filters."
            : value,
          description: isIgnore
            ? "Continue with the current setup."
            : normalizeAiDisplayValue(option.description) || value,
        });
      });

      return {
        ...question,
        id: questionId,
        question: normalizeAiDisplayValue(question.question),
        selectionMode:
          question.selectionMode === "multiple" ||
          aiQuestionShouldAllowMultiple(question)
            ? ("multiple" as const)
            : ("single" as const),
        options: (() => {
          const options = [...uniqueOptions.values()];
          const ignore = options.find(aiClarifyingOptionIsIgnore);
          const nonIgnore = options.filter(
            (option) => !aiClarifyingOptionIsIgnore(option),
          );
          return ignore
            ? [...nonIgnore.slice(0, 4), ignore]
            : nonIgnore.slice(0, 5);
        })(),
      };
    })
    .filter((question) => {
      const nonIgnoreOptions = question.options.filter(
        (option) => !aiClarifyingOptionIsIgnore(option),
      );
      return (
        question.question &&
        question.options.length >= 2 &&
        nonIgnoreOptions.length > 0
      );
    });
}

function aiClarifyingQuestions(plan: AiWizardPlan) {
  const questions = plan.clarifyingQuestions?.length
    ? plan.clarifyingQuestions
    : fallbackAiClarifyingQuestions(plan);
  return aiNormalizedClarifyingQuestions(questions);
}

function aiPlanNeedsClarification(plan: AiWizardPlan) {
  return (
    plan.nextStep === "ask_clarifying_question" &&
    aiClarifyingQuestions(plan).length > 0
  );
}

function aiClarificationsComplete(
  plan: AiWizardPlan,
  selections: AiClarifyingSelections,
) {
  const questions = aiClarifyingQuestions(plan);
  return (
    questions.length > 0 &&
    questions.every((question) => (selections[question.id] ?? []).length > 0)
  );
}

function buildAiClarificationAnswer(
  plan: AiWizardPlan,
  selections: AiClarifyingSelections,
) {
  const lines = aiClarifyingQuestions(plan).flatMap((question) => {
    const selectedIds = new Set(selections[question.id] ?? []);
    const selectedOptions = question.options.filter((option) =>
      selectedIds.has(option.id),
    );
    if (!selectedOptions.length) return [];

    const labels = selectedOptions.map((option) => option.label).join(", ");
    const values = selectedOptions.map((option) => option.value).join("; ");
    return [`- ${question.question}: ${labels}. ${values}`];
  });

  return lines.length ? `Clarification answers:\n${lines.join("\n")}` : "";
}

function buildAiClarificationDisplay(
  plan: AiWizardPlan,
  selections: AiClarifyingSelections,
) {
  const labels = aiClarifyingQuestions(plan).flatMap((question) => {
    const selectedIds = new Set(selections[question.id] ?? []);
    return question.options
      .filter((option) => selectedIds.has(option.id))
      .map((option) => option.label);
  });

  return labels.length ? labels.slice(0, 4).join(", ") : "Clarified";
}

function buildAiFilterRefinement({
  plan,
  selectedOptionIds,
  text,
}: {
  plan: AiWizardPlan;
  selectedOptionIds: Set<string>;
  text: string;
}) {
  const optionsById = new Map(
    aiFilterRefinementOptions(plan).map((option) => [option.id, option]),
  );
  const selectedOptions = Array.from(selectedOptionIds)
    .map((id) => optionsById.get(id))
    .filter((option): option is { id: string; label: string; value: string } =>
      Boolean(option),
    );
  const lines = [
    "Filter refinement only. Keep the cleanup intent and redirect destination strategy unless the filter changes require a different rule.",
    text.trim() ? `Merchant filter note: ${text.trim()}` : "",
    selectedOptions.length
      ? `Selected AI filter options: ${selectedOptions
          .map((option) => `${option.label}: ${option.value}`)
          .join("; ")}`
      : "",
  ].filter(Boolean);

  return lines.join("\n");
}

function AiWizardQuestionCard({
  plan,
  selections,
  loading,
  onSelectionsChange,
  onSubmit,
}: {
  plan: AiWizardPlan;
  selections: AiClarifyingSelections;
  loading: boolean;
  onSelectionsChange(value: AiClarifyingSelections): void;
  onSubmit(): void;
}) {
  const questions = aiClarifyingQuestions(plan);
  const allAnswered = aiClarificationsComplete(plan, selections);

  if (!questions.length) return null;

  const toggleOption = (
    questionId: string,
    optionId: string,
    selectionMode: "single" | "multiple",
  ) => {
    const current = selections[questionId] ?? [];
    const question = questions.find((item) => item.id === questionId);
    const option = question?.options.find((item) => item.id === optionId);
    const ignoreOptionId = question?.options.find(
      aiClarifyingOptionIsIgnore,
    )?.id;
    if (option && aiClarifyingOptionIsIgnore(option)) {
      onSelectionsChange({
        ...selections,
        [questionId]: current.includes(optionId) ? [] : [optionId],
      });
      return;
    }
    const next =
      selectionMode === "multiple"
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current.filter((id) => id !== ignoreOptionId), optionId]
        : [optionId];

    onSelectionsChange({
      ...selections,
      [questionId]: next,
    });
  };

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (allAnswered) onSubmit();
        }}
      >
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <span
              className="rml-ai-card-icon rml-ai-card-icon--warning"
              aria-hidden="true"
            >
              <Icon source={QuestionCircleIcon} />
            </span>
            <BlockStack gap="050">
              <Text variant="headingSm" as="h3">
                Clarify before setup
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                The request needs one more detail before AI can suggest a safe
                setup.
              </Text>
            </BlockStack>
          </InlineStack>
          <BlockStack gap="200">
            {questions.map((question) => (
              <fieldset className="rml-ai-choice-group" key={question.id}>
                <legend>
                  <Text variant="bodyMd" fontWeight="semibold" as="span">
                    {question.question}
                  </Text>
                </legend>
                {question.selectionMode === "multiple" ? (
                  <Text variant="bodySm" tone="subdued" as="p">
                    Choose all that apply.
                  </Text>
                ) : null}
                <div className="rml-ai-choice-options">
                  {question.options.map((option) => {
                    const selected = (selections[question.id] ?? []).includes(
                      option.id,
                    );
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`rml-ai-choice-button${
                          selected ? " rml-ai-choice-button--selected" : ""
                        }`}
                        aria-pressed={selected}
                        disabled={loading}
                        onClick={() =>
                          toggleOption(
                            question.id,
                            option.id,
                            question.selectionMode,
                          )
                        }
                      >
                        <span className="rml-ai-choice-button__label">
                          {option.label}
                        </span>
                        <span className="rml-ai-choice-button__description">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </BlockStack>
          <InlineStack align="end">
            <Button
              submit
              variant="primary"
              loading={loading}
              disabled={!allAnswered}
            >
              Update suggestion
            </Button>
          </InlineStack>
        </BlockStack>
      </form>
    </Card>
  );
}

function AiWizardWarnings({ plan }: { plan: AiWizardPlan }) {
  const lowConfidenceTargets = plan.suggestedRedirectTargets.filter(
    (target) =>
      target.confidence === "Low" || target.validationStatus === "invalid",
  );
  const warnings = [
    ...plan.warnings,
    ...lowConfidenceTargets.map((target) => ({
      severity:
        target.validationStatus === "invalid"
          ? ("critical" as const)
          : ("warning" as const),
      code: `target_${target.targetKind}`,
      message: `${target.target || "Destination"}: ${target.validationReason || target.reason}`,
    })),
  ];

  if (!warnings.length && !plan.assumptions.length) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <span
            className="rml-ai-card-icon rml-ai-card-icon--warning"
            aria-hidden="true"
          >
            <Icon source={AlertTriangleIcon} />
          </span>
          <BlockStack gap="050">
            <Text variant="headingSm" as="h3">
              Review warnings
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Check these before creating redirects.
            </Text>
          </BlockStack>
        </InlineStack>
        {warnings.length ? (
          <div className="rml-ai-warning-list">
            {warnings.slice(0, 5).map((warning, index) => (
              <div
                key={`${warning.code}-${index}`}
                className="rml-ai-warning-item"
              >
                <Badge tone={aiWarningTone(warning.severity)}>
                  {warning.severity}
                </Badge>
                <Text variant="bodySm" as="p">
                  {warning.message}
                </Text>
              </div>
            ))}
          </div>
        ) : null}
        {plan.assumptions.length ? (
          <BlockStack gap="150">
            <Text variant="bodySm" fontWeight="semibold" as="p">
              Assumptions
            </Text>
            <div className="rml-ai-chip-list">
              {plan.assumptions.slice(0, 4).map((assumption) => (
                <Tag key={assumption}>{assumption}</Tag>
              ))}
            </div>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function AiWizardCleanupTypeCard({
  plan,
  onApply,
}: {
  plan: AiWizardPlan;
  onApply(): void;
}) {
  const scenario = aiScenarioForPlan(plan);

  return (
    <AiWizardStepCard
      step={1}
      title="Detect cleanup type"
      description="AI suggested the closest cleanup path."
      icon={MagicIcon}
      actions={
        <Button size="slim" onClick={onApply}>
          Review cleanup type
        </Button>
      }
    >
      <div className="rml-ai-suggestion">
        {scenario ? (
          <span
            className="rml-ai-suggestion__scenario"
            style={scenarioStyle(scenario)}
            aria-hidden="true"
          >
            {scenario.icon}
          </span>
        ) : null}
        <BlockStack gap="050">
          <InlineStack gap="150" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" as="p">
              {scenario?.title ?? "Manual setup"}
            </Text>
            <Badge tone="success">Selected</Badge>
          </InlineStack>
          <Text variant="bodySm" tone="subdued" as="p">
            {scenario?.description ??
              "AI did not select a preset. You can continue manually."}
          </Text>
        </BlockStack>
      </div>
    </AiWizardStepCard>
  );
}

function AiWizardFiltersCard({
  plan,
  onApply,
}: {
  plan: AiWizardPlan;
  onApply(): void;
}) {
  const filters = aiFilterItems(plan);

  return (
    <AiWizardStepCard
      step={2}
      title="Prefill filters"
      description={
        filters.length
          ? "AI found catalog filters that match your request."
          : "No specific filters were found."
      }
      icon={SearchIcon}
      actions={
        <Button size="slim" icon={EditIcon} onClick={onApply}>
          Review products
        </Button>
      }
    >
      {filters.length ? (
        <div className="rml-ai-filter-grid">
          {filters.map((filter) => (
            <div
              key={`${filter.label}-${filter.value}`}
              className="rml-ai-filter-token"
            >
              <Text variant="bodySm" tone="subdued" as="span">
                {filter.label}
              </Text>
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                {filter.value}
              </Text>
            </div>
          ))}
        </div>
      ) : (
        <Text variant="bodySm" tone="subdued" as="p">
          Start with the suggested cleanup type, then tune filters manually.
        </Text>
      )}
    </AiWizardStepCard>
  );
}

function AiWizardProductDetailsPopover({
  product,
}: {
  product: AiWizardProductDisplayRow;
}) {
  const [active, setActive] = useState(false);
  return (
    <Popover
      active={active}
      activator={
        <Button
          size="slim"
          variant="tertiary"
          icon={InfoIcon}
          accessibilityLabel={`View details for ${product.name || product.handle}`}
          onClick={() => setActive((current) => !current)}
        />
      }
      onClose={() => setActive(false)}
    >
      <div className="rml-ai-product-popover">
        <BlockStack gap="200">
          <BlockStack gap="050">
            <Text variant="bodySm" tone="subdued" as="span">
              Handle
            </Text>
            <Text variant="bodySm" as="span">
              /products/{product.handle || "-"}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text variant="bodySm" tone="subdued" as="span">
              Product ID
            </Text>
            <Text variant="bodySm" as="span">
              {product.id}
            </Text>
          </BlockStack>
          <BlockStack gap="100">
            <Text variant="bodySm" tone="subdued" as="span">
              Collections
            </Text>
            <div className="rml-ai-product-token-list">
              {product.collections.length ? (
                product.collections.map((collection) => (
                  <Tag key={`${product.id}-collection-${collection}`}>
                    {collection}
                  </Tag>
                ))
              ) : (
                <Text variant="bodySm" tone="subdued" as="span">
                  No collections returned
                </Text>
              )}
            </div>
          </BlockStack>
          <BlockStack gap="100">
            <Text variant="bodySm" tone="subdued" as="span">
              Tags
            </Text>
            <div className="rml-ai-product-token-list">
              {product.tags.length ? (
                product.tags.map((tag) => (
                  <Tag key={`${product.id}-tag-${tag}`}>{tag}</Tag>
                ))
              ) : (
                <Text variant="bodySm" tone="subdued" as="span">
                  No tags returned
                </Text>
              )}
            </div>
          </BlockStack>
        </BlockStack>
      </div>
    </Popover>
  );
}

function AiWizardProductsCard({
  plan,
  preparedProducts,
  selectedProductIds,
  onSelectedProductIdsChange,
  onApply,
}: {
  plan: AiWizardPlan;
  preparedProducts: SelectedProductMap;
  selectedProductIds: AiSelectedProductIds;
  onSelectedProductIdsChange(ids: AiSelectedProductIds): void;
  onApply(): void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const preparedRows = Array.from(preparedProducts.values()).map(
    productRowToAiDisplayRow,
  );
  const products = (
    preparedRows.length
      ? preparedRows
      : plan.productMatchPreview.products.map(aiProductToDisplayRow)
  ).slice(0, MAX_PRODUCTS_PER_CLEANUP_RUN);
  const previewProducts = products.slice(0, 4);
  const estimatedTotal = products.length
    ? formatAiNumber(
        preparedRows.length || plan.productMatchPreview.estimatedTotal,
      )
    : "0";
  const usingPreparedProducts = preparedRows.length > 0;
  const selectedCount = products.filter((product) =>
    selectedProductIds.has(product.id),
  ).length;

  const toggleProduct = (productId: string, selected: boolean) => {
    const next = new Set(selectedProductIds);
    if (selected) next.add(productId);
    else next.delete(productId);
    onSelectedProductIdsChange(next);
  };

  const selectAll = () => {
    onSelectedProductIdsChange(
      new Set(products.map((product) => product.id).filter(Boolean)),
    );
  };

  const deselectAll = () => {
    onSelectedProductIdsChange(new Set());
  };

  return (
    <>
      <AiWizardStepCard
        step={3}
        title="Review matching products"
        description="These are real catalog matches returned by the preview."
        icon={ProductIcon}
        actions={
          <InlineStack gap="150" align="end">
            <Button
              size="slim"
              disabled={!products.length}
              onClick={() => setModalOpen(true)}
            >
              Review matched products
            </Button>
            <Button size="slim" icon={EditIcon} onClick={onApply}>
              Open product step
            </Button>
          </InlineStack>
        }
      >
        {!products.length ? (
          <Banner tone="warning" title="No products matched">
            Open the product step to broaden filters, search manually, or select
            products before opening Summary.
          </Banner>
        ) : null}
        {usingPreparedProducts ? (
          <Badge tone="success">Loaded from prepared filters</Badge>
        ) : null}
        <div className="rml-ai-impact-grid">
          <div>
            <Text variant="bodySm" tone="subdued" as="p">
              Products matched
            </Text>
            <Text variant="headingMd" as="p">
              {estimatedTotal}
            </Text>
          </div>
          <div>
            <Text variant="bodySm" tone="subdued" as="p">
              Selected preview
            </Text>
            <Text variant="headingMd" as="p">
              {formatAiNumber(selectedCount)} /{" "}
              {formatAiNumber(products.length)}
            </Text>
          </div>
        </div>
        {plan.productMatchPreview.querySummary ? (
          <Text variant="bodySm" tone="subdued" as="p">
            {plan.productMatchPreview.querySummary}
          </Text>
        ) : null}
        {previewProducts.length ? (
          <div className="rml-ai-product-list">
            {previewProducts.map((product) => (
              <div key={product.id} className="rml-ai-product-row">
                <span className="rml-ai-product-row__icon" aria-hidden="true">
                  <Icon source={ProductIcon} />
                </span>
                <BlockStack gap="025">
                  <Text variant="bodySm" fontWeight="semibold" as="p">
                    {truncateProductTitle(product.name, 42)}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    {compactValues([product.vendor, product.productType]) ||
                      `/products/${product.handle}`}
                  </Text>
                </BlockStack>
              </div>
            ))}
          </div>
        ) : (
          <Text variant="bodySm" tone="subdued" as="p">
            No product sample was returned. Review product filters or select
            products manually before continuing.
          </Text>
        )}
        {plan.productMatchPreview.bulkLimited ? (
          <Badge tone="info">Preview limited to cleanup run size</Badge>
        ) : null}
      </AiWizardStepCard>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Review matching products"
        size="large"
        primaryAction={{
          content: "Save product selection",
          onAction: () => setModalOpen(false),
        }}
        secondaryActions={[
          {
            content: "Select all",
            onAction: selectAll,
          },
          {
            content: "Deselect all",
            onAction: deselectAll,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodyMd" tone="subdued" as="p">
                Deselect products that should not be included in the prepared
                cleanup.
              </Text>
              <Badge tone={selectedCount ? "success" : "warning"}>
                {`${selectedCount} selected`}
              </Badge>
            </InlineStack>
            {products.length ? (
              <div className="rml-ai-product-modal-list">
                <div className="rml-ai-product-modal-header" aria-hidden="true">
                  <span />
                  <span>Product</span>
                  <span>Status</span>
                  <span>Vendor</span>
                  <span>Type</span>
                  <span>Inventory</span>
                  <span />
                </div>
                {products.map((product) => {
                  const selected = selectedProductIds.has(product.id);
                  return (
                    <div
                      key={product.id}
                      className={`rml-ai-product-modal-row${
                        selected ? " rml-ai-product-modal-row--selected" : ""
                      }`}
                    >
                      <Checkbox
                        label={product.name || product.handle || product.id}
                        labelHidden
                        checked={selected}
                        onChange={(checked) =>
                          toggleProduct(product.id, checked)
                        }
                      />
                      <div className="rml-ai-product-modal-main">
                        <Text variant="bodySm" fontWeight="semibold" as="p">
                          {truncateProductTitle(
                            product.name || product.handle || product.id,
                            44,
                          )}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="p">
                          /products/{product.handle || "-"}
                        </Text>
                      </div>
                      <Badge>{product.status || "status unknown"}</Badge>
                      <span className="rml-ai-product-modal-cell">
                        {product.vendor || "-"}
                      </span>
                      <span className="rml-ai-product-modal-cell">
                        {product.productType || "-"}
                      </span>
                      <span className="rml-ai-product-modal-cell">
                        {product.inventory === null
                          ? "Not tracked"
                          : formatAiNumber(product.inventory)}
                      </span>
                      <AiWizardProductDetailsPopover product={product} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <Text variant="bodyMd" tone="subdued" as="p">
                No matching products were returned by the AI preview.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

function AiWizardRulesCard({
  plan,
  selectedProductIds,
  loading,
  onApply,
  onSubmitFilterRefinement,
}: {
  plan: AiWizardPlan;
  selectedProductIds: AiSelectedProductIds;
  loading: boolean;
  onApply(): void;
  onSubmitFilterRefinement(text: string, selectedOptionIds: Set<string>): void;
}) {
  const [filterText, setFilterText] = useState("");
  const [selectedFilterOptionIds, setSelectedFilterOptionIds] = useState<
    Set<string>
  >(() => new Set());
  const preset = aiPlanPreset(plan);
  const products = aiSelectedProducts(plan, selectedProductIds);
  const rules = aiRulesForPlan(
    plan,
    preset,
    products,
    aiPresetDetails(plan),
  ).slice(0, 4);
  const filterOptions = aiFilterRefinementOptions(plan);
  const canSubmitRefinement =
    filterText.trim().length > 0 || selectedFilterOptionIds.size > 0;

  useEffect(() => {
    setFilterText("");
    setSelectedFilterOptionIds(new Set());
  }, [plan.userGoal, plan.confidenceReason]);

  const toggleFilterOption = (optionId: string) => {
    setSelectedFilterOptionIds((current) => {
      const next = new Set(current);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const submitFilterRefinement = () => {
    if (!canSubmitRefinement) return;
    onSubmitFilterRefinement(filterText, selectedFilterOptionIds);
  };

  return (
    <AiWizardStepCard
      step={4}
      title="Suggest redirect rules"
      description="AI suggests destinations, then you can customize each rule."
      icon={DomainRedirectIcon}
      actions={
        <Button size="slim" icon={EditIcon} onClick={onApply}>
          Customize rules
        </Button>
      }
    >
      {rules.length ? (
        <div className="rml-ai-rule-list">
          {rules.map((rule, index) => (
            <div key={rule.id} className="rml-ai-rule-row">
              <span className="rml-ai-rule-row__number">{index + 1}</span>
              <Text variant="bodySm" as="p">
                {aiRuleLine(rule)}
              </Text>
            </div>
          ))}
        </div>
      ) : (
        <Text variant="bodySm" tone="subdued" as="p">
          No redirect rules were generated. Add rules manually before review.
        </Text>
      )}
      <div className="rml-ai-filter-refinement">
        <BlockStack gap="200">
          <Text variant="bodySm" fontWeight="semibold" as="p">
            Refine filters only
          </Text>
          <TextField
            label="Describe filter changes"
            labelHidden
            value={filterText}
            onChange={setFilterText}
            placeholder="Example: only include winter tags and exclude accessories"
            autoComplete="off"
            multiline={2}
          />
          {filterOptions.length ? (
            <div className="rml-ai-filter-option-grid">
              {filterOptions.map((option) => {
                const selected = selectedFilterOptionIds.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`rml-ai-filter-option${
                      selected ? " rml-ai-filter-option--selected" : ""
                    }`}
                    aria-pressed={selected}
                    disabled={loading}
                    onClick={() => toggleFilterOption(option.id)}
                  >
                    <span>{option.label}</span>
                    <strong>{option.value}</strong>
                  </button>
                );
              })}
            </div>
          ) : null}
          <InlineStack align="end">
            <Button
              size="slim"
              loading={loading}
              disabled={!canSubmitRefinement}
              onClick={submitFilterRefinement}
            >
              Update filter suggestions
            </Button>
          </InlineStack>
        </BlockStack>
      </div>
    </AiWizardStepCard>
  );
}

function AiWizardRedirectPreviewCard({
  plan,
  onApply,
}: {
  plan: AiWizardPlan;
  onApply(): void;
}) {
  const targets = aiDisplayRedirectTargets(plan);
  const previewCount =
    plan.redirectPreview.length || plan.productMatchPreview.sampledCount;

  return (
    <AiWizardStepCard
      step={5}
      title="Review redirects"
      description="Low confidence destinations stay visible for review."
      icon={TargetIcon}
      actions={
        <Button size="slim" onClick={onApply}>
          Open redirect review
        </Button>
      }
    >
      <div className="rml-ai-impact-grid">
        <div>
          <Text variant="bodySm" tone="subdued" as="p">
            Redirects previewed
          </Text>
          <Text variant="headingMd" as="p">
            {formatAiNumber(previewCount)}
          </Text>
        </div>
        <div>
          <Text variant="bodySm" tone="subdued" as="p">
            Warnings
          </Text>
          <Text variant="headingMd" as="p">
            {formatAiNumber(plan.warnings.length)}
          </Text>
        </div>
      </div>
      {targets.length ? (
        <div className="rml-ai-target-list">
          {targets.map((target) => (
            <div
              key={`${target.targetKind}-${target.target}`}
              className="rml-ai-target-row"
            >
              <BlockStack gap="025">
                <Text variant="bodySm" fontWeight="semibold" as="p">
                  {target.target || target.targetKind}
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  {target.reason}
                </Text>
              </BlockStack>
              <Badge
                tone={
                  target.validationStatus === "invalid"
                    ? "critical"
                    : target.confidence === "High"
                      ? "success"
                      : target.confidence === "Low"
                        ? "warning"
                        : "info"
                }
              >
                {target.validationStatus === "invalid"
                  ? "Invalid"
                  : target.confidence}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <Text variant="bodySm" tone="subdued" as="p">
          Open the normal redirect review to validate every destination.
        </Text>
      )}
    </AiWizardStepCard>
  );
}

function AiWizardFinalSummaryCard({
  plan,
  cleanupMode,
  selectedProductIds,
  setCleanupMode,
}: {
  plan: AiWizardPlan;
  cleanupMode: CleanupMode;
  selectedProductIds: AiSelectedProductIds;
  setCleanupMode(mode: CleanupMode): void;
}) {
  const selectedProductCount = selectedProductIds.size;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" gap="300" blockAlign="center">
          <BlockStack gap="050">
            <Text variant="headingSm" as="h3">
              Final plan summary
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Choose the cleanup mode now. Final confirmation still happens
              later.
            </Text>
          </BlockStack>
          <Badge tone="info">Review before applying</Badge>
        </InlineStack>
        <div className="rml-ai-summary-grid">
          <div>
            <Text variant="bodySm" tone="subdued" as="p">
              Products affected
            </Text>
            <Text variant="headingMd" as="p">
              {formatAiNumber(selectedProductCount)}
            </Text>
          </div>
          <div>
            <Text variant="bodySm" tone="subdued" as="p">
              Redirect rules
            </Text>
            <Text variant="headingMd" as="p">
              {formatAiNumber(
                plan.prefill.redirectRules.length ||
                  plan.suggestedRedirectRules.length,
              )}
            </Text>
          </div>
        </div>
        <div className="rml-ai-mode-grid">
          {AI_CLEANUP_MODE_OPTIONS.map((option) => {
            const selected = cleanupMode === option.id;
            return (
              <button
                key={option.id}
                className={`rml-ai-mode-card${selected ? " rml-ai-mode-card--selected" : ""}${
                  option.tone === "critical"
                    ? " rml-ai-mode-card--critical"
                    : ""
                }`}
                type="button"
                aria-pressed={selected}
                onClick={() => setCleanupMode(option.id)}
              >
                <span className="rml-ai-mode-card__icon" aria-hidden="true">
                  <Icon source={option.icon} />
                </span>
                <span className="rml-ai-mode-card__text">
                  <Text variant="bodySm" fontWeight="semibold" as="span">
                    {option.title}
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="span">
                    {option.description}
                  </Text>
                </span>
              </button>
            );
          })}
        </div>
      </BlockStack>
    </Card>
  );
}

function AiWizardPlanReview({
  plan,
  actionData,
  cleanupMode,
  clarifyingSelections,
  preparedProducts,
  selectedProductIds,
  loading,
  onCleanupModeChange,
  onClarifyingSelectionsChange,
  onSelectedProductIdsChange,
  onSubmitFilterRefinement,
  onSubmitClarification,
  onApplyPlan,
  onRegenerate,
}: {
  plan: AiWizardPlan;
  actionData?: AiWizardActionData;
  cleanupMode: CleanupMode;
  clarifyingSelections: AiClarifyingSelections;
  preparedProducts: SelectedProductMap;
  selectedProductIds: AiSelectedProductIds;
  loading: boolean;
  onCleanupModeChange(mode: CleanupMode): void;
  onClarifyingSelectionsChange(value: AiClarifyingSelections): void;
  onSelectedProductIdsChange(value: AiSelectedProductIds): void;
  onSubmitFilterRefinement(text: string, selectedOptionIds: Set<string>): void;
  onSubmitClarification(): void;
  onApplyPlan(step: WizardStep): void | Promise<void>;
  onRegenerate(): void;
}) {
  const needsClarification = aiPlanNeedsClarification(plan);

  return (
    <BlockStack gap="300">
      <AiWizardConfidenceCard plan={plan} actionData={actionData} />

      {needsClarification ? (
        <>
          <AiWizardQuestionCard
            plan={plan}
            selections={clarifyingSelections}
            loading={loading}
            onSelectionsChange={onClarifyingSelectionsChange}
            onSubmit={onSubmitClarification}
          />
          <AiWizardWarnings plan={plan} />
        </>
      ) : (
        <>
          <Card padding="0">
            <div className="rml-ai-step-list">
              <AiWizardCleanupTypeCard
                plan={plan}
                onApply={() => onApplyPlan("onboarding-2")}
              />
              <AiWizardFiltersCard
                plan={plan}
                onApply={() => onApplyPlan("products")}
              />
              <AiWizardProductsCard
                plan={plan}
                preparedProducts={preparedProducts}
                selectedProductIds={selectedProductIds}
                onSelectedProductIdsChange={onSelectedProductIdsChange}
                onApply={() => onApplyPlan("products")}
              />
              <AiWizardRulesCard
                plan={plan}
                selectedProductIds={selectedProductIds}
                loading={loading}
                onApply={() => onApplyPlan("rules")}
                onSubmitFilterRefinement={onSubmitFilterRefinement}
              />
              <AiWizardRedirectPreviewCard
                plan={plan}
                onApply={() => onApplyPlan("preview")}
              />
            </div>
          </Card>
          <AiWizardWarnings plan={plan} />
          <AiWizardFinalSummaryCard
            plan={plan}
            cleanupMode={cleanupMode}
            selectedProductIds={selectedProductIds}
            setCleanupMode={onCleanupModeChange}
          />
        </>
      )}

      <InlineStack gap="200" align="center">
        <Button
          size="slim"
          icon={RefreshIcon}
          loading={loading}
          onClick={onRegenerate}
        >
          Regenerate
        </Button>
        <Text variant="bodySm" tone="subdued" as="p">
          No changes are made until you confirm.
        </Text>
      </InlineStack>
    </BlockStack>
  );
}

function AiWizardLoadingState() {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <span className="rml-ai-card-icon" aria-hidden="true">
            <Icon source={MagicIcon} />
          </span>
          <BlockStack gap="050">
            <Text variant="headingSm" as="h3">
              Building setup
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Checking catalog data, products, redirects, and warnings.
            </Text>
          </BlockStack>
        </InlineStack>
        <ProgressBar progress={62} size="small" tone="primary" />
        <div className="rml-ai-loading-list" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </BlockStack>
    </Card>
  );
}

function AiWizardInputCard({
  prompt,
  loading,
  disabled,
  lastGoal,
  onPromptChange,
  onSubmit,
}: {
  prompt: string;
  loading: boolean;
  disabled?: boolean;
  lastGoal: string;
  onPromptChange(value: string): void;
  onSubmit(goal: string): void;
}) {
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);

  return (
    <Card>
      <BlockStack gap="300">
        {lastGoal ? (
          <div className="rml-ai-user-message">
            <InlineStack align="space-between" gap="200">
              <Text variant="bodySm" fontWeight="semibold" as="span">
                You
              </Text>
              <Text variant="bodySm" tone="subdued" as="span">
                Catalog request
              </Text>
            </InlineStack>
            <Text variant="bodyMd" as="p">
              {lastGoal}
            </Text>
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(prompt);
          }}
        >
          <BlockStack gap="300">
            <TextField
              label="Describe cleanup goal"
              value={prompt}
              onChange={onPromptChange}
              placeholder="Example: Remove products from Acme and redirect them to the closest collection"
              autoComplete="off"
              multiline={3}
            />
            <div className="rml-ai-example-list">
              {AI_WIZARD_EXAMPLES.map((example) => (
                <Popover
                  key={example.id}
                  active={activeExampleId === example.id}
                  onClose={() => setActiveExampleId(null)}
                  activator={
                    <span
                      className="rml-ai-example-activator"
                      onMouseEnter={() => setActiveExampleId(example.id)}
                      onMouseLeave={() => setActiveExampleId(null)}
                      onFocus={() => setActiveExampleId(example.id)}
                      onBlur={() => setActiveExampleId(null)}
                    >
                      <Button
                        size="slim"
                        icon={example.icon}
                        variant="tertiary"
                        disabled={disabled || loading}
                        accessibilityLabel={`Use ${example.label} prompt`}
                        onClick={() => onPromptChange(example.prompt)}
                      >
                        {example.label}
                      </Button>
                    </span>
                  }
                >
                  <div
                    className="rml-ai-example-popover"
                    onMouseEnter={() => setActiveExampleId(example.id)}
                    onMouseLeave={() => setActiveExampleId(null)}
                  >
                    <BlockStack gap="200">
                      <BlockStack gap="050">
                        <Text variant="bodySm" fontWeight="semibold" as="p">
                          {example.label}
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="p">
                          {example.description}
                        </Text>
                      </BlockStack>
                      <Text variant="bodySm" as="p">
                        {example.prompt}
                      </Text>
                      {example.tags?.length ? (
                        <InlineStack gap="100" wrap>
                          {example.tags.map((tag) => (
                            <Tag key={`${example.id}-${tag}`}>{tag}</Tag>
                          ))}
                        </InlineStack>
                      ) : null}
                    </BlockStack>
                  </div>
                </Popover>
              ))}
            </div>
            <InlineStack align="end">
              <Button
                submit
                variant="primary"
                icon={MagicIcon}
                loading={loading}
                disabled={disabled || !prompt.trim()}
              >
                Generate setup
              </Button>
            </InlineStack>
          </BlockStack>
        </form>
      </BlockStack>
    </Card>
  );
}

function AiWizardDrawer({
  onApplyPlan,
  preparedProducts,
  preparedPlanKey,
}: {
  onApplyPlan(
    plan: AiWizardPlan,
    step: WizardStep,
    cleanupMode: CleanupMode,
    selectedProductIds?: AiSelectedProductIds,
  ): void | Promise<void>;
  preparedProducts: SelectedProductMap;
  preparedPlanKey: string | null;
}) {
  const configFetcher = useFetcher<typeof aiWizardLoader>();
  const wizardFetcher = useFetcher<typeof aiWizardAction>();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [lastGoal, setLastGoal] = useState("");
  const [clarifyingSelections, setClarifyingSelections] =
    useState<AiClarifyingSelections>({});
  const [selectedProductIds, setSelectedProductIds] =
    useState<AiSelectedProductIds>(() => new Set());
  const [productSelectionTouched, setProductSelectionTouched] = useState(false);
  const [draftCleanupMode, setDraftCleanupMode] =
    useState<CleanupMode>("archive");
  const preparedPlanKeyRef = useRef<string | null>(null);
  const configData = configFetcher.data as AiWizardConfigData | undefined;
  const actionData = wizardFetcher.data as AiWizardActionData | undefined;
  const plan = actionData?.ok ? actionData.plan : null;
  const loading = wizardFetcher.state !== "idle";
  const errorMessage = actionData && !actionData.ok ? actionData.message : null;
  const canApplyPlan = Boolean(plan && !aiPlanNeedsClarification(plan));
  const preparedFiltersAvailable = plan
    ? aiPlanHasPreparedProductFilters(plan)
    : false;
  const planPreparationKey = plan ? aiPlanPreparationKey(plan) : null;
  const preparedProductsForPlan =
    planPreparationKey && preparedPlanKey === planPreparationKey
      ? preparedProducts
      : new Map<string, ProductRow>();
  const effectiveSelectedProductIds =
    plan && !productSelectionTouched
      ? preparedProductsForPlan.size
        ? new Set(preparedProductsForPlan.keys())
        : defaultAiSelectedProductIds(plan)
      : selectedProductIds;
  const canOpenPreparedReview =
    canApplyPlan &&
    (effectiveSelectedProductIds.size > 0 || preparedFiltersAvailable);
  const aiUnavailable = Boolean(configData?.ok && !configData.enabled);
  const aiUnavailableMessage =
    configData?.ok && configData.disabled
      ? "AI cleanup wizard is disabled for this shop. Use manual setup to continue."
      : configData?.ok && !configData.enabled
        ? "AI cleanup wizard is not configured. Add an OpenAI API key or use manual setup."
        : null;

  useEffect(() => {
    if (!open || configFetcher.state !== "idle" || configData) return;
    configFetcher.load("/app/ai-wizard");
  }, [configData, configFetcher, open]);

  useEffect(() => {
    if (plan) {
      setDraftCleanupMode(aiPlanCleanupMode(plan));
      setClarifyingSelections({});
      setProductSelectionTouched(false);
      setSelectedProductIds(defaultAiSelectedProductIds(plan));
    }
  }, [plan]);

  useEffect(() => {
    if (!plan || loading || aiPlanNeedsClarification(plan)) return;
    const planKey = aiPlanPreparationKey(plan);
    if (preparedPlanKeyRef.current === planKey) return;
    preparedPlanKeyRef.current = planKey;
    void onApplyPlan(plan, "products", aiPlanCleanupMode(plan));
  }, [loading, onApplyPlan, plan]);

  const submitGoal = (
    goal: string,
    displayGoal = goal,
    options: { previousPlan?: AiWizardPlan | null } = {},
  ) => {
    const nextGoal = goal.trim();
    if (!nextGoal || loading || aiUnavailable) return;
    setPrompt(nextGoal);
    setLastGoal(displayGoal.trim() || nextGoal);
    const formData = new FormData();
    formData.set("userGoal", nextGoal);
    if (options.previousPlan) {
      formData.set("previousPlan", JSON.stringify(options.previousPlan));
    }
    wizardFetcher.submit(formData, {
      method: "post",
      action: "/app/ai-wizard",
    });
  };

  const submitClarification = () => {
    if (!plan || !aiClarificationsComplete(plan, clarifyingSelections)) return;
    const clarificationAnswer = buildAiClarificationAnswer(
      plan,
      clarifyingSelections,
    );
    if (!clarificationAnswer.trim()) return;
    submitGoal(
      `${plan.userGoal}\n\n${clarificationAnswer}`,
      `${plan.userGoal} (${buildAiClarificationDisplay(plan, clarifyingSelections)})`,
      { previousPlan: plan },
    );
  };

  const submitFilterRefinement = (
    text: string,
    selectedOptionIds: Set<string>,
  ) => {
    if (!plan) return;
    const refinement = buildAiFilterRefinement({
      plan,
      selectedOptionIds,
      text,
    });
    if (!refinement.trim()) return;
    submitGoal(
      `${plan.userGoal}\n\n${refinement}`,
      `${plan.userGoal} (filter refinement)`,
      { previousPlan: plan },
    );
  };

  const applySuggestedSetup = async (targetStep?: WizardStep) => {
    if (!plan || !canApplyPlan) return;
    if (
      ["preview", "apply"].includes(
        targetStep ?? AI_WIZARD_REVIEW_STEP_BY_NEXT_STEP[plan.nextStep],
      ) &&
      effectiveSelectedProductIds.size === 0 &&
      !preparedFiltersAvailable
    ) {
      return;
    }
    await onApplyPlan(
      plan,
      targetStep ?? AI_WIZARD_REVIEW_STEP_BY_NEXT_STEP[plan.nextStep],
      draftCleanupMode,
      productSelectionTouched ? effectiveSelectedProductIds : undefined,
    );
    setOpen(false);
  };

  return (
    <>
      <div className="rml-ai-launcher">
        <Button
          icon={MagicIcon}
          variant="primary"
          onClick={() => setOpen(true)}
        >
          AI cleanup wizard
        </Button>
      </div>

      {open ? (
        <>
          <div
            className="rml-ai-backdrop"
            role="presentation"
            onClick={() => setOpen(false)}
          />
          <aside
            className="rml-ai-drawer"
            aria-label="AI cleanup wizard"
            aria-modal="true"
            role="dialog"
          >
            <div className="rml-ai-drawer__header">
              <InlineStack
                align="space-between"
                gap="300"
                blockAlign="start"
                wrap={false}
              >
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <span className="rml-ai-drawer__logo" aria-hidden="true">
                    <Icon source={MagicIcon} />
                  </span>
                  <BlockStack gap="050">
                    <InlineStack gap="150" blockAlign="center">
                      <Text variant="headingLg" as="h2">
                        AI Cleanup Wizard
                      </Text>
                      <Badge tone="success">Beta</Badge>
                    </InlineStack>
                    <Text variant="bodyMd" tone="subdued" as="p">
                      Your assistant for safe, effective redirects.
                    </Text>
                  </BlockStack>
                </InlineStack>
                <Button
                  icon={XIcon}
                  variant="tertiary"
                  accessibilityLabel="Close AI cleanup wizard"
                  onClick={() => setOpen(false)}
                />
              </InlineStack>
            </div>

            <div className="rml-ai-drawer__body">
              <BlockStack gap="300">
                {aiUnavailableMessage ? (
                  <Banner tone="warning" title="AI wizard unavailable">
                    {aiUnavailableMessage}
                  </Banner>
                ) : null}

                <AiWizardInputCard
                  prompt={prompt}
                  loading={loading}
                  disabled={aiUnavailable}
                  lastGoal={lastGoal}
                  onPromptChange={setPrompt}
                  onSubmit={submitGoal}
                />

                {loading ? <AiWizardLoadingState /> : null}

                {errorMessage && !loading ? (
                  <Banner tone="critical" title="AI setup is unavailable">
                    {errorMessage}
                  </Banner>
                ) : null}

                {plan && !loading ? (
                  <AiWizardPlanReview
                    plan={plan}
                    actionData={actionData}
                    cleanupMode={draftCleanupMode}
                    clarifyingSelections={clarifyingSelections}
                    preparedProducts={preparedProductsForPlan}
                    selectedProductIds={effectiveSelectedProductIds}
                    loading={loading}
                    onCleanupModeChange={setDraftCleanupMode}
                    onClarifyingSelectionsChange={setClarifyingSelections}
                    onSelectedProductIdsChange={(nextProductIds) => {
                      setProductSelectionTouched(true);
                      setSelectedProductIds(nextProductIds);
                    }}
                    onSubmitFilterRefinement={submitFilterRefinement}
                    onSubmitClarification={submitClarification}
                    onApplyPlan={applySuggestedSetup}
                    onRegenerate={() => submitGoal(plan.userGoal)}
                  />
                ) : null}

                {!plan && !loading && !errorMessage ? (
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <span className="rml-ai-card-icon" aria-hidden="true">
                          <Icon source={InfoIcon} />
                        </span>
                        <BlockStack gap="050">
                          <Text variant="headingSm" as="h3">
                            Start with a cleanup goal
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            AI will suggest a setup from real catalog data. You
                            can edit every step.
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ) : null}
              </BlockStack>
            </div>

            <div className="rml-ai-drawer__footer">
              <InlineStack gap="200" align="space-between" blockAlign="center">
                <Button onClick={() => setOpen(false)}>Use manual setup</Button>
                <Button
                  variant="primary"
                  icon={MagicIcon}
                  disabled={!canOpenPreparedReview}
                  onClick={() => void applySuggestedSetup("preview")}
                >
                  Review redirects before applying
                </Button>
              </InlineStack>
            </div>
          </aside>
        </>
      ) : null}
    </>
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
  const [presetDetails, setPresetDetails] = useState<PresetDetails>(
    DEFAULT_PRESET_DETAILS,
  );
  const [rules, setRules] = useState<RedirectRule[]>(() =>
    rulesForPreset("none", { presetDetails: DEFAULT_PRESET_DETAILS }),
  );
  const [reviewRows, setReviewRows] = useState<GeneratedPreviewRow[]>([]);
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>("archive");
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(
    null,
  );
  const [productTargetingPrefill, setProductTargetingPrefill] =
    useState<ProductTargetingPrefill | null>(null);
  const [aiPreparedPlanKey, setAiPreparedPlanKey] = useState<string | null>(
    null,
  );
  const go = (s: WizardStep) => () => setStep(s);

  // Combined setter: changing the preset always syncs the rules to match.
  const setPreset = useCallback(
    (preset: CleanupPreset) => {
      setProductTargetingPrefill(null);
      setSelectedPreset(preset);
      setRules(rulesForPreset(preset, { presetDetails }));
    },
    [presetDetails],
  );

  const applyAiPlan = useCallback(
    async (
      plan: AiWizardPlan,
      targetStep: WizardStep,
      cleanupModeOverride: CleanupMode,
      selectedProductIdsOverride?: AiSelectedProductIds,
    ) => {
      const preset = aiPlanPreset(plan);
      const nextPresetDetails = aiPresetDetails(plan);
      const nextProductTargetingPrefill = aiProductTargetingPrefill(
        plan,
        nextPresetDetails,
      );
      const subset = aiProductSelectionSubset(plan);
      const fallbackProductIds =
        selectedProductIdsOverride ??
        (subset
          ? new Set(
              aiProductIdsForSubset(plan.productMatchPreview.products, subset),
            )
          : undefined);
      const fallbackAiProducts = aiSelectedProducts(plan, fallbackProductIds);
      let nextSelectedProducts: SelectedProductMap;

      if (selectedProductIdsOverride !== undefined) {
        nextSelectedProducts = fallbackAiProducts;
      } else if (subset && !subset.count) {
        nextSelectedProducts = fallbackAiProducts;
      } else if (
        productTargetingPrefillHasFilters(nextProductTargetingPrefill)
      ) {
        const loadedProducts = await loadAiProductsFromPreparedFilters(
          nextProductTargetingPrefill,
          fallbackAiProducts,
        );
        nextSelectedProducts = subset?.count
          ? selectedProductMapForSubset(loadedProducts, subset)
          : loadedProducts;
      } else {
        nextSelectedProducts = fallbackAiProducts.size
          ? fallbackAiProducts
          : selectedProducts;
      }
      const nextRules = aiRulesForPlan(
        plan,
        preset,
        nextSelectedProducts,
        nextPresetDetails,
      );
      const nextReviewRows = buildPreviewRows(nextSelectedProducts, nextRules);

      setSelectedPreset(preset);
      setPresetDetails(nextPresetDetails);
      setProductTargetingPrefill(nextProductTargetingPrefill);
      if (
        selectedProductIdsOverride !== undefined ||
        nextSelectedProducts.size
      ) {
        setSelectedProducts(nextSelectedProducts);
      }
      setAiPreparedPlanKey(aiPlanPreparationKey(plan));
      setRules(nextRules);
      setCleanupMode(cleanupModeOverride);
      setReviewRows(nextReviewRows);
      setStep(targetStep);
    },
    [selectedProducts],
  );

  const stepMarkup = (() => {
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
            presetDetails={presetDetails}
            setPresetDetails={setPresetDetails}
          />
        );
      case "products":
        return (
          <ProductsStep
            onBack={go("onboarding-2")}
            onNext={() => {
              setRules(
                rulesForPreset(selectedPreset, {
                  selectedProducts,
                  presetDetails,
                }),
              );
              setStep("rules");
            }}
            selectedProducts={selectedProducts}
            setSelectedProducts={setSelectedProducts}
            selectedPreset={selectedPreset}
            setSelectedPreset={setPreset}
            presetDetails={presetDetails}
            setPresetDetails={setPresetDetails}
            productTargetingPrefill={productTargetingPrefill}
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
            presetDetails={presetDetails}
            setPresetDetails={setPresetDetails}
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
        return <SuccessStep result={cleanupResult} rows={reviewRows} />;
    }
  })();

  return (
    <>
      {stepMarkup}
      <AiWizardDrawer
        onApplyPlan={applyAiPlan}
        preparedProducts={selectedProducts}
        preparedPlanKey={aiPreparedPlanKey}
      />
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
