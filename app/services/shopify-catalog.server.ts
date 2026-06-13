import { logger } from "../logger.server";
import type { ProductRow } from "./cleanup-rules";

export type AdminGraphqlClient = {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
};

export type CatalogLookupKind = "collection" | "vendor" | "productType" | "tag";

export type CatalogLookupOption = {
  label: string;
  value: string;
  handle?: string;
};

export type TaxonomyJoin = "and" | "or";
export type TaxonomyValueJoin = "any" | "all";

export type CleanupProductFilters = {
  q?: string | null;
  season?: string | null;
  inventory?: string | null;
  inventoryValue?: string | number | null;
  updated?: string | null;
  vendors?: string[] | null;
  types?: string[] | null;
  tags?: string[] | null;
  collectionIds?: string[] | null;
  collectionTitles?: string[] | null;
  taxonomyJoin?: TaxonomyJoin | string | null;
  vendorJoin?: TaxonomyValueJoin | string | null;
  typeJoin?: TaxonomyValueJoin | string | null;
  tagJoin?: TaxonomyValueJoin | string | null;
  collectionJoin?: TaxonomyValueJoin | string | null;
  tab?: string | null;
  after?: string | null;
  first?: number | null;
  bulk?: boolean | null;
  maxProducts?: number | null;
};

export type ProductFilterContext = {
  q: string;
  season: string;
  inventory: string;
  inventoryThreshold: number | null;
  updated: string;
  vendors: string[];
  types: string[];
  tags: string[];
  collectionIds: string[];
  collectionTitles: string[];
  taxonomyJoin: TaxonomyJoin;
  vendorJoin: TaxonomyValueJoin;
  typeJoin: TaxonomyValueJoin;
  tagJoin: TaxonomyValueJoin;
  collectionJoin: TaxonomyValueJoin;
  tab: string;
  after: string | null;
  first: number;
  bulk: boolean;
  maxProducts: number;
};

export type ProductPageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

export type ProductLoadResult = {
  products: ProductRow[];
  pageInfo: ProductPageInfo;
  bulkLimited: boolean;
  counts: null;
  query: string;
  sortKey: string;
  filters: ProductFilterContext;
};

const PRODUCTS_QUERY = `#graphql
  query GetProductsToRetire(
    $first: Int!
    $after: String
    $query: String
    $sortKey: ProductSortKeys
  ) {
    products(first: $first, after: $after, query: $query, sortKey: $sortKey) {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          totalInventory
          tags
          createdAt
          updatedAt
          featuredImage {
            url
            altText
          }
          collections(first: 20) {
            edges {
              node {
                id
                title
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                sku
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
` as string;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query GetCollectionProductsToRetire(
    $id: ID!
    $first: Int!
    $after: String
    $sortKey: ProductCollectionSortKeys
  ) {
    collection(id: $id) {
      products(first: $first, after: $after, sortKey: $sortKey) {
        edges {
          node {
            id
            title
            handle
            status
            vendor
            productType
            totalInventory
            tags
            createdAt
            updatedAt
            featuredImage {
              url
              altText
            }
            collections(first: 20) {
              edges {
                node {
                  id
                  title
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  sku
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  }
` as string;

const FILTERS_QUERY = `#graphql
  query GetProductFilters {
    collections(first: 100, sortKey: TITLE) {
      nodes {
        id
        title
        handle
      }
    }
    productVendors(first: 100) {
      nodes
    }
    productTypes(first: 100) {
      nodes
    }
    productTags(first: 100) {
      nodes
    }
  }
` as string;

const COLLECTION_LOOKUP_QUERY = `#graphql
  query CollectionLookup(
    $first: Int!
    $query: String
    $sortKey: CollectionSortKeys
  ) {
    collections(first: $first, query: $query, sortKey: $sortKey) {
      nodes {
        id
        title
        handle
      }
    }
  }
` as string;

const VENDOR_LOOKUP_QUERY = `#graphql
  query VendorLookup($first: Int!, $stringFirst: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: RELEVANCE) {
      nodes {
        vendor
      }
    }
    productVendors(first: $stringFirst) {
      nodes
    }
  }
` as string;

const PRODUCT_TYPE_LOOKUP_QUERY = `#graphql
  query ProductTypeLookup($first: Int!, $stringFirst: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: RELEVANCE) {
      nodes {
        productType
      }
    }
    productTypes(first: $stringFirst) {
      nodes
    }
  }
` as string;

const TAG_LOOKUP_QUERY = `#graphql
  query TagLookup($first: Int!, $stringFirst: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: RELEVANCE) {
      nodes {
        tags
      }
    }
    productTags(first: $stringFirst) {
      nodes
    }
  }
` as string;

const CATALOG_LOOKUP_LIMIT = 20;
const STRING_LOOKUP_SAMPLE_LIMIT = 100;
const PRODUCT_LOOKUP_SAMPLE_LIMIT = 50;
const COLLECTION_CURSOR_PREFIX = "collection:";
const COLLECTION_PRODUCT_PAGE_SIZE = 250;
const PRODUCT_PAGE_SIZE_OPTIONS = [20, 40, 60, 100, 150, 250] as const;
const DEFAULT_PRODUCT_PAGE_SIZE = PRODUCT_PAGE_SIZE_OPTIONS[0];
const MAX_PRODUCT_PAGE_SIZE =
  PRODUCT_PAGE_SIZE_OPTIONS[PRODUCT_PAGE_SIZE_OPTIONS.length - 1];
const DEFAULT_AI_MAX_PRODUCTS = 100;

const emptyPageInfo: ProductPageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

function quoteSearchValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function joinQuery(parts: string[]) {
  return parts.filter(Boolean).join(" AND ");
}

function compactValues(values: string[] | null | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function normalizeTaxonomyJoin(value: string | null | undefined): TaxonomyJoin {
  return value === "or" ? "or" : "and";
}

function normalizeTaxonomyValueJoin(
  value: string | null | undefined,
): TaxonomyValueJoin {
  return value === "all" ? "all" : "any";
}

function escapeRegexValue(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function valueContainsWildcard(value: string) {
  return value.includes("*");
}

function wildcardPattern(value: string) {
  const trimmed = value.trim();
  if (!valueContainsWildcard(trimmed)) return null;
  return new RegExp(
    `^${trimmed.split("*").map(escapeRegexValue).join(".*")}$`,
    "i",
  );
}

function filterValuesContainWildcard(values: string[]) {
  return values.some(valueContainsWildcard);
}

function fieldQueryFromValues(
  field: string,
  values: string[],
  join: TaxonomyValueJoin = "any",
) {
  if (filterValuesContainWildcard(values) && join === "any") return "";

  const parts = values
    .filter((value) => !valueContainsWildcard(value))
    .map((value) => `${field}:${quoteSearchValue(value)}`);
  if (parts.length <= 1) return parts[0] ?? "";
  return `(${parts.join(join === "all" ? " AND " : " OR ")})`;
}

function taxonomyQueryParts(
  filters: Pick<
    ProductFilterContext,
    | "taxonomyJoin"
    | "vendorJoin"
    | "typeJoin"
    | "tagJoin"
    | "vendors"
    | "types"
    | "tags"
  >,
) {
  const hasOrWildcard =
    filters.taxonomyJoin === "or" &&
    (filterValuesContainWildcard(filters.vendors) ||
      filterValuesContainWildcard(filters.types) ||
      filterValuesContainWildcard(filters.tags));
  if (hasOrWildcard) return [];

  const parts = [
    fieldQueryFromValues("vendor", filters.vendors, filters.vendorJoin),
    fieldQueryFromValues("product_type", filters.types, filters.typeJoin),
    fieldQueryFromValues("tag", filters.tags, filters.tagJoin),
  ].filter(Boolean);

  if (filters.taxonomyJoin === "or" && parts.length > 1) {
    return [`(${parts.join(" OR ")})`];
  }

  return parts;
}

function daysAgoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function updatedQuery(value: string) {
  if (value === "90d") return `updated_at:<${daysAgoDate(90)}`;
  if (value === "180d") return `updated_at:<${daysAgoDate(180)}`;
  if (value === "365d") return `updated_at:<${daysAgoDate(365)}`;
  return "";
}

function updatedCutoffDate(value: string) {
  if (value === "90d") return daysAgoDate(90);
  if (value === "180d") return daysAgoDate(180);
  if (value === "365d") return daysAgoDate(365);
  return "";
}

function inventoryThresholdValue(value: string | number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function requestedPageSize(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_PRODUCT_PAGE_SIZE;
  const rounded = Math.floor(value);
  if (
    PRODUCT_PAGE_SIZE_OPTIONS.includes(
      rounded as (typeof PRODUCT_PAGE_SIZE_OPTIONS)[number],
    )
  ) {
    return rounded;
  }
  return Math.max(
    DEFAULT_PRODUCT_PAGE_SIZE,
    Math.min(MAX_PRODUCT_PAGE_SIZE, rounded),
  );
}

function lookupQueryValue(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function lookupOptionRank(label: string, query: string) {
  const normalizedLabel = label.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (normalizedLabel === normalizedQuery) return 0;
  if (normalizedLabel.startsWith(normalizedQuery)) return 1;
  if (normalizedLabel.includes(normalizedQuery)) return 2;
  return 3;
}

function stringLookupOptions(
  values: string[],
  query: string,
): CatalogLookupOption[] {
  const normalizedQuery = query.toLowerCase();
  const unique = new Map<string, string>();

  values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.toLowerCase().includes(normalizedQuery))
    .forEach((value) => {
      const key = value.toLowerCase();
      if (!unique.has(key)) unique.set(key, value);
    });

  return [...unique.values()]
    .sort((a, b) => {
      const rankDelta = lookupOptionRank(a, query) - lookupOptionRank(b, query);
      return rankDelta || a.localeCompare(b);
    })
    .slice(0, CATALOG_LOOKUP_LIMIT)
    .map((value) => ({ label: value, value }));
}

function productFromNode(node: {
  id?: string;
  title?: string;
  handle?: string;
  status?: string;
  vendor?: string | null;
  productType?: string | null;
  totalInventory?: number | null;
  tags?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  featuredImage?: { url?: string | null; altText?: string | null } | null;
  collections?: {
    edges?: Array<{
      node?: { id?: string | null; title?: string | null } | null;
    }> | null;
  } | null;
  variants?: {
    edges?: Array<{ node?: { sku?: string | null } | null }> | null;
  } | null;
}): ProductRow & { collectionIds: string[] } {
  const title = node.title ?? "";
  const collectionEdges = node.collections?.edges ?? [];
  return {
    id: node.id ?? "",
    name: title,
    handle: node.handle ?? "",
    status:
      ((node.status ?? "active").toLowerCase() as ProductRow["status"]) ||
      "active",
    vendor: node.vendor ?? "",
    type: node.productType ?? "",
    inventory: node.totalInventory ?? null,
    sku: node.variants?.edges?.[0]?.node?.sku ?? "",
    imageUrl: node.featuredImage?.url ?? "",
    imageAlt: node.featuredImage?.altText ?? title,
    collections: collectionEdges
      .map(({ node: collection }) => collection?.title ?? "")
      .filter(Boolean),
    collectionIds: collectionEdges
      .map(({ node: collection }) => collection?.id ?? "")
      .filter(Boolean),
    tags: (node.tags ?? []).filter(Boolean),
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
  };
}

function collectionCursor(offset: number) {
  return `${COLLECTION_CURSOR_PREFIX}${Math.max(0, offset)}`;
}

function collectionCursorOffset(cursor: string | null) {
  if (!cursor?.startsWith(COLLECTION_CURSOR_PREFIX)) return 0;
  const parsed = Number(cursor.slice(COLLECTION_CURSOR_PREFIX.length));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function textMatches(value: string, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const normalizedValue = value.toLowerCase();
  return terms.every((term) => normalizedValue.includes(term));
}

function productMatchesText(product: ProductRow, query: string) {
  if (!query) return true;
  return textMatches(
    [
      product.name,
      product.handle,
      product.vendor,
      product.type,
      product.sku,
      ...product.collections,
      ...product.tags,
    ].join(" "),
    query,
  );
}

function valueMatchesExpected(actual: string, expected: string) {
  const trimmedExpected = expected.trim();
  const pattern = wildcardPattern(trimmedExpected);
  if (pattern) return pattern.test(actual);
  return actual.toLowerCase().includes(trimmedExpected.toLowerCase());
}

function productFiltersNeedPostFilter(filters: ProductFilterContext) {
  return (
    filterValuesContainWildcard(filters.vendors) ||
    filterValuesContainWildcard(filters.types) ||
    filterValuesContainWildcard(filters.tags) ||
    filterValuesContainWildcard(filters.collectionTitles) ||
    (!filters.collectionIds.length && filters.collectionTitles.length > 0)
  );
}

function valueMatchesFilter(
  actual: string,
  expectedValues: string[],
  join: TaxonomyValueJoin = "any",
) {
  if (!expectedValues.length) return true;
  const matcher = (expected: string) => valueMatchesExpected(actual, expected);
  return join === "all"
    ? expectedValues.every(matcher)
    : expectedValues.some(matcher);
}

function arrayMatchesFilter(
  actualValues: string[],
  expectedValues: string[],
  join: TaxonomyValueJoin = "any",
) {
  if (!expectedValues.length) return true;
  if (join === "all") {
    return expectedValues.every((expected) =>
      actualValues.some((actual) => valueMatchesExpected(actual, expected)),
    );
  }

  return actualValues.some((actual) =>
    valueMatchesFilter(actual, expectedValues),
  );
}

function productCollectionIds(product: ProductRow) {
  return (
    (product as ProductRow & { collectionIds?: string[] }).collectionIds ?? []
  ).filter(Boolean);
}

function productMatchesCollections(
  product: ProductRow,
  filters: ProductFilterContext,
) {
  const hasCollectionFilter =
    filters.collectionIds.length > 0 || filters.collectionTitles.length > 0;
  if (!hasCollectionFilter) return true;

  const ids = productCollectionIds(product);
  const matches = [
    ...filters.collectionIds.map((collectionId) =>
      ids.some((actualId) => valueMatchesExpected(actualId, collectionId)),
    ),
    ...filters.collectionTitles.map((collectionTitle) =>
      product.collections.some((actualTitle) =>
        valueMatchesExpected(actualTitle, collectionTitle),
      ),
    ),
  ];

  if (!matches.length) return true;
  return filters.collectionJoin === "all"
    ? matches.every(Boolean)
    : matches.some(Boolean);
}

function productMatchesTaxonomy(
  product: ProductRow,
  filters: ProductFilterContext,
) {
  const matches: boolean[] = [];

  if (filters.vendors.length) {
    matches.push(
      valueMatchesFilter(product.vendor, filters.vendors, filters.vendorJoin),
    );
  }

  if (filters.types.length) {
    matches.push(
      valueMatchesFilter(product.type, filters.types, filters.typeJoin),
    );
  }

  if (filters.tags.length) {
    matches.push(
      arrayMatchesFilter(product.tags, filters.tags, filters.tagJoin),
    );
  }

  if (filters.collectionIds.length || filters.collectionTitles.length) {
    matches.push(productMatchesCollections(product, filters));
  }

  if (!matches.length) return true;
  return filters.taxonomyJoin === "or"
    ? matches.some(Boolean)
    : matches.every(Boolean);
}

function productMatchesInventory(
  product: ProductRow,
  inventory: string,
  threshold: number | null,
) {
  if (!inventory) return true;
  if (product.inventory === null) return false;

  if (inventory === "out") return product.inventory === 0;
  if (inventory === "available") return product.inventory > 0;
  if (inventory === "low")
    return product.inventory > 0 && product.inventory < 5;
  if (inventory === "healthy") return product.inventory > 4;
  if (inventory === "overstock") return product.inventory > 99;
  if (inventory === "below" && threshold !== null)
    return product.inventory < threshold;
  if (inventory === "above" && threshold !== null)
    return product.inventory > threshold;

  return true;
}

function productMatchesFilters(
  product: ProductRow,
  filters: ProductFilterContext,
) {
  if (filters.tab === "active" && product.status !== "active") return false;
  if (filters.tab === "archived" && product.status !== "archived") return false;
  if (filters.tab === "draft" && product.status !== "draft") return false;
  if (filters.tab === "oos" && product.inventory !== 0) return false;
  if (!productMatchesText(product, filters.q)) return false;
  if (!productMatchesText(product, filters.season)) return false;
  if (!productMatchesTaxonomy(product, filters)) return false;
  if (
    !productMatchesInventory(
      product,
      filters.inventory,
      filters.inventoryThreshold,
    )
  ) {
    return false;
  }

  const updatedCutoff = updatedCutoffDate(filters.updated);
  if (
    updatedCutoff &&
    (!product.updatedAt || product.updatedAt >= updatedCutoff)
  ) {
    return false;
  }

  return true;
}

function productSortKey({
  q,
  season,
  inventory,
  updated,
  vendors,
  types,
  tab,
}: Pick<
  ProductFilterContext,
  "q" | "season" | "inventory" | "updated" | "vendors" | "types" | "tab"
>) {
  if (q || season) return "RELEVANCE";
  if (inventory || tab === "oos") return "INVENTORY_TOTAL";
  if (updated) return "UPDATED_AT";
  if (vendors.length === 1) return "VENDOR";
  if (types.length === 1) return "PRODUCT_TYPE";
  return "ID";
}

export function normalizeProductFilters(
  input: CleanupProductFilters = {},
): ProductFilterContext {
  const first = requestedPageSize(input.first ?? DEFAULT_PRODUCT_PAGE_SIZE);
  const maxProducts =
    typeof input.maxProducts === "number" && Number.isFinite(input.maxProducts)
      ? Math.max(first, Math.min(1000, Math.floor(input.maxProducts)))
      : DEFAULT_AI_MAX_PRODUCTS;

  return {
    q: lookupQueryValue(input.q ?? ""),
    season: lookupQueryValue(input.season ?? ""),
    inventory: lookupQueryValue(input.inventory ?? ""),
    inventoryThreshold: inventoryThresholdValue(input.inventoryValue),
    updated: lookupQueryValue(input.updated ?? ""),
    vendors: compactValues(input.vendors),
    types: compactValues(input.types),
    tags: compactValues(input.tags),
    collectionIds: compactValues(input.collectionIds),
    collectionTitles: compactValues(input.collectionTitles),
    taxonomyJoin: normalizeTaxonomyJoin(input.taxonomyJoin),
    vendorJoin: normalizeTaxonomyValueJoin(input.vendorJoin),
    typeJoin: normalizeTaxonomyValueJoin(input.typeJoin),
    tagJoin: normalizeTaxonomyValueJoin(input.tagJoin),
    collectionJoin: normalizeTaxonomyValueJoin(input.collectionJoin),
    tab: lookupQueryValue(input.tab ?? "all") || "all",
    after: input.after?.trim() || null,
    first,
    bulk: Boolean(input.bulk),
    maxProducts,
  };
}

export function buildShopifyProductQuery(filters: ProductFilterContext) {
  const baseParts: string[] = [];
  if (filters.q) baseParts.push(filters.q);
  if (filters.season) baseParts.push(filters.season);
  baseParts.push(...taxonomyQueryParts(filters));
  if (filters.inventory === "out") baseParts.push("inventory_total:0");
  if (filters.inventory === "available") baseParts.push("inventory_total:>0");
  if (filters.inventory === "low") {
    baseParts.push("inventory_total:>0");
    baseParts.push("inventory_total:<5");
  }
  if (filters.inventory === "healthy") baseParts.push("inventory_total:>4");
  if (filters.inventory === "overstock") baseParts.push("inventory_total:>99");
  if (filters.inventory === "below" && filters.inventoryThreshold !== null) {
    baseParts.push(`inventory_total:<${filters.inventoryThreshold}`);
  }
  if (filters.inventory === "above" && filters.inventoryThreshold !== null) {
    baseParts.push(`inventory_total:>${filters.inventoryThreshold}`);
  }
  const updatedPart = updatedQuery(filters.updated);
  if (updatedPart) baseParts.push(updatedPart);

  const parts = [...baseParts];
  if (filters.tab === "active") parts.push("status:active");
  else if (filters.tab === "archived") parts.push("status:archived");
  else if (filters.tab === "draft") parts.push("status:draft");
  else if (filters.tab === "oos") parts.push("inventory_total:0");

  return joinQuery(parts);
}

async function loadFilteredCollectionProducts({
  admin,
  collectionIds,
  filters,
}: {
  admin: AdminGraphqlClient;
  collectionIds: string[];
  filters: ProductFilterContext;
}) {
  const skipMatches = filters.bulk ? 0 : collectionCursorOffset(filters.after);
  const requiredMatches = filters.bulk
    ? filters.maxProducts
    : skipMatches + filters.first + 1;
  const matches: ProductRow[] = [];
  const seenProducts = new Set<string>();
  let scannedProducts = 0;
  let hasMoreCollectionProducts = false;

  for (const [collectionIndex, collectionId] of collectionIds.entries()) {
    let graphCursor: string | null = null;

    while (matches.length < requiredMatches) {
      const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
        variables: {
          id: collectionId,
          first: COLLECTION_PRODUCT_PAGE_SIZE,
          after: graphCursor,
          sortKey: "ID",
        },
      });
      const json = (await response.json()) as {
        data?: {
          collection?: {
            products?: {
              edges?: Array<{ node?: Parameters<typeof productFromNode>[0] }>;
              pageInfo?: ProductPageInfo;
            };
          } | null;
        };
        errors?: { message?: string }[];
      };

      if (json.errors?.length) {
        throw new Error(
          json.errors[0]?.message ?? "Collection products failed to load.",
        );
      }

      const collection = json.data?.collection;
      if (!collection) {
        throw new Error("Collection was not found.");
      }

      const productsConnection = collection.products;
      const edges = productsConnection?.edges ?? [];
      const rawPageInfo = productsConnection?.pageInfo;

      for (const edge of edges) {
        if (!edge.node) continue;
        scannedProducts += 1;
        const product = productFromNode(edge.node);
        if (
          !seenProducts.has(product.id) &&
          productMatchesFilters(product, filters)
        ) {
          seenProducts.add(product.id);
          matches.push(product);
        }
        if (matches.length >= requiredMatches) break;
      }

      hasMoreCollectionProducts =
        Boolean(rawPageInfo?.hasNextPage) ||
        collectionIndex < collectionIds.length - 1;
      graphCursor = rawPageInfo?.endCursor ?? null;
      if (!rawPageInfo?.hasNextPage || !graphCursor) break;
    }

    if (matches.length >= requiredMatches) break;
  }

  const pageProducts = filters.bulk
    ? matches.slice(0, filters.maxProducts)
    : matches.slice(skipMatches, skipMatches + filters.first);
  const hasNextPage = filters.bulk
    ? false
    : matches.length > skipMatches + filters.first;
  const bulkLimited =
    filters.bulk &&
    hasMoreCollectionProducts &&
    matches.length >= filters.maxProducts;

  return {
    products: pageProducts,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: skipMatches > 0,
      startCursor:
        skipMatches > 0
          ? collectionCursor(Math.max(0, skipMatches - filters.first))
          : null,
      endCursor: hasNextPage
        ? collectionCursor(skipMatches + filters.first)
        : null,
    },
    bulkLimited,
    scannedProducts,
  };
}

async function loadPostFilteredProducts({
  loadPage,
  filters,
}: {
  loadPage(cursor: string | null): Promise<Response>;
  filters: ProductFilterContext;
}) {
  const skipMatches = filters.bulk ? 0 : collectionCursorOffset(filters.after);
  const requiredMatches = filters.bulk
    ? filters.maxProducts
    : skipMatches + filters.first + 1;
  const matches: ProductRow[] = [];
  let graphCursor: string | null = null;
  let scannedProducts = 0;
  let hasMoreProducts = false;

  while (matches.length < requiredMatches) {
    const response = await loadPage(graphCursor);
    const json = (await response.json()) as {
      data?: {
        products?: {
          edges?: Array<{ node?: Parameters<typeof productFromNode>[0] }>;
          pageInfo?: ProductPageInfo;
        };
      };
      errors?: { message?: string }[];
    };

    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "Shopify returned an error.");
    }

    const productsConnection = json.data?.products;
    const edges = productsConnection?.edges ?? [];
    const rawPageInfo = productsConnection?.pageInfo ?? emptyPageInfo;

    for (const edge of edges) {
      if (!edge.node) continue;
      scannedProducts += 1;
      const product = productFromNode(edge.node);
      if (productMatchesFilters(product, filters)) matches.push(product);
      if (matches.length >= requiredMatches) break;
    }

    hasMoreProducts = rawPageInfo.hasNextPage;
    graphCursor = rawPageInfo.endCursor;
    if (!rawPageInfo.hasNextPage || !graphCursor) break;
  }

  const products = filters.bulk
    ? matches.slice(0, filters.maxProducts)
    : matches.slice(skipMatches, skipMatches + filters.first);
  const hasNextPage = filters.bulk
    ? false
    : matches.length > skipMatches + filters.first;
  const bulkLimited =
    filters.bulk && hasMoreProducts && matches.length >= filters.maxProducts;

  return {
    products,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: skipMatches > 0,
      startCursor:
        skipMatches > 0
          ? collectionCursor(Math.max(0, skipMatches - filters.first))
          : null,
      endCursor: hasNextPage
        ? collectionCursor(skipMatches + filters.first)
        : null,
    },
    bulkLimited,
    scannedProducts,
  };
}

export async function loadProductFilterOptions(admin: AdminGraphqlClient) {
  const filtersRes = await admin.graphql(FILTERS_QUERY);
  const filtersJson = (await filtersRes.json()) as {
    data?: {
      collections?: {
        nodes?: Array<{ id?: string; title?: string; handle?: string }>;
      };
      productVendors?: { nodes?: string[] };
      productTypes?: { nodes?: string[] };
      productTags?: { nodes?: string[] };
    };
    errors?: { message?: string }[];
  };
  if (filtersJson.errors?.length) {
    return {
      collections: [],
      vendors: [],
      productTypes: [],
      tags: [],
      errors: filtersJson.errors,
    };
  }

  return {
    collections: (filtersJson.data?.collections?.nodes ?? [])
      .filter((node) => node.id && node.title)
      .map((node) => ({
        id: node.id as string,
        title: node.title as string,
        handle: node.handle ?? "",
      })),
    vendors: (filtersJson.data?.productVendors?.nodes ?? []).filter(Boolean),
    productTypes: (filtersJson.data?.productTypes?.nodes ?? []).filter(Boolean),
    tags: (filtersJson.data?.productTags?.nodes ?? []).filter(Boolean),
    errors: null,
  };
}

export async function loadCatalogLookupOptions(
  admin: AdminGraphqlClient,
  kind: CatalogLookupKind,
  queryInput: string,
) {
  const query = lookupQueryValue(queryInput);
  if (query.length < 2) return [];

  if (kind === "collection") {
    const response = await admin.graphql(COLLECTION_LOOKUP_QUERY, {
      variables: {
        first: CATALOG_LOOKUP_LIMIT,
        query,
        sortKey: "RELEVANCE",
      },
    });
    const json = (await response.json()) as {
      data?: {
        collections?: {
          nodes?: Array<{ id?: string; title?: string; handle?: string }>;
        };
      };
      errors?: { message?: string }[];
    };
    if (json.errors?.length)
      throw new Error(json.errors[0]?.message ?? "Collection lookup failed.");

    return (json.data?.collections?.nodes ?? [])
      .filter((collection) => collection.id && collection.title)
      .map((collection) => ({
        label: collection.title as string,
        value: collection.id as string,
        handle: collection.handle ?? "",
      }));
  }

  const queryForKind =
    kind === "vendor"
      ? VENDOR_LOOKUP_QUERY
      : kind === "productType"
        ? PRODUCT_TYPE_LOOKUP_QUERY
        : TAG_LOOKUP_QUERY;
  const response = await admin.graphql(queryForKind, {
    variables: {
      first: PRODUCT_LOOKUP_SAMPLE_LIMIT,
      stringFirst: STRING_LOOKUP_SAMPLE_LIMIT,
      query,
    },
  });
  const json = (await response.json()) as {
    data?: {
      products?: {
        nodes?: Array<{
          vendor?: string | null;
          productType?: string | null;
          tags?: string[];
        }>;
      };
      productVendors?: { nodes?: string[] };
      productTypes?: { nodes?: string[] };
      productTags?: { nodes?: string[] };
    };
    errors?: { message?: string }[];
  };
  if (json.errors?.length)
    throw new Error(json.errors[0]?.message ?? "Catalog lookup failed.");

  const productNodes = json.data?.products?.nodes ?? [];
  const valuesFromProducts = productNodes.flatMap((product) => {
    if (kind === "vendor") return [product.vendor ?? ""];
    if (kind === "productType") return [product.productType ?? ""];
    return product.tags ?? [];
  });
  const valuesFromConnection =
    kind === "vendor"
      ? (json.data?.productVendors?.nodes ?? [])
      : kind === "productType"
        ? (json.data?.productTypes?.nodes ?? [])
        : (json.data?.productTags?.nodes ?? []);

  return stringLookupOptions(
    [...valuesFromProducts, ...valuesFromConnection],
    query,
  );
}

export async function loadProductsForCleanup(
  admin: AdminGraphqlClient,
  input: CleanupProductFilters = {},
): Promise<ProductLoadResult> {
  const filters = normalizeProductFilters(input);
  const query = buildShopifyProductQuery(filters);
  const sortKey = productSortKey(filters);

  if (filters.collectionIds.length) {
    const hasNonCollectionTaxonomy = Boolean(
      filters.vendors.length || filters.types.length || filters.tags.length,
    );
    const hasCollectionTitlePattern =
      filters.collectionTitles.length > filters.collectionIds.length;

    if (
      (filters.taxonomyJoin === "or" && hasNonCollectionTaxonomy) ||
      (filters.collectionJoin === "any" && hasCollectionTitlePattern)
    ) {
      const collectionResult = await loadFilteredCollectionProducts({
        admin,
        collectionIds: filters.collectionIds,
        filters: {
          ...filters,
          after: null,
          bulk: true,
        },
      });

      const searchEdges: Array<{
        node?: Parameters<typeof productFromNode>[0];
      }> = [];
      const loadSearchPage = (cursor: string | null) =>
        admin.graphql(PRODUCTS_QUERY, {
          variables: {
            first: MAX_PRODUCT_PAGE_SIZE,
            after: cursor,
            query: query || null,
            sortKey,
          },
        });

      let searchRes = await loadSearchPage(null);
      let searchJson = (await searchRes.json()) as {
        data?: {
          products?: {
            edges?: Array<{ node?: Parameters<typeof productFromNode>[0] }>;
            pageInfo?: ProductPageInfo;
          };
        };
        errors?: { message?: string }[];
      };

      if (searchJson.errors?.length) {
        throw new Error(
          searchJson.errors[0]?.message ?? "Shopify returned an error.",
        );
      }

      searchEdges.push(...(searchJson.data?.products?.edges ?? []));
      let searchPageInfo = searchJson.data?.products?.pageInfo ?? emptyPageInfo;

      while (
        searchPageInfo.hasNextPage &&
        searchPageInfo.endCursor &&
        searchEdges.length < filters.maxProducts
      ) {
        searchRes = await loadSearchPage(searchPageInfo.endCursor);
        searchJson = (await searchRes.json()) as typeof searchJson;
        if (searchJson.errors?.length) {
          logger.warn(
            "ai_wizard.products.collection_union.bulk_page.graphql.error",
            {
              errors: searchJson.errors,
              loadedProducts: searchEdges.length,
            },
          );
          break;
        }
        searchEdges.push(...(searchJson.data?.products?.edges ?? []));
        searchPageInfo = searchJson.data?.products?.pageInfo ?? emptyPageInfo;
      }

      const mergedProducts = new Map<string, ProductRow>();
      collectionResult.products.forEach((product) => {
        mergedProducts.set(product.id, product);
      });
      searchEdges
        .map(({ node }) => (node ? productFromNode(node) : null))
        .filter(
          (product): product is ReturnType<typeof productFromNode> =>
            product !== null &&
            Boolean(product.id) &&
            productMatchesFilters(product, filters),
        )
        .forEach((product) => {
          if (!mergedProducts.has(product.id))
            mergedProducts.set(product.id, product);
        });

      const merged = [...mergedProducts.values()].slice(0, filters.maxProducts);
      const skipMatches = filters.bulk
        ? 0
        : collectionCursorOffset(filters.after);
      const products = filters.bulk
        ? merged
        : merged.slice(skipMatches, skipMatches + filters.first);
      const hasNextPage =
        !filters.bulk && merged.length > skipMatches + filters.first;
      const bulkLimited =
        collectionResult.bulkLimited ||
        Boolean(
          searchPageInfo.hasNextPage &&
          searchEdges.length >= filters.maxProducts,
        );

      logger.info("ai_wizard.products.collection_union_preview.loaded", {
        productCount: products.length,
        totalMatched: merged.length,
        hasNextPage,
        bulkLimited,
        scannedProducts: collectionResult.scannedProducts + searchEdges.length,
      });

      return {
        products,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: skipMatches > 0,
          startCursor:
            skipMatches > 0
              ? collectionCursor(Math.max(0, skipMatches - filters.first))
              : null,
          endCursor: hasNextPage
            ? collectionCursor(skipMatches + filters.first)
            : null,
        },
        bulkLimited,
        counts: null,
        query,
        sortKey,
        filters,
      };
    }

    const collectionResult = await loadFilteredCollectionProducts({
      admin,
      collectionIds: filters.collectionIds,
      filters,
    });

    logger.info("ai_wizard.products.collection_preview.loaded", {
      productCount: collectionResult.products.length,
      hasNextPage: collectionResult.pageInfo.hasNextPage,
      bulkLimited: collectionResult.bulkLimited,
      scannedProducts: collectionResult.scannedProducts,
    });

    return {
      products: collectionResult.products,
      pageInfo: collectionResult.pageInfo,
      bulkLimited: collectionResult.bulkLimited,
      counts: null,
      query,
      sortKey,
      filters,
    };
  }

  const first = filters.bulk ? MAX_PRODUCT_PAGE_SIZE : filters.first;
  const loadPage = (cursor: string | null) =>
    admin.graphql(PRODUCTS_QUERY, {
      variables: {
        first,
        after: cursor,
        query: query || null,
        sortKey,
      },
    });

  if (productFiltersNeedPostFilter(filters)) {
    const postFilterResult = await loadPostFilteredProducts({
      loadPage: (cursor) =>
        admin.graphql(PRODUCTS_QUERY, {
          variables: {
            first: MAX_PRODUCT_PAGE_SIZE,
            after: cursor,
            query: query || null,
            sortKey,
          },
        }),
      filters,
    });

    logger.info("ai_wizard.products.post_filter_preview.loaded", {
      productCount: postFilterResult.products.length,
      hasNextPage: postFilterResult.pageInfo.hasNextPage,
      bulkLimited: postFilterResult.bulkLimited,
      scannedProducts: postFilterResult.scannedProducts,
      sortKey,
    });

    return {
      products: postFilterResult.products,
      pageInfo: postFilterResult.pageInfo,
      bulkLimited: postFilterResult.bulkLimited,
      counts: null,
      query,
      sortKey,
      filters,
    };
  }

  const productsRes = await loadPage(filters.bulk ? null : filters.after);
  const productsJson = (await productsRes.json()) as {
    data?: {
      products?: {
        edges?: Array<{ node?: Parameters<typeof productFromNode>[0] }>;
        pageInfo?: ProductPageInfo;
      };
    };
    errors?: { message?: string }[];
  };

  if (productsJson.errors?.length) {
    throw new Error(
      productsJson.errors[0]?.message ?? "Shopify returned an error.",
    );
  }

  const edges = [...(productsJson.data?.products?.edges ?? [])];
  let raw = productsJson.data?.products?.pageInfo ?? emptyPageInfo;
  let bulkLimited = false;

  while (
    filters.bulk &&
    raw.hasNextPage &&
    raw.endCursor &&
    edges.length < filters.maxProducts
  ) {
    const nextRes = await loadPage(raw.endCursor);
    const nextJson = (await nextRes.json()) as typeof productsJson;
    if (nextJson.errors?.length) {
      logger.warn("ai_wizard.products.bulk_page.graphql.error", {
        errors: nextJson.errors,
        loadedProducts: edges.length,
      });
      break;
    }
    edges.push(...(nextJson.data?.products?.edges ?? []));
    raw = nextJson.data?.products?.pageInfo ?? emptyPageInfo;
  }
  if (filters.bulk && raw.hasNextPage && edges.length >= filters.maxProducts) {
    bulkLimited = true;
  }

  const products = edges
    .slice(0, filters.bulk ? filters.maxProducts : edges.length)
    .map(({ node }) => (node ? productFromNode(node) : null))
    .filter((product): product is ReturnType<typeof productFromNode> =>
      Boolean(product?.id),
    );

  const pageInfo = {
    hasNextPage: raw.hasNextPage,
    hasPreviousPage: raw.hasPreviousPage,
    startCursor: raw.startCursor,
    endCursor: raw.endCursor,
  };

  logger.info("ai_wizard.products.preview.loaded", {
    productCount: products.length,
    hasNextPage: pageInfo.hasNextPage,
    bulkLimited,
    sortKey,
  });

  return {
    products,
    pageInfo,
    bulkLimited,
    counts: null,
    query,
    sortKey,
    filters,
  };
}
