import type {
  CleanupMode,
  CleanupPreset,
  GeneratedPreviewRow,
  PresetDetails,
  RedirectRule,
} from "./cleanup-rules";
import type { CleanupProductFilters } from "./shopify-catalog.server";

export type AiCleanupIntent =
  | "vendor_exit"
  | "seasonal_cleanup"
  | "out_of_stock_cleanup"
  | "discontinued_cleanup"
  | "spring_cleaning"
  | "redirect_repair"
  | "unknown";

export type AiPlanNextStep =
  | "ask_clarifying_question"
  | "prefill_cleanup_type"
  | "prefill_product_filters"
  | "prefill_redirect_rules"
  | "review_redirects"
  | "ready_for_merchant_review";

export type AiSuggestedFilter = {
  field:
    | "query"
    | "season"
    | "vendor"
    | "productType"
    | "collection"
    | "tag"
    | "inventory"
    | "updated"
    | "status";
  operator: string;
  values: string[];
  source: "merchant_intent" | "catalog_lookup" | "tool_preview" | "assumption";
  shopifyQueryFragment: string | null;
};

export type AiPreviewProduct = {
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

export type AiRedirectTargetSuggestion = {
  target: string;
  targetKind:
    | "collection"
    | "search"
    | "all_products"
    | "homepage"
    | "custom_path"
    | "external"
    | "skip"
    | "unknown";
  confidence: "High" | "Medium" | "Low";
  reason: string;
  validationStatus: "valid" | "invalid" | "unchecked" | "skipped";
  validationReason: string;
};

export type AiWizardWarning = {
  severity: "critical" | "warning" | "info";
  code: string;
  message: string;
};

export type AiClarifyingQuestionOption = {
  id: string;
  label: string;
  value: string;
  description: string;
};

export type AiClarifyingQuestion = {
  id: string;
  questionType:
    | "cleanup_scope"
    | "catalog_value"
    | "destination_strategy"
    | "cleanup_mode"
    | "timeframe"
    | "inventory"
    | "manual_fallback"
    | "other";
  question: string;
  selectionMode: "single" | "multiple";
  options: AiClarifyingQuestionOption[];
};

export type AiWizardPrefill = {
  cleanupMode: CleanupMode | "unknown";
  cleanupPreset: CleanupPreset | "unknown";
  presetDetails: PresetDetails;
  productFilters: Required<
    Pick<
      CleanupProductFilters,
      | "q"
      | "season"
      | "inventory"
      | "inventoryValue"
      | "updated"
      | "vendors"
      | "types"
      | "tags"
      | "collectionIds"
      | "collectionTitles"
      | "taxonomyJoin"
      | "vendorJoin"
      | "typeJoin"
      | "tagJoin"
      | "collectionJoin"
      | "tab"
    >
  >;
  redirectRules: RedirectRule[];
};

export type AiWizardPlan = {
  schemaVersion: "ai_wizard_plan_v1";
  userGoal: string;
  detectedCleanupIntent: AiCleanupIntent;
  cleanupType: CleanupMode | "unknown";
  cleanupPreset: CleanupPreset | "unknown";
  confidence: number;
  confidenceReason: string;
  suggestedFilters: AiSuggestedFilter[];
  productMatchPreview: {
    estimatedTotal: number | null;
    sampledCount: number;
    bulkLimited: boolean;
    querySummary: string;
    products: AiPreviewProduct[];
  };
  suggestedRedirectRules: RedirectRule[];
  suggestedRedirectTargets: AiRedirectTargetSuggestion[];
  redirectPreview: GeneratedPreviewRow[];
  warnings: AiWizardWarning[];
  assumptions: string[];
  questions: string[];
  clarifyingQuestions: AiClarifyingQuestion[];
  nextStep: AiPlanNextStep;
  safeExplanation: string;
  prefill: AiWizardPrefill;
  requiresReview: boolean;
  requiresExplicitConfirmation: boolean;
  mustNotApplyAutomatically: boolean;
  fallbackRecommended: boolean;
};

const stringArray = {
  type: "array",
  items: { type: "string" },
};

const nullableString = {
  type: ["string", "null"],
};

const nullableNumber = {
  type: ["number", "null"],
};

const clarifyingQuestionOptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "value", "description"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    value: { type: "string" },
    description: { type: "string" },
  },
};

const clarifyingQuestionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "questionType", "question", "selectionMode", "options"],
  properties: {
    id: { type: "string" },
    questionType: {
      type: "string",
      enum: [
        "cleanup_scope",
        "catalog_value",
        "destination_strategy",
        "cleanup_mode",
        "timeframe",
        "inventory",
        "manual_fallback",
        "other",
      ],
    },
    question: { type: "string" },
    selectionMode: { type: "string", enum: ["single", "multiple"] },
    options: {
      type: "array",
      items: clarifyingQuestionOptionSchema,
    },
  },
};

const redirectRuleSchema = {
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

const presetDetailsSchema = {
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
        collectionIds: stringArray,
        collectionTitles: stringArray,
        tags: stringArray,
        inventory: { type: "string" },
      },
    },
    vendor: {
      type: "object",
      additionalProperties: false,
      required: ["vendors", "productTypes"],
      properties: {
        vendors: stringArray,
        productTypes: stringArray,
      },
    },
    oos: {
      type: "object",
      additionalProperties: false,
      required: ["updated", "productTypes", "tags"],
      properties: {
        updated: { type: "string" },
        productTypes: stringArray,
        tags: stringArray,
      },
    },
    spring: {
      type: "object",
      additionalProperties: false,
      required: ["tags", "inventory", "updated", "productTypes"],
      properties: {
        tags: stringArray,
        inventory: { type: "string" },
        updated: { type: "string" },
        productTypes: stringArray,
      },
    },
  },
};

const productFiltersSchema = {
  type: "object",
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
  ],
  properties: {
    q: nullableString,
    season: nullableString,
    inventory: nullableString,
    inventoryValue: { type: ["string", "number", "null"] },
    updated: nullableString,
    vendors: stringArray,
    types: stringArray,
    tags: stringArray,
    collectionIds: stringArray,
    collectionTitles: stringArray,
    taxonomyJoin: { type: "string", enum: ["and", "or"] },
    vendorJoin: { type: "string", enum: ["any", "all"] },
    typeJoin: { type: "string", enum: ["any", "all"] },
    tagJoin: { type: "string", enum: ["any", "all"] },
    collectionJoin: { type: "string", enum: ["any", "all"] },
    tab: nullableString,
  },
};

const previewProductSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "handle",
    "status",
    "vendor",
    "productType",
    "inventory",
    "collections",
    "tags",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    handle: { type: "string" },
    status: { type: "string" },
    vendor: { type: "string" },
    productType: { type: "string" },
    inventory: nullableNumber,
    collections: stringArray,
    tags: stringArray,
  },
};

const redirectPreviewRowSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "from",
    "to",
    "imageUrl",
    "imageAlt",
    "status",
    "via",
    "confidence",
    "tone",
    "originalTo",
    "targetChoice",
    "customTarget",
    "edited",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    imageUrl: { type: "string" },
    imageAlt: { type: "string" },
    status: { type: "string" },
    via: { type: "string" },
    confidence: { type: "string", enum: ["High", "Medium", "Low"] },
    tone: { type: "string", enum: ["success", "info", "warning"] },
    originalTo: { type: "string" },
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
    customTarget: { type: "string" },
    edited: { type: "boolean" },
  },
};

export const AI_WIZARD_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "userGoal",
    "detectedCleanupIntent",
    "cleanupType",
    "cleanupPreset",
    "confidence",
    "confidenceReason",
    "suggestedFilters",
    "productMatchPreview",
    "suggestedRedirectRules",
    "suggestedRedirectTargets",
    "redirectPreview",
    "warnings",
    "assumptions",
    "questions",
    "clarifyingQuestions",
    "nextStep",
    "safeExplanation",
    "prefill",
    "requiresReview",
    "requiresExplicitConfirmation",
    "mustNotApplyAutomatically",
    "fallbackRecommended",
  ],
  properties: {
    schemaVersion: { type: "string", enum: ["ai_wizard_plan_v1"] },
    userGoal: { type: "string" },
    detectedCleanupIntent: {
      type: "string",
      enum: [
        "vendor_exit",
        "seasonal_cleanup",
        "out_of_stock_cleanup",
        "discontinued_cleanup",
        "spring_cleaning",
        "redirect_repair",
        "unknown",
      ],
    },
    cleanupType: {
      type: "string",
      enum: ["redirects", "archive", "delete", "unknown"],
    },
    cleanupPreset: {
      type: "string",
      enum: ["seasonal", "vendor", "oos", "spring", "none", "unknown"],
    },
    confidence: { type: "number" },
    confidenceReason: { type: "string" },
    suggestedFilters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "field",
          "operator",
          "values",
          "source",
          "shopifyQueryFragment",
        ],
        properties: {
          field: {
            type: "string",
            enum: [
              "query",
              "season",
              "vendor",
              "productType",
              "collection",
              "tag",
              "inventory",
              "updated",
              "status",
            ],
          },
          operator: { type: "string" },
          values: stringArray,
          source: {
            type: "string",
            enum: [
              "merchant_intent",
              "catalog_lookup",
              "tool_preview",
              "assumption",
            ],
          },
          shopifyQueryFragment: nullableString,
        },
      },
    },
    productMatchPreview: {
      type: "object",
      additionalProperties: false,
      required: [
        "estimatedTotal",
        "sampledCount",
        "bulkLimited",
        "querySummary",
        "products",
      ],
      properties: {
        estimatedTotal: nullableNumber,
        sampledCount: { type: "number" },
        bulkLimited: { type: "boolean" },
        querySummary: { type: "string" },
        products: {
          type: "array",
          items: previewProductSchema,
        },
      },
    },
    suggestedRedirectRules: {
      type: "array",
      items: redirectRuleSchema,
    },
    suggestedRedirectTargets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "target",
          "targetKind",
          "confidence",
          "reason",
          "validationStatus",
          "validationReason",
        ],
        properties: {
          target: { type: "string" },
          targetKind: {
            type: "string",
            enum: [
              "collection",
              "search",
              "all_products",
              "homepage",
              "custom_path",
              "external",
              "skip",
              "unknown",
            ],
          },
          confidence: { type: "string", enum: ["High", "Medium", "Low"] },
          reason: { type: "string" },
          validationStatus: {
            type: "string",
            enum: ["valid", "invalid", "unchecked", "skipped"],
          },
          validationReason: { type: "string" },
        },
      },
    },
    redirectPreview: {
      type: "array",
      items: redirectPreviewRowSchema,
    },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "code", "message"],
        properties: {
          severity: { type: "string", enum: ["critical", "warning", "info"] },
          code: { type: "string" },
          message: { type: "string" },
        },
      },
    },
    assumptions: stringArray,
    questions: stringArray,
    clarifyingQuestions: {
      type: "array",
      items: clarifyingQuestionSchema,
    },
    nextStep: {
      type: "string",
      enum: [
        "ask_clarifying_question",
        "prefill_cleanup_type",
        "prefill_product_filters",
        "prefill_redirect_rules",
        "review_redirects",
        "ready_for_merchant_review",
      ],
    },
    safeExplanation: { type: "string" },
    prefill: {
      type: "object",
      additionalProperties: false,
      required: [
        "cleanupMode",
        "cleanupPreset",
        "presetDetails",
        "productFilters",
        "redirectRules",
      ],
      properties: {
        cleanupMode: {
          type: "string",
          enum: ["redirects", "archive", "delete", "unknown"],
        },
        cleanupPreset: {
          type: "string",
          enum: ["seasonal", "vendor", "oos", "spring", "none", "unknown"],
        },
        presetDetails: presetDetailsSchema,
        productFilters: productFiltersSchema,
        redirectRules: {
          type: "array",
          items: redirectRuleSchema,
        },
      },
    },
    requiresReview: { type: "boolean" },
    requiresExplicitConfirmation: { type: "boolean" },
    mustNotApplyAutomatically: { type: "boolean" },
    fallbackRecommended: { type: "boolean" },
  },
} as const;

export function emptyAiWizardPrefill(): AiWizardPrefill {
  return {
    cleanupMode: "unknown",
    cleanupPreset: "unknown",
    presetDetails: {
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
    },
    productFilters: {
      q: "",
      season: "",
      inventory: "",
      inventoryValue: "",
      updated: "",
      vendors: [],
      types: [],
      tags: [],
      collectionIds: [],
      collectionTitles: [],
      taxonomyJoin: "and",
      vendorJoin: "any",
      typeJoin: "any",
      tagJoin: "any",
      collectionJoin: "any",
      tab: "all",
    },
    redirectRules: [],
  };
}
