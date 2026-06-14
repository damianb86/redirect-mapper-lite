import crypto from "node:crypto";
import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { logger } from "../logger.server";
import {
  AI_WIZARD_PLAN_JSON_SCHEMA,
  emptyAiWizardPrefill,
  type AiWizardPlan,
} from "./ai-wizard.schemas";
import {
  AI_WIZARD_TOOLS,
  runAiWizardTool,
  type AiToolContext,
  type AiWizardToolResult,
} from "./ai-wizard.tools.server";
import { DEFAULT_RULES, type RedirectRule } from "./cleanup-rules";
import type { AdminGraphqlClient } from "./shopify-catalog.server";

export type AiWizardRequest = {
  userGoal: string;
  previousPlan?: AiWizardPlan | null;
};

export type AiWizardResponse = {
  ok: true;
  plan: AiWizardPlan;
  model: string;
  fallbackUsed: boolean;
  toolCalls: AiWizardToolResult[];
  responseId: string | null;
  usage: unknown;
};

export class AiWizardConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWizardConfigurationError";
  }
}

const AI_WIZARD_DEFAULT_MODEL = process.env.AI_WIZARD_MODEL || "gpt-5-mini";
const AI_WIZARD_FALLBACK_MODEL =
  process.env.AI_WIZARD_FALLBACK_MODEL || "gpt-5.4";
const AI_WIZARD_CONFIDENCE_THRESHOLD = Number(
  process.env.AI_WIZARD_CONFIDENCE_THRESHOLD || "0.55",
);
const AI_WIZARD_MAX_TOOL_ROUNDS = 8;
const AI_DEMO_REDIRECT_RULE_SIGNATURES = new Set(
  DEFAULT_RULES.map(redirectRuleSignature),
);

const AI_WIZARD_DEVELOPER_PROMPT = `
You are Redirect Pulse AI Wizard, a read-only planning assistant for a Shopify bulk redirect cleanup app.

Outcome:
- Interpret the merchant's plain-language cleanup goal.
- Use the available internal tools to retrieve real catalog values, preview matching products, build redirect-rule suggestions, validate redirect destinations, and estimate preview impact.
- Produce one strict JSON cleanup plan for the existing cleanup flow.

Hard safety rules:
- Never apply redirects.
- Never archive products.
- Never delete products.
- Never skip review.
- Never claim a redirect, product update, archive, or delete operation has been applied.
- All destructive operations require explicit merchant confirmation in the existing app flow.
- If catalog evidence needed to identify product scope is missing, ask for clarification instead of presenting the plan as ready.
- Clarifying questions must always be multiple choice. Do not ask the merchant to type a free-text clarification.
- Ask clarifying questions at most once. If the user payload includes previousPlan or "Clarification answers:", use those answers, make safe assumptions for remaining ambiguity, and produce the best reviewable plan.

	Grounding rules:
	- Do not invent products, vendors, product types, collections, tags, URLs, or counts.
	- Use search tools before using catalog names from merchant text.
	- Use preview tools before reporting product samples or redirect rows.
	- Use validation tools before marking destinations valid or invalid.
	- Full-catalog totals are unknown unless a tool returns an exact count. Use null for unknown totals.
	- Available product targeting filters are exactly: keyword query (q), season keyword, vendors, product types, tags, collection IDs/titles, inventory, updated age, status tab, taxonomyJoin, vendorJoin, typeJoin, tagJoin, and collectionJoin.
	- Keyword query (q) is the only free keyword filter. Treat it as a broad product search over supported indexed product fields such as title/name, handle, vendor, product type, SKU, collections, and tags. It is not a product-description search.
	- There is no product description/body/content/metafield/SEO-description filter in this app. Never propose description, body, content, metafields, SEO description, or any unsupported field as a clarifying option, suggested filter, assumption, or plan step.
	- Product filters support wildcards in vendor, product type, tag, and collection title values. Use sale* for starts-with, *sale for ends-with, and *sale* for contains. Wildcard filters must be validated with preview_matching_products before they are presented.

Planning rules:
- Prefer the cheapest sufficient plan: use existing cleanup presets and rule patterns.
- Do not copy default preset filter fields into prefill. Only set productFilters and presetDetails fields supported by merchant text, catalog lookup, or tool preview. Leave unrelated preset fields empty.
- Mark every assumption clearly.
- Surface broad or risky destinations such as homepage, all products, invalid destinations, external URLs, and low-confidence redirect rows.
- Keep the safeExplanation concise and merchant-facing.
- When nextStep is ask_clarifying_question, populate clarifyingQuestions with one object per question.
- Include every necessary clarifying question in the first clarification response. Do not spread clarification across multiple rounds.
	- Every clarifying question must include 2 to 5 concise options that the merchant can click.
	- Every clarifying question must include exactly one ignore option, using id "ignore_and_continue" and label "Ignore and continue".
	- Clarifying questions are only for product targeting filters that exist in the app: vendor, collection, product type, tag, keyword query/title-name search, inventory, update age, status, season, or campaign scope.
	- When asking where to use a merchant-provided keyword, offer only supported choices such as vendor, product type, tag, collection, or keyword query/title-name search. Do not offer description.
	- Do not ask clarifying questions about final confirmation, applying changes, whether to review later, whether to archive/delete, destination acceptance, homepage acceptance, or how the merchant wants to decide later. The existing app review and final confirmation screens already handle those decisions.
- If redirect destination intent is ambiguous, create the safest reviewable redirect rule set you can from real catalog data, mark risky destinations with warnings/low confidence, and send the merchant to redirect review. Do not ask whether homepage, all-products, search, or another fallback is acceptable.
- If the merchant gives explicit redirect destination instructions, those instructions override generic preset destinations. Preserve the product scope and rebuild redirectRules/redirectPreview around the merchant's requested destinations.
- For instructions such as "redirect to the product's first collection" or "redirect to their collection page", use target "sameCollection" with targetOption "firstCollection" unless the merchant explicitly chooses a different collection rule. If the merchant specifies a fallback/default collection for products without collections, include a fallback rule or warning for that collection path instead of inventing unrelated vendor, inventory, or tag rules.
- If the merchant text or previousPlan mentions later confirmation, final approval, review choices, or deciding how to proceed, treat that as existing app workflow context and ignore it for clarification generation.
- Do not create generic clarification options such as "specific vendor", "specific collection", "specific product type", or "review affected products" unless the option includes a concrete catalog value or a concrete filter value. Generic options do not resolve the plan.
- Use selectionMode "multiple" for catalog scope, filter, inventory, and timeframe questions when more than one answer could be useful.
- Do not ask whether to archive or delete. If the merchant says archive or delete, preselect that cleanup mode and rely on the app's final confirmation screen for safety.
- If an option names a vendor, collection, product type, tag, or URL, it must come from an internal tool result. If evidence is missing, offer concrete product-filter choices only, or the single Ignore and continue option.
- If product preview returns zero matches, do not present the plan as ready for Summary. Ask for scope clarification when allowed, or move the merchant to product/filter review with a warning.
- When the merchant asks for a partial text match such as "tags containing last-season", "vendor starts with Acme", or "collections ending in outlet", represent that as wildcard values in productFilters instead of asking an unnecessary clarification.
- Use taxonomyJoin to combine vendor, collection, product type, and tag groups. Use each field join to combine multiple values inside that group. Default to taxonomyJoin "and" and value joins "any" unless the merchant clearly requests union/intersection logic.
- Do not use product selection limits as product filters. If the merchant says only the first N, last N, middle products, or a limited number should be used, keep filters broad enough to find the matching set and let the app reduce the selected products.
- Client-side selection instructions such as "select the first 5 products", "select the last 3 products", or "use the middle 4 products" are supported by the app. Preserve them in userGoal, do not ask about them, and do not treat them as missing AI capability.
- Write app-owned explanations, assumptions, warnings, questions, and option labels in English by default. Preserve merchant-provided catalog values, product names, tag names, collection names, and direct user/AI-provided text in their original language when needed.
- Keep questions mirrored in the legacy questions array for compatibility.
`.trim();

function hashShop(shop: string) {
  return crypto.createHash("sha256").update(shop).digest("hex").slice(0, 48);
}

function redirectRuleSignature(
  rule: Pick<
    RedirectRule,
    "field" | "condition" | "value" | "target" | "targetOption" | "targetValue"
  >,
) {
  return [
    rule.field,
    rule.condition,
    rule.value
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .join(","),
    rule.target,
    rule.targetOption,
    rule.targetValue.trim(),
  ].join("|");
}

function normalizeGoalText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isAiAllCollectionFilterValue(value: string) {
  const normalized = normalizeGoalText(value).replace(/[^a-z0-9]+/g, "");
  return normalized === "all" || normalized === "collectionsall";
}

function sanitizeAiCollectionFilterValues(values: string[]) {
  return values.filter((value) => !isAiAllCollectionFilterValue(value));
}

function goalRequestsFirstCollectionRedirect(value: string) {
  const text = normalizeGoalText(value);
  return (
    /\bfirst collection\b/.test(text) ||
    /\bproduct'?s collection\b/.test(text) ||
    /\btheir collection\b/.test(text) ||
    /\bprimera coleccion\b/.test(text) ||
    /\bcoleccion del producto\b/.test(text) ||
    /\bsu coleccion\b/.test(text)
  );
}

function goalRequestsNoCollectionSearchFallback(value: string) {
  const text = normalizeGoalText(value);
  const mentionsMissingCollection =
    /\b(no collection|without collection|unassigned collection)\b/.test(text) ||
    /\b(sin coleccion|sin coleccion asignada|no pertenezcan a ninguna coleccion|productos sin coleccion)\b/.test(
      text,
    );
  const mentionsSearch =
    /\b(search results?|searchresults|product search)\b/.test(text) ||
    /\b(resultados? de busqueda|busqueda del producto)\b/.test(text);
  return mentionsMissingCollection && mentionsSearch;
}

function goalRequestsClientSideSelection(value: string) {
  const text = normalizeGoalText(value);
  return (
    /\b(?:select|choose|pick|use|take|selecciona|seleccionar|elige|elegir|usa|usar|toma|tomar)\b.{0,40}\b\d{1,3}\b.{0,40}\b(?:first|top|last|bottom|middle|primeros|primeras|ultimos|ultimas|productos?|articulos?)\b/.test(
      text,
    ) ||
    /\b\d{1,3}\s+(?:first|top|last|bottom|middle|primeros|primeras|ultimos|ultimas|productos?|articulos?)\b/.test(
      text,
    )
  );
}

function aiRuleProductScopeValue(rules: RedirectRule[], fallback = "") {
  return (
    rules
      .find(
        (rule) =>
          rule.field === "titleHandle" &&
          rule.value.trim() &&
          ["contains", "startsWith", "in"].includes(rule.condition),
      )
      ?.value.trim() || fallback.trim()
  );
}

function onlyDemoRedirectRules(rules: RedirectRule[]) {
  return (
    rules.length > 0 &&
    rules.every((rule) =>
      AI_DEMO_REDIRECT_RULE_SIGNATURES.has(redirectRuleSignature(rule)),
    )
  );
}

function firstCollectionFallbackRule(): RedirectRule {
  return {
    id: "ai-first-collection-fallback",
    field: "fallback",
    condition: "anything",
    value: "",
    target: "sameCollection",
    targetOption: "firstCollection",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  };
}

function firstCollectionTitleRule(value: string): RedirectRule {
  return {
    id: "ai-title-first-collection",
    field: "titleHandle",
    condition: "contains",
    value,
    target: "sameCollection",
    targetOption: "firstCollection",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  };
}

function productSearchFallbackRule(): RedirectRule {
  return {
    id: "ai-no-collection-search-fallback",
    field: "fallback",
    condition: "anything",
    value: "",
    target: "searchResults",
    targetOption: "productTitle",
    targetValue: "",
    enabled: true,
    stopOnMatch: true,
  };
}

type AiRedirectRuleIntent = Pick<
  RedirectRule,
  "target" | "targetOption" | "targetValue"
>;

function goalKeywordScopeValue(value: string) {
  const text = value.trim();
  return (
    text.match(
      /\b(?:word|keyword|palabra|termino|t[eé]rmino)\s+["“”']([^"“”']{1,80})["“”']/i,
    )?.[1] ??
    text.match(
      /\b(?:contains?|contengan?|contiene|contenga)\s+(?:the\s+)?(?:word|keyword|palabra|termino|t[eé]rmino)?\s*["“”']([^"“”']{1,80})["“”']/i,
    )?.[1] ??
    ""
  ).trim();
}

function goalRedirectIntent(value: string): AiRedirectRuleIntent | null {
  const text = normalizeGoalText(value);
  const hasRedirectIntent =
    /\b(redirect|redirects|redirigir|redireccionar|redireccion|vayan|ir a|go to|send to)\b/.test(
      text,
    );
  if (!hasRedirectIntent) return null;

  if (goalRequestsFirstCollectionRedirect(value)) {
    return {
      target: "sameCollection",
      targetOption: "firstCollection",
      targetValue: "",
    };
  }

  if (/\b(home|homepage|home page|inicio|pagina principal)\b/.test(text)) {
    return { target: "homepage", targetOption: "root", targetValue: "" };
  }

  if (
    /\b(search results?|searchresults|product search|resultados? de busqueda|busqueda del producto|pagina de busqueda)\b/.test(
      text,
    )
  ) {
    return {
      target: "searchResults",
      targetOption: /\b(tag|tags|etiqueta|etiquetas)\b/.test(text)
        ? "tag"
        : "productTitle",
      targetValue: "",
    };
  }

  if (
    /\b(all products|collections all|todos los productos|catalogo|catalog)\b/.test(
      text,
    ) ||
    /\/collections\/all\b/.test(text)
  ) {
    return {
      target: "allProducts",
      targetOption: "collectionsAll",
      targetValue: "",
    };
  }

  return null;
}

function scopedRedirectRule(
  intent: AiRedirectRuleIntent,
  scopeValue: string,
): RedirectRule {
  const value = scopeValue.trim();
  return {
    id: value ? "ai-title-redirect" : "ai-redirect-fallback",
    field: value ? "titleHandle" : "fallback",
    condition: value ? "contains" : "anything",
    value,
    target: intent.target,
    targetOption: intent.targetOption,
    targetValue: intent.targetValue,
    enabled: true,
    stopOnMatch: true,
  };
}

function sanitizeAiRedirectRules(
  rules: RedirectRule[],
  goalText: string,
  {
    productQuery = "",
    synthesizeWhenEmpty = false,
  }: { productQuery?: string; synthesizeWhenEmpty?: boolean } = {},
) {
  const wantsFirstCollection = goalRequestsFirstCollectionRedirect(goalText);
  const wantsNoCollectionSearchFallback =
    goalRequestsNoCollectionSearchFallback(goalText);
  const redirectIntent = goalRedirectIntent(goalText);
  const scopeValue =
    aiRuleProductScopeValue(rules, productQuery) ||
    goalKeywordScopeValue(goalText);
  if (wantsFirstCollection && wantsNoCollectionSearchFallback) {
    return [
      scopeValue
        ? firstCollectionTitleRule(scopeValue)
        : firstCollectionFallbackRule(),
      productSearchFallbackRule(),
    ];
  }

  if (rules.length === 0) {
    if (!synthesizeWhenEmpty && !redirectIntent) return rules;
    if (redirectIntent) return [scopedRedirectRule(redirectIntent, scopeValue)];
    if (!wantsFirstCollection) return rules;
    return scopeValue
      ? [firstCollectionTitleRule(scopeValue)]
      : [firstCollectionFallbackRule()];
  }

  if (!onlyDemoRedirectRules(rules)) return rules;

  if (redirectIntent) return [scopedRedirectRule(redirectIntent, scopeValue)];

  if (wantsFirstCollection) {
    return scopeValue
      ? [firstCollectionTitleRule(scopeValue)]
      : [firstCollectionFallbackRule()];
  }

  return [];
}

function sanitizedAiPresetDetails(
  presetDetails: AiWizardPlan["prefill"]["presetDetails"] | undefined,
  fallback: AiWizardPlan["prefill"]["presetDetails"],
) {
  return {
    ...(presetDetails ?? fallback),
    seasonal: {
      ...(presetDetails?.seasonal ?? fallback.seasonal),
      collectionTitles: sanitizeAiCollectionFilterValues(
        presetDetails?.seasonal?.collectionTitles ?? [],
      ),
    },
  };
}

function sanitizedAiProductFilters(
  productFilters: AiWizardPlan["prefill"]["productFilters"] | undefined,
  fallback: AiWizardPlan["prefill"]["productFilters"],
) {
  return {
    q: productFilters?.q ?? "",
    season: productFilters?.season ?? "",
    inventory: productFilters?.inventory ?? "",
    inventoryValue: productFilters?.inventoryValue ?? "",
    updated: productFilters?.updated ?? "",
    vendors: productFilters?.vendors ?? [],
    types: productFilters?.types ?? [],
    tags: productFilters?.tags ?? [],
    collectionIds: productFilters?.collectionIds ?? [],
    collectionTitles: sanitizeAiCollectionFilterValues(
      productFilters?.collectionTitles ?? [],
    ),
    taxonomyJoin: productFilters?.taxonomyJoin === "or" ? "or" : "and",
    vendorJoin: productFilters?.vendorJoin === "all" ? "all" : "any",
    typeJoin: productFilters?.typeJoin === "all" ? "all" : "any",
    tagJoin: productFilters?.tagJoin === "all" ? "all" : "any",
    collectionJoin:
      productFilters?.collectionJoin === "all"
        ? "all"
        : (fallback.collectionJoin ?? "any"),
    tab: productFilters?.tab ?? "all",
  };
}

function sanitizedAiSuggestedFilters(
  suggestedFilters: AiWizardPlan["suggestedFilters"] | undefined,
) {
  return (suggestedFilters ?? [])
    .map((filter) =>
      filter.field === "collection"
        ? {
            ...filter,
            values: sanitizeAiCollectionFilterValues(filter.values ?? []),
          }
        : filter,
    )
    .filter(
      (filter) => filter.field !== "collection" || filter.values.length > 0,
    );
}

function parseFunctionArguments(value: string): unknown {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }

  return null;
}

function isFunctionCall(item: unknown): item is ResponseFunctionToolCall {
  return Boolean(
    item &&
    typeof item === "object" &&
    (item as { type?: string }).type === "function_call" &&
    typeof (item as { name?: unknown }).name === "string" &&
    typeof (item as { call_id?: unknown }).call_id === "string",
  );
}

function parsePlan(response: OpenAIResponse): AiWizardPlan {
  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("OpenAI returned no structured plan text.");
  }

  try {
    return JSON.parse(text) as AiWizardPlan;
  } catch (error) {
    const extracted = extractFirstJsonObject(text);
    if (!extracted || extracted === text) throw error;
    return JSON.parse(extracted) as AiWizardPlan;
  }
}

function safetyWarning(
  code: string,
  message: string,
): AiWizardPlan["warnings"][number] {
  return {
    severity: "warning",
    code,
    message,
  };
}

const IGNORE_CLARIFICATION_OPTION = clarifyOption(
  "ignore_and_continue",
  "Ignore and continue",
  "Ignore this question and continue with the best available filters.",
  "Continue with the current setup.",
);

const DISALLOWED_CLARIFICATION_TEXT_PATTERN =
  /\b(confirm|confirmation|confirmar|confirmación|approve|approval|aplicar|apply|final|later|después|despues|review later|revisar después|revisar despues|decide later|decidir después|decidir despues|acceptable|aceptable|homepage|home page|all products|todos los productos|redirect destination|destino de redirecci[oó]n|destination strategy|estrategia de destino)\b/;

const UNSUPPORTED_PRODUCT_FILTER_TEXT_PATTERN =
  /\b(description|descripci[oó]n|body|body_html|content|contenido|metafield|metafields|seo description|seo title|meta description)\b/;

function clarifyOption(
  id: string,
  label: string,
  value: string,
  description: string,
): AiWizardPlan["clarifyingQuestions"][number]["options"][number] {
  return { id, label, value, description };
}

function defaultClarifyingOptions(question: string) {
  const normalized = question.toLowerCase();

  if (/destination|redirect|target|where|send/.test(normalized)) {
    return [IGNORE_CLARIFICATION_OPTION];
  }

  if (/season|campaign|last season|date|timeframe|updated/.test(normalized)) {
    return [
      clarifyOption(
        "updated_90d",
        "90 days",
        "Target products not updated in 90 days.",
        "Use the Last updated filter.",
      ),
      clarifyOption(
        "updated_180d",
        "180 days",
        "Target products not updated in 180 days.",
        "Use the Last updated filter.",
      ),
      clarifyOption(
        "updated_365d",
        "1 year",
        "Target products not updated in 1 year.",
        "Use the Last updated filter.",
      ),
      IGNORE_CLARIFICATION_OPTION,
    ];
  }

  if (/stock|inventory|sold out|out-of-stock/.test(normalized)) {
    return [
      clarifyOption(
        "zero_inventory",
        "Zero inventory",
        "Target products with zero inventory.",
        "Use inventory as the main cleanup signal.",
      ),
      clarifyOption(
        "old_zero_inventory",
        "Old zero inventory",
        "Target older products with zero inventory.",
        "Combine inventory and age filters.",
      ),
      clarifyOption(
        "low_inventory",
        "Low inventory",
        "Target products with low inventory.",
        "Use the Low stock filter.",
      ),
      IGNORE_CLARIFICATION_OPTION,
    ];
  }

  return [IGNORE_CLARIFICATION_OPTION];
}

function defaultClarifyingQuestion(
  question: string,
  index: number,
): AiWizardPlan["clarifyingQuestions"][number] {
  const normalized = question.toLowerCase();
  const questionType: AiWizardPlan["clarifyingQuestions"][number]["questionType"] =
    /destination|redirect|target|where|send/.test(normalized)
      ? "destination_strategy"
      : /season|campaign|date|timeframe|updated/.test(normalized)
        ? "timeframe"
        : /stock|inventory|sold out|out-of-stock/.test(normalized)
          ? "inventory"
          : "catalog_value";

  return {
    id: `clarify_${index + 1}`,
    questionType,
    question,
    selectionMode: "multiple",
    options: defaultClarifyingOptions(question),
  };
}

function hasAnsweredClarification(request: AiWizardRequest) {
  return Boolean(
    request.previousPlan ||
    request.userGoal.toLowerCase().includes("clarification answers:"),
  );
}

function sanitizeId(value: string, fallback: string) {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return id || fallback;
}

function shouldUseMultipleChoice(
  questionType: AiWizardPlan["clarifyingQuestions"][number]["questionType"],
) {
  return ["cleanup_scope", "catalog_value", "timeframe", "inventory"].includes(
    questionType,
  );
}

function isIgnoreClarifyingOption(
  option: AiWizardPlan["clarifyingQuestions"][number]["options"][number],
) {
  const text =
    `${option.id} ${option.label} ${option.value} ${option.description}`.toLowerCase();
  return (
    option.id === IGNORE_CLARIFICATION_OPTION.id ||
    (/\b(ignore|ignorar)\b/.test(text) &&
      /\b(continue|continuar|seguir adelante)\b/.test(text))
  );
}

function isDisallowedClarifyingQuestion(
  question: Pick<
    AiWizardPlan["clarifyingQuestions"][number],
    "question" | "questionType"
  >,
) {
  const text = `${question.questionType} ${question.question}`.toLowerCase();
  return (
    question.questionType === "destination_strategy" ||
    question.questionType === "cleanup_mode" ||
    question.questionType === "manual_fallback" ||
    DISALLOWED_CLARIFICATION_TEXT_PATTERN.test(text)
  );
}

function normalizeClarifyingOptions(
  options: AiWizardPlan["clarifyingQuestions"][number]["options"],
  questionType: AiWizardPlan["clarifyingQuestions"][number]["questionType"],
) {
  const unique = new Map<
    string,
    AiWizardPlan["clarifyingQuestions"][number]["options"][number]
  >();
  [...options, IGNORE_CLARIFICATION_OPTION].forEach((option, optionIndex) => {
    const label = option.label?.trim();
    const value = option.value?.trim();
    if (!label || !value) return;
    const isIgnore = isIgnoreClarifyingOption({ ...option, label, value });
    if (
      !isIgnore &&
      !isResolutiveClarifyingOption({ ...option, label, value }, questionType)
    ) {
      return;
    }
    const key = isIgnore
      ? IGNORE_CLARIFICATION_OPTION.id
      : `${label.toLowerCase()}::${value.toLowerCase()}`;
    if (unique.has(key)) return;
    unique.set(key, {
      id: isIgnore
        ? IGNORE_CLARIFICATION_OPTION.id
        : sanitizeId(option.id || label, `option_${optionIndex + 1}`),
      label: isIgnore ? IGNORE_CLARIFICATION_OPTION.label : label,
      value: isIgnore ? IGNORE_CLARIFICATION_OPTION.value : value,
      description: isIgnore
        ? IGNORE_CLARIFICATION_OPTION.description
        : option.description?.trim() || value,
    });
  });
  const normalized = [...unique.values()];
  const ignore = normalized.find(
    (option) => option.id === IGNORE_CLARIFICATION_OPTION.id,
  );
  const nonIgnore = normalized.filter(
    (option) => option.id !== IGNORE_CLARIFICATION_OPTION.id,
  );
  return ignore ? [...nonIgnore.slice(0, 4), ignore] : nonIgnore.slice(0, 5);
}

function isResolutiveClarifyingOption(
  option: AiWizardPlan["clarifyingQuestions"][number]["options"][number],
  questionType: AiWizardPlan["clarifyingQuestions"][number]["questionType"],
) {
  if (isIgnoreClarifyingOption(option)) return true;
  if (questionType === "destination_strategy") return false;
  const text =
    `${option.id} ${option.label} ${option.value} ${option.description}`.toLowerCase();
  if (
    DISALLOWED_CLARIFICATION_TEXT_PATTERN.test(text) ||
    UNSUPPORTED_PRODUCT_FILTER_TEXT_PATTERN.test(text) ||
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

function normalizeClarifyingQuestions(
  rawQuestions: AiWizardPlan["clarifyingQuestions"] | undefined,
  textQuestions: string[],
) {
  const fallbackTextQuestions = textQuestions.length
    ? textQuestions.slice(0, 3)
    : ["Which catalog detail should I use to target this cleanup?"];
  const fallbackQuestions = fallbackTextQuestions.map(
    defaultClarifyingQuestion,
  );

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return fallbackQuestions;
  }

  return rawQuestions
    .filter((question) => !isDisallowedClarifyingQuestion(question))
    .slice(0, 4)
    .map((question, questionIndex) => {
      const fallback =
        fallbackQuestions[questionIndex] ??
        defaultClarifyingQuestion(
          question.question || fallbackTextQuestions[0],
          questionIndex,
        );
      const questionText = question.question?.trim() || fallback.question;
      const fallbackOptions = defaultClarifyingOptions(questionText);
      const questionType = question.questionType || fallback.questionType;
      if (
        isDisallowedClarifyingQuestion({
          question: questionText,
          questionType,
        })
      ) {
        return null;
      }
      const options = Array.isArray(question.options)
        ? normalizeClarifyingOptions(question.options, questionType)
        : [];
      const normalizedOptions =
        options.length >= 2
          ? options.slice(0, 5)
          : normalizeClarifyingOptions(fallbackOptions, questionType).slice(
              0,
              5,
            );

      return {
        id: sanitizeId(
          question.id || questionText,
          `clarify_${questionIndex + 1}`,
        ),
        questionType,
        question: questionText,
        selectionMode:
          question.selectionMode === "multiple" ||
          shouldUseMultipleChoice(questionType)
            ? ("multiple" as const)
            : ("single" as const),
        options: normalizedOptions,
      };
    })
    .filter(
      (question): question is AiWizardPlan["clarifyingQuestions"][number] =>
        Boolean(question),
    )
    .filter((question) => {
      const nonIgnoreOptions = question.options.filter(
        (option) => option.id !== IGNORE_CLARIFICATION_OPTION.id,
      );
      return question.options.length >= 2 && nonIgnoreOptions.length > 0;
    });
}

function normalizePlanSafety(
  plan: AiWizardPlan,
  request: AiWizardRequest,
): AiWizardPlan {
  const confidence = Math.max(0, Math.min(1, Number(plan.confidence) || 0));
  const warnings = [...(plan.warnings ?? [])];
  const questions = [...(plan.questions ?? [])].filter((question) =>
    question.trim(),
  );
  const assumptions = [...(plan.assumptions ?? [])];
  const prefill = plan.prefill ?? emptyAiWizardPrefill();
  const emptyPrefill = emptyAiWizardPrefill();
  const sanitizedProductFilters = sanitizedAiProductFilters(
    prefill.productFilters,
    emptyPrefill.productFilters,
  );
  const sanitizedPresetDetails = sanitizedAiPresetDetails(
    prefill.presetDetails,
    emptyPrefill.presetDetails,
  );
  const sanitizedSuggestedFilters = sanitizedAiSuggestedFilters(
    plan.suggestedFilters,
  );
  const clarificationAlreadyAnswered = hasAnsweredClarification(request);
  const redirectGoalText = `${request.userGoal}\n${plan.userGoal ?? ""}`;
  const hasClientSideSelection =
    goalRequestsClientSideSelection(redirectGoalText);
  const redirectRuleProductQuery =
    sanitizedProductFilters.q || sanitizedProductFilters.season;
  const rawPrefillRedirectRules = prefill.redirectRules ?? [];
  const rawSuggestedRedirectRules = plan.suggestedRedirectRules ?? [];
  const synthesizePrefillRedirectRule =
    rawPrefillRedirectRules.length === 0 &&
    rawSuggestedRedirectRules.length === 0;
  const sanitizedPrefillRedirectRules = sanitizeAiRedirectRules(
    rawPrefillRedirectRules,
    redirectGoalText,
    {
      productQuery: redirectRuleProductQuery,
      synthesizeWhenEmpty: synthesizePrefillRedirectRule,
    },
  );
  const sanitizedSuggestedRedirectRules = sanitizeAiRedirectRules(
    rawSuggestedRedirectRules,
    redirectGoalText,
    { productQuery: redirectRuleProductQuery },
  );
  const redirectRulesWereSanitized =
    sanitizedPrefillRedirectRules !== rawPrefillRedirectRules ||
    sanitizedSuggestedRedirectRules !== rawSuggestedRedirectRules;
  const suggestedRedirectTargets = redirectRulesWereSanitized
    ? []
    : (plan.suggestedRedirectTargets ?? []);
  const redirectPreview = redirectRulesWereSanitized
    ? []
    : (plan.redirectPreview ?? []);
  const hasReviewableProductScope =
    (plan.productMatchPreview?.products ?? []).some((product) => product.id) ||
    hasUsableProductFilters(sanitizedProductFilters);
  const hasReviewableRedirectRules =
    sanitizedPrefillRedirectRules.length > 0 ||
    sanitizedSuggestedRedirectRules.length > 0;
  const canContinueWithoutFallback =
    hasReviewableProductScope ||
    hasReviewableRedirectRules ||
    hasClientSideSelection;

  if (!plan.safeExplanation?.trim()) {
    warnings.push(
      safetyWarning(
        "missing_safe_explanation",
        "The AI plan did not include a merchant-facing explanation.",
      ),
    );
  }

  const invalidTargets = suggestedRedirectTargets.filter(
    (target) => target.validationStatus === "invalid",
  );
  if (invalidTargets.length) {
    warnings.push({
      severity: "critical",
      code: "invalid_redirect_destinations",
      message: `${invalidTargets.length} redirect destination(s) were marked invalid and must be fixed before review.`,
    });
  }

  const lowConfidenceTargets = suggestedRedirectTargets.filter(
    (target) => target.confidence === "Low",
  );
  if (lowConfidenceTargets.length) {
    warnings.push(
      safetyWarning(
        "low_confidence_destinations",
        `${lowConfidenceTargets.length} destination suggestion(s) need merchant review.`,
      ),
    );
  }

  const uncheckedTargets = suggestedRedirectTargets.filter(
    (target) => target.validationStatus === "unchecked",
  );
  if (uncheckedTargets.length) {
    warnings.push(
      safetyWarning(
        "unchecked_redirect_destinations",
        `${uncheckedTargets.length} destination suggestion(s) still need validation in redirect review.`,
      ),
    );
  }

  const hasMatchedProducts = (plan.productMatchPreview?.products ?? []).some(
    (product) => product.id,
  );
  let nextStep =
    !clarificationAlreadyAnswered &&
    confidence < AI_WIZARD_CONFIDENCE_THRESHOLD &&
    !canContinueWithoutFallback
      ? "ask_clarifying_question"
      : clarificationAlreadyAnswered &&
          plan.nextStep === "ask_clarifying_question"
        ? "ready_for_merchant_review"
        : plan.nextStep;
  if (!hasMatchedProducts && nextStep !== "ask_clarifying_question") {
    warnings.push(
      safetyWarning(
        "no_product_matches",
        "No matching products were returned. Review or broaden product filters before opening Summary.",
      ),
    );
    nextStep = "prefill_product_filters";
  }
  if (nextStep === "ask_clarifying_question" && questions.length === 0) {
    questions.push(
      "Which exact vendor, tag, collection, product type, or season should I target?",
    );
  }
  let clarifyingQuestions =
    nextStep === "ask_clarifying_question"
      ? normalizeClarifyingQuestions(plan.clarifyingQuestions, questions)
      : Array.isArray(plan.clarifyingQuestions) &&
          plan.clarifyingQuestions.length
        ? normalizeClarifyingQuestions(plan.clarifyingQuestions, questions)
        : [];
  if (
    nextStep === "ask_clarifying_question" &&
    clarifyingQuestions.length === 0
  ) {
    warnings.push(
      safetyWarning(
        "clarification_not_actionable",
        "AI did not return concrete clarification options, so the wizard continued with the available filters.",
      ),
    );
    nextStep = "prefill_product_filters";
    clarifyingQuestions = [];
  }

  return {
    ...plan,
    schemaVersion: "ai_wizard_plan_v1",
    userGoal: request.userGoal.trim() || plan.userGoal?.trim() || "",
    confidence,
    warnings,
    assumptions,
    questions,
    suggestedFilters: sanitizedSuggestedFilters,
    clarifyingQuestions,
    nextStep,
    redirectPreview,
    suggestedRedirectTargets,
    suggestedRedirectRules: sanitizedSuggestedRedirectRules,
    prefill: {
      ...prefill,
      presetDetails: sanitizedPresetDetails,
      productFilters: sanitizedProductFilters,
      redirectRules: sanitizedPrefillRedirectRules,
    },
    fallbackRecommended: Boolean(
      (plan.fallbackRecommended || !hasMatchedProducts) &&
      !canContinueWithoutFallback &&
      !(nextStep === "ask_clarifying_question" && clarifyingQuestions.length),
    ),
    requiresReview: true,
    requiresExplicitConfirmation: true,
    mustNotApplyAutomatically: true,
  };
}

function toolDataObject(result: AiWizardToolResult) {
  return result.ok &&
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
    ? (result.data as Record<string, unknown>)
    : null;
}

function hasPlanProducts(plan: AiWizardPlan) {
  return (plan.productMatchPreview?.products ?? []).some(
    (product) => product.id,
  );
}

function hasUsableProductFilters(
  filters: AiWizardPlan["prefill"]["productFilters"],
) {
  return Boolean(
    filters.q?.trim() ||
    filters.season?.trim() ||
    filters.inventory?.trim() ||
    filters.updated?.trim() ||
    filters.vendors?.length ||
    filters.types?.length ||
    filters.tags?.length ||
    filters.collectionIds?.length ||
    filters.collectionTitles?.length ||
    (filters.tab && filters.tab !== "all"),
  );
}

function productFiltersForTool(plan: AiWizardPlan) {
  const filters =
    plan.prefill?.productFilters ?? emptyAiWizardPrefill().productFilters;
  return {
    q: filters.q ?? "",
    season: filters.season ?? "",
    inventory: filters.inventory ?? "",
    inventoryValue: filters.inventoryValue ?? "",
    updated: filters.updated ?? "",
    vendors: filters.vendors ?? [],
    types: filters.types ?? [],
    tags: filters.tags ?? [],
    collectionIds: filters.collectionIds ?? [],
    collectionTitles: sanitizeAiCollectionFilterValues(
      filters.collectionTitles ?? [],
    ),
    taxonomyJoin: filters.taxonomyJoin ?? "and",
    vendorJoin: filters.vendorJoin ?? "any",
    typeJoin: filters.typeJoin ?? "any",
    tagJoin: filters.tagJoin ?? "any",
    collectionJoin: filters.collectionJoin ?? "any",
    tab: filters.tab ?? "all",
    bulk: true,
    maxProducts: 100,
  };
}

async function hydratePlanWithCatalogPreview(
  plan: AiWizardPlan,
  context: AiToolContext,
  toolCalls: AiWizardToolResult[],
) {
  let nextPlan = plan;
  const filters = productFiltersForTool(nextPlan);
  if (!hasPlanProducts(nextPlan) && hasUsableProductFilters(filters)) {
    const productPreviewResult = await runAiWizardTool(
      context,
      "preview_matching_products",
      {
        filters,
        limit: 100,
      },
    );
    toolCalls.push(productPreviewResult);
    const data = toolDataObject(productPreviewResult);
    const products = Array.isArray(data?.products)
      ? (data.products as AiWizardPlan["productMatchPreview"]["products"])
      : [];

    if (products.length) {
      nextPlan = {
        ...nextPlan,
        productMatchPreview: {
          estimatedTotal:
            typeof data?.estimatedTotal === "number"
              ? data.estimatedTotal
              : nextPlan.productMatchPreview.estimatedTotal,
          sampledCount:
            typeof data?.sampledCount === "number"
              ? data.sampledCount
              : products.length,
          bulkLimited: Boolean(data?.bulkLimited),
          querySummary:
            typeof data?.shopifyQuery === "string" && data.shopifyQuery
              ? data.shopifyQuery
              : nextPlan.productMatchPreview.querySummary,
          products,
        },
      };
    }
  }

  const redirectRules = nextPlan.prefill?.redirectRules?.length
    ? nextPlan.prefill.redirectRules
    : nextPlan.suggestedRedirectRules;
  if (
    hasPlanProducts(nextPlan) &&
    redirectRules.length &&
    !nextPlan.redirectPreview.length
  ) {
    const redirectPreviewResult = await runAiWizardTool(
      context,
      "preview_redirects",
      {
        filters,
        redirect_rules: redirectRules,
        limit: 100,
      },
    );
    toolCalls.push(redirectPreviewResult);
    const data = toolDataObject(redirectPreviewResult);
    const redirectPreview = Array.isArray(data?.redirectPreview)
      ? (data.redirectPreview as AiWizardPlan["redirectPreview"])
      : [];
    const targets = Array.isArray(data?.targets)
      ? (data.targets as AiWizardPlan["suggestedRedirectTargets"])
      : [];

    if (redirectPreview.length) {
      nextPlan = {
        ...nextPlan,
        redirectPreview,
        suggestedRedirectTargets: targets.length
          ? targets
          : nextPlan.suggestedRedirectTargets,
      };
    }
  }

  return nextPlan;
}

function shouldTryFallback(plan: AiWizardPlan, model: string) {
  if (!AI_WIZARD_FALLBACK_MODEL || AI_WIZARD_FALLBACK_MODEL === model)
    return false;
  if (
    plan.nextStep === "ask_clarifying_question" &&
    plan.clarifyingQuestions.length > 0
  ) {
    return false;
  }
  if (
    hasPlanProducts(plan) ||
    hasUsableProductFilters(plan.prefill.productFilters) ||
    plan.prefill.redirectRules.length ||
    plan.suggestedRedirectRules.length
  ) {
    return false;
  }
  if (plan.confidence >= 0.68 && !plan.fallbackRecommended) return false;
  return plan.fallbackRecommended || plan.confidence < 0.35;
}

function modelReasoningEffort(model: string, fallback: boolean) {
  if (process.env.AI_WIZARD_REASONING_EFFORT) {
    return process.env.AI_WIZARD_REASONING_EFFORT;
  }
  if (fallback) return "medium";
  if (model.includes("nano")) return "low";
  return "low";
}

function buildInitialInput(request: AiWizardRequest): ResponseInputItem[] {
  const userPayload = {
    userGoal: request.userGoal,
    previousPlan: request.previousPlan ?? null,
    expectedOutput:
      "Return a strict JSON cleanup plan. If essential product-scope or filter data is missing and no clarification answers were provided, set nextStep to ask_clarifying_question and include all needed multiple-choice clarifyingQuestions at once. Do not ask destination, review, apply, or final-confirmation questions; those are handled by the existing app flow. If clarification answers or previousPlan are present, do not ask another clarification round.",
  };

  return [
    {
      role: "developer",
      content: AI_WIZARD_DEVELOPER_PROMPT,
    },
    {
      role: "user",
      content: JSON.stringify(userPayload),
    },
  ] as unknown as ResponseInputItem[];
}

async function createResponse({
  client,
  model,
  input,
  shop,
  fallback,
  allowTools = true,
}: {
  client: OpenAI;
  model: string;
  input: ResponseInputItem[];
  shop: string;
  fallback: boolean;
  allowTools?: boolean;
}) {
  const response = await client.responses.create({
    model,
    input,
    tools: allowTools ? AI_WIZARD_TOOLS : [],
    tool_choice: allowTools ? "auto" : "none",
    parallel_tool_calls: false,
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: fallback ? 5000 : 3500,
    reasoning: {
      effort: modelReasoningEffort(model, fallback),
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "ai_wizard_plan",
        strict: true,
        schema: AI_WIZARD_PLAN_JSON_SCHEMA,
      },
    },
    safety_identifier: hashShop(shop),
    metadata: {
      feature: "ai_cleanup_wizard",
      shop_hash: hashShop(shop).slice(0, 16),
    },
  } as unknown as Parameters<typeof client.responses.create>[0]);
  return response as OpenAIResponse;
}

async function runModelAttempt({
  client,
  context,
  request,
  model,
  fallback,
}: {
  client: OpenAI;
  context: AiToolContext;
  request: AiWizardRequest;
  model: string;
  fallback: boolean;
}) {
  const toolCalls: AiWizardToolResult[] = [];
  let input = buildInitialInput(request);
  let response: OpenAIResponse | null = null;

  for (let round = 0; round < AI_WIZARD_MAX_TOOL_ROUNDS; round += 1) {
    response = await createResponse({
      client,
      model,
      input,
      shop: context.shop,
      fallback,
      allowTools: true,
    });

    const calls = (response.output ?? []).filter(isFunctionCall);
    if (!calls.length) {
      const hydratedPlan = await hydratePlanWithCatalogPreview(
        parsePlan(response),
        context,
        toolCalls,
      );
      const plan = normalizePlanSafety(hydratedPlan, request);
      return {
        plan,
        response,
        toolCalls,
        exhaustedToolRounds: false,
      };
    }

    const outputItems: ResponseInputItem[] = [];
    for (const call of calls) {
      const result = await runAiWizardTool(
        context,
        call.name,
        parseFunctionArguments(call.arguments),
      );
      toolCalls.push(result);
      outputItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      } as ResponseInputItem);
    }

    input = [
      ...input,
      ...((response.output ?? []) as ResponseInputItem[]),
      ...outputItems,
    ];
  }

  if (!response) {
    throw new Error("OpenAI did not return a response.");
  }

  logger.warn("ai_wizard.tool_rounds_exhausted", {
    model,
    toolCalls: toolCalls.length,
  });

  response = await createResponse({
    client,
    model,
    input,
    shop: context.shop,
    fallback,
    allowTools: false,
  });

  const hydratedPlan = await hydratePlanWithCatalogPreview(
    parsePlan(response),
    context,
    toolCalls,
  );
  const plan = normalizePlanSafety(hydratedPlan, request);
  return {
    plan: {
      ...plan,
      fallbackRecommended: true,
      warnings: [
        ...plan.warnings,
        safetyWarning(
          "tool_round_limit",
          "The AI reached the internal tool round limit before completing every check.",
        ),
      ],
    },
    response,
    toolCalls,
    exhaustedToolRounds: true,
  };
}

export async function createAiWizardPlan({
  admin,
  shop,
  request,
}: {
  admin: AdminGraphqlClient;
  shop: string;
  request: AiWizardRequest;
}): Promise<AiWizardResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiWizardConfigurationError(
      "OPENAI_API_KEY is required to use the AI cleanup wizard.",
    );
  }

  const userGoal = request.userGoal.trim();
  if (!userGoal) {
    throw new Error("A cleanup goal is required.");
  }

  const client = new OpenAI({ apiKey });
  const context = { admin, shop };
  const defaultModel = AI_WIZARD_DEFAULT_MODEL;

  let attempt = await runModelAttempt({
    client,
    context,
    request: { ...request, userGoal },
    model: defaultModel,
    fallback: false,
  });
  let model = defaultModel;
  let fallbackUsed = false;

  if (shouldTryFallback(attempt.plan, defaultModel)) {
    logger.info("ai_wizard.fallback_model.start", {
      defaultModel,
      fallbackModel: AI_WIZARD_FALLBACK_MODEL,
      confidence: attempt.plan.confidence,
      fallbackRecommended: attempt.plan.fallbackRecommended,
    });

    try {
      attempt = await runModelAttempt({
        client,
        context,
        request: { ...request, userGoal },
        model: AI_WIZARD_FALLBACK_MODEL,
        fallback: true,
      });
      model = AI_WIZARD_FALLBACK_MODEL;
      fallbackUsed = true;
    } catch (error) {
      logger.warn("ai_wizard.fallback_model.failed", {
        error: logger.serializeError(error),
      });
    }
  }

  logger.info("ai_wizard.plan.created", {
    model,
    fallbackUsed,
    confidence: attempt.plan.confidence,
    nextStep: attempt.plan.nextStep,
    toolCalls: attempt.toolCalls.length,
  });

  return {
    ok: true,
    plan: attempt.plan,
    model,
    fallbackUsed,
    toolCalls: attempt.toolCalls,
    responseId: attempt.response.id ?? null,
    usage: attempt.response.usage ?? null,
  };
}
