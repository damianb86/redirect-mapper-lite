import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { addLogContext, logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";
import { expandProductFilterValues } from "../services/shopify-catalog.server";

// ─── GraphQL ──────────────────────────────────────────────────

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

type CatalogLookupKind = "collection" | "vendor" | "productType" | "tag";
type TaxonomyJoin = "and" | "or";
type TaxonomyValueJoin = "any" | "all";

const CATALOG_LOOKUP_LIMIT = 20;
const STRING_LOOKUP_SAMPLE_LIMIT = 100;
const PRODUCT_LOOKUP_SAMPLE_LIMIT = 50;

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

function quoteSearchValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function joinQuery(parts: string[]) {
  return parts.filter(Boolean).join(" AND ");
}

function searchParamValues(params: URLSearchParams, key: string) {
  return params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
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

function inventoryThresholdValue(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function requestedPageSize(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PRODUCT_PAGE_SIZE;
  const rounded = Math.floor(parsed);
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

function isCatalogLookupKind(value: string | null): value is CatalogLookupKind {
  return (
    value === "collection" ||
    value === "vendor" ||
    value === "productType" ||
    value === "tag"
  );
}

function lookupQueryValue(value: string | null) {
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

function stringLookupOptions(values: string[], query: string) {
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

function productFromNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
) {
  const collectionEdges = node.collections?.edges ?? [];
  return {
    id: node.id as string,
    name: node.title as string,
    handle: node.handle as string,
    status: (node.status as string).toLowerCase() as
      | "active"
      | "archived"
      | "draft",
    vendor: (node.vendor as string) ?? "",
    type: (node.productType as string) ?? "",
    inventory: node.totalInventory as number | null,
    sku: (node.variants?.edges?.[0]?.node?.sku as string) ?? "",
    imageUrl: (node.featuredImage?.url as string) ?? "",
    imageAlt:
      (node.featuredImage?.altText as string | null) ?? (node.title as string),
    collections: collectionEdges.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ node: c }: any) => c.title as string,
    ),
    collectionIds: collectionEdges
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ node: c }: any) => c.id as string,
      )
      .filter(Boolean),
    tags: ((node.tags as string[] | null) ?? []).filter(Boolean),
    createdAt: (node.createdAt as string | null) ?? null,
    updatedAt: (node.updatedAt as string | null) ?? null,
  };
}

type ProductData = ReturnType<typeof productFromNode>;

type ProductFilterContext = {
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
};

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

const COLLECTION_CURSOR_PREFIX = "collection:";
const COLLECTION_PRODUCT_PAGE_SIZE = 250;
const PRODUCT_PAGE_SIZE_OPTIONS = [20, 40, 60, 100, 150, 250] as const;
const DEFAULT_PRODUCT_PAGE_SIZE = PRODUCT_PAGE_SIZE_OPTIONS[0];
const MAX_PRODUCT_PAGE_SIZE =
  PRODUCT_PAGE_SIZE_OPTIONS[PRODUCT_PAGE_SIZE_OPTIONS.length - 1];

function collectionCursor(offset: number) {
  return `${COLLECTION_CURSOR_PREFIX}${Math.max(0, offset)}`;
}

function collectionCursorOffset(cursor: string | null) {
  if (!cursor?.startsWith(COLLECTION_CURSOR_PREFIX)) return 0;
  const parsed = Number(cursor.slice(COLLECTION_CURSOR_PREFIX.length));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function updatedCutoffDate(value: string) {
  if (value === "90d") return daysAgoDate(90);
  if (value === "180d") return daysAgoDate(180);
  if (value === "365d") return daysAgoDate(365);
  return "";
}

function textMatches(value: string, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const normalizedValue = value.toLowerCase();
  return terms.every((term) => normalizedValue.includes(term));
}

function productMatchesText(product: ProductData, query: string) {
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

function productMatchesCollections(
  product: ProductData,
  filters: ProductFilterContext,
) {
  const hasCollectionFilter =
    filters.collectionIds.length > 0 || filters.collectionTitles.length > 0;
  if (!hasCollectionFilter) return true;

  const matches = [
    ...filters.collectionIds.map((collectionId) =>
      product.collectionIds.some((actualId: string) =>
        valueMatchesExpected(actualId, collectionId),
      ),
    ),
    ...filters.collectionTitles.map((collectionTitle) =>
      product.collections.some((actualTitle: string) =>
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
  product: ProductData,
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
  product: ProductData,
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
  product: ProductData,
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

const emptyPageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

function productsErrorResponse(message: string) {
  return {
    products: [],
    pageInfo: emptyPageInfo,
    collections: [],
    vendors: [],
    productTypes: [],
    tags: [],
    bulkLimited: false,
    counts: null,
    error: message,
    lookup: null,
  };
}

function catalogLookupResponse(
  kind: CatalogLookupKind,
  query: string,
  options: { label: string; value: string }[],
  error: string | null = null,
) {
  return {
    products: [],
    pageInfo: emptyPageInfo,
    collections: [],
    vendors: [],
    productTypes: [],
    tags: [],
    bulkLimited: false,
    counts: null,
    error,
    lookup: {
      kind,
      query,
      options,
    },
  };
}

function productSortKey({
  q,
  season,
  inventory,
  updated,
  vendors,
  types,
  tab,
}: {
  q: string;
  season: string;
  inventory: string;
  updated: string;
  vendors: string[];
  types: string[];
  tab: string;
}) {
  if (q || season) return "RELEVANCE";
  if (inventory || tab === "oos") return "INVENTORY_TOTAL";
  if (updated) return "UPDATED_AT";
  if (vendors.length === 1) return "VENDOR";
  if (types.length === 1) return "PRODUCT_TYPE";
  return "ID";
}

async function loadFilteredCollectionProducts({
  admin,
  collectionIds,
  filters,
  first,
  after,
  bulk,
  maxProducts,
}: {
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  collectionIds: string[];
  filters: ProductFilterContext;
  first: number;
  after: string | null;
  bulk: boolean;
  maxProducts: number;
}) {
  const skipMatches = bulk ? 0 : collectionCursorOffset(after);
  const requiredMatches = bulk ? maxProducts : skipMatches + first + 1;
  const matches: ProductData[] = [];
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await response.json()) as any;

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
      graphCursor = (rawPageInfo?.endCursor ?? null) as string | null;
      if (!rawPageInfo?.hasNextPage || !graphCursor) break;
    }

    if (matches.length >= requiredMatches) break;
  }

  const pageProducts = bulk
    ? matches.slice(0, maxProducts)
    : matches.slice(skipMatches, skipMatches + first);
  const hasNextPage = bulk ? false : matches.length > skipMatches + first;
  const bulkLimited =
    bulk && hasMoreCollectionProducts && matches.length >= maxProducts;

  return {
    products: pageProducts,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: skipMatches > 0,
      startCursor:
        skipMatches > 0
          ? collectionCursor(Math.max(0, skipMatches - first))
          : null,
      endCursor: hasNextPage ? collectionCursor(skipMatches + first) : null,
    },
    bulkLimited,
    scannedProducts,
  };
}

async function loadPostFilteredProducts({
  loadPage,
  filters,
  first,
  after,
  bulk,
  maxProducts,
}: {
  loadPage(cursor: string | null): Promise<Response>;
  filters: ProductFilterContext;
  first: number;
  after: string | null;
  bulk: boolean;
  maxProducts: number;
}) {
  const skipMatches = bulk ? 0 : collectionCursorOffset(after);
  const requiredMatches = bulk ? maxProducts : skipMatches + first + 1;
  const matches: ProductData[] = [];
  let graphCursor: string | null = null;
  let scannedProducts = 0;
  let hasMoreProducts = false;

  while (matches.length < requiredMatches) {
    const response = await loadPage(graphCursor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;

    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "Shopify returned an error.");
    }

    const productsConnection = json.data?.products;
    const edges = productsConnection?.edges ?? [];
    const rawPageInfo = productsConnection?.pageInfo;

    for (const edge of edges) {
      scannedProducts += 1;
      const product = productFromNode(edge.node);
      if (productMatchesFilters(product, filters)) matches.push(product);
      if (matches.length >= requiredMatches) break;
    }

    hasMoreProducts = Boolean(rawPageInfo?.hasNextPage);
    graphCursor = (rawPageInfo?.endCursor ?? null) as string | null;
    if (!rawPageInfo?.hasNextPage || !graphCursor) break;
  }

  const pageProducts = bulk
    ? matches.slice(0, maxProducts)
    : matches.slice(skipMatches, skipMatches + first);
  const hasNextPage = bulk ? false : matches.length > skipMatches + first;
  const bulkLimited = bulk && hasMoreProducts && matches.length >= maxProducts;

  return {
    products: pageProducts,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: skipMatches > 0,
      startCursor:
        skipMatches > 0
          ? collectionCursor(Math.max(0, skipMatches - first))
          : null,
      endCursor: hasNextPage ? collectionCursor(skipMatches + first) : null,
    },
    bulkLimited,
    scannedProducts,
  };
}

async function loadFilterOptions(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
) {
  const filtersRes = await admin.graphql(FILTERS_QUERY);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtersJson = (await filtersRes.json()) as any;
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
    collections: (filtersJson.data?.collections?.nodes ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => ({
        id: node.id as string,
        title: node.title as string,
      }),
    ),
    vendors: (filtersJson.data?.productVendors?.nodes ?? []).filter(Boolean),
    productTypes: (filtersJson.data?.productTypes?.nodes ?? []).filter(Boolean),
    tags: (filtersJson.data?.productTags?.nodes ?? []).filter(Boolean),
    errors: null,
  };
}

async function loadCatalogLookupOptions(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  kind: CatalogLookupKind,
  query: string,
) {
  if (query.length < 2) return [];

  if (kind === "collection") {
    const response = await admin.graphql(COLLECTION_LOOKUP_QUERY, {
      variables: {
        first: CATALOG_LOOKUP_LIMIT,
        query,
        sortKey: "RELEVANCE",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;
    if (json.errors?.length)
      throw new Error(json.errors[0]?.message ?? "Collection lookup failed.");

    return (
      (json.data?.collections?.nodes ?? []) as { id: string; title: string }[]
    )
      .filter((collection) => collection.id && collection.title)
      .map((collection) => ({
        label: collection.title,
        value: collection.id,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await response.json()) as any;
  if (json.errors?.length)
    throw new Error(json.errors[0]?.message ?? "Catalog lookup failed.");

  const productNodes = (json.data?.products?.nodes ?? []) as {
    vendor?: string;
    productType?: string;
    tags?: string[];
  }[];
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

// ─── Loader ───────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "app.products.loader", async () => {
    const { admin, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const url = new URL(request.url);

    let q = url.searchParams.get("q")?.trim() ?? "";
    const tab = url.searchParams.get("tab") ?? "all"; // all | active | archived | oos
    let vendors = searchParamValues(url.searchParams, "vendor");
    let types = searchParamValues(url.searchParams, "type");
    let collectionIds = searchParamValues(url.searchParams, "collection");
    let collectionTitles = searchParamValues(
      url.searchParams,
      "collectionTitle",
    );
    let tags = searchParamValues(url.searchParams, "tag");
    let taxonomyJoin = normalizeTaxonomyJoin(
      url.searchParams.get("taxonomyJoin"),
    );
    let vendorJoin = normalizeTaxonomyValueJoin(
      url.searchParams.get("vendorJoin"),
    );
    let typeJoin = normalizeTaxonomyValueJoin(
      url.searchParams.get("typeJoin"),
    );
    let tagJoin = normalizeTaxonomyValueJoin(url.searchParams.get("tagJoin"));
    let collectionJoin = normalizeTaxonomyValueJoin(
      url.searchParams.get("collectionJoin"),
    );
    const season = url.searchParams.get("season")?.trim() ?? "";
    const inventory = url.searchParams.get("inventory") ?? "";
    const inventoryValue = url.searchParams.get("inventoryValue") ?? "";
    const inventoryThreshold = inventoryThresholdValue(inventoryValue);
    const updated = url.searchParams.get("updated") ?? "";
    const after = url.searchParams.get("after") ?? null;
    const init = url.searchParams.get("init") === "1";
    const filtersOnly = url.searchParams.get("filtersOnly") === "1";
    const lookupKind = url.searchParams.get("lookup");
    const lookupQuery = lookupQueryValue(url.searchParams.get("q"));
    const bulk = url.searchParams.get("bulk") === "1";
    const pageSize = requestedPageSize(url.searchParams.get("first"));
    const first = bulk ? MAX_PRODUCT_PAGE_SIZE : pageSize;
    const maxBulkProducts = 1000;
    let productFilters: ProductFilterContext = {
      q,
      season,
      inventory,
      inventoryThreshold,
      updated,
      vendors,
      types,
      tags,
      collectionIds,
      collectionTitles,
      taxonomyJoin,
      vendorJoin,
      typeJoin,
      tagJoin,
      collectionJoin,
      tab,
    };
    const expandedProductFilters = await expandProductFilterValues(admin, {
      ...productFilters,
      after,
      first,
      bulk,
      maxProducts: maxBulkProducts,
    });
    q = expandedProductFilters.q;
    vendors = expandedProductFilters.vendors;
    types = expandedProductFilters.types;
    tags = expandedProductFilters.tags;
    collectionIds = expandedProductFilters.collectionIds;
    collectionTitles = expandedProductFilters.collectionTitles;
    taxonomyJoin = expandedProductFilters.taxonomyJoin;
    vendorJoin = expandedProductFilters.vendorJoin;
    typeJoin = expandedProductFilters.typeJoin;
    tagJoin = expandedProductFilters.tagJoin;
    collectionJoin = expandedProductFilters.collectionJoin;
    productFilters = {
      q,
      season,
      inventory,
      inventoryThreshold,
      updated,
      vendors,
      types,
      tags,
      collectionIds,
      collectionTitles,
      taxonomyJoin,
      vendorJoin,
      typeJoin,
      tagJoin,
      collectionJoin,
      tab,
    };

    const baseParts: string[] = [];
    if (q) baseParts.push(q);
    if (season) baseParts.push(season);
    baseParts.push(...taxonomyQueryParts(productFilters));
    if (inventory === "out") baseParts.push("inventory_total:0");
    if (inventory === "available") baseParts.push("inventory_total:>0");
    if (inventory === "low") {
      baseParts.push("inventory_total:>0");
      baseParts.push("inventory_total:<5");
    }
    if (inventory === "healthy") baseParts.push("inventory_total:>4");
    if (inventory === "overstock") baseParts.push("inventory_total:>99");
    if (inventory === "below" && inventoryThreshold !== null) {
      baseParts.push(`inventory_total:<${inventoryThreshold}`);
    }
    if (inventory === "above" && inventoryThreshold !== null) {
      baseParts.push(`inventory_total:>${inventoryThreshold}`);
    }
    const updatedPart = updatedQuery(updated);
    if (updatedPart) baseParts.push(updatedPart);

    const parts = [...baseParts];
    if (tab === "active") parts.push("status:active");
    else if (tab === "archived") parts.push("status:archived");
    else if (tab === "draft") parts.push("status:draft");
    else if (tab === "oos") parts.push("inventory_total:0");

    const shopifyQuery = joinQuery(parts);
    const sortKey = productSortKey({
      q,
      season,
      inventory,
      updated,
      vendors,
      types,
      tab,
    });

    const logFilters = {
      search: Boolean(q),
      tab,
      vendors: vendors.length,
      types: types.length,
      collections: collectionIds.length,
      tags: tags.length,
      taxonomyJoin,
      vendorJoin,
      typeJoin,
      tagJoin,
      collectionJoin,
      season: Boolean(season),
      inventory,
      inventoryValue: inventoryThreshold,
      updated,
      hasAfter: Boolean(after),
      init,
      filtersOnly,
      bulk,
      sortKey,
      lookup: lookupKind ?? "",
      lookupSearch: Boolean(lookupQuery),
      pageSize: first,
    };

    try {
      if (isCatalogLookupKind(lookupKind)) {
        const options = await loadCatalogLookupOptions(
          admin,
          lookupKind,
          lookupQuery,
        );

        logger.info("products.catalog_lookup.loaded", {
          filters: logFilters,
          kind: lookupKind,
          optionCount: options.length,
        });

        return catalogLookupResponse(lookupKind, lookupQuery, options);
      }

      if (filtersOnly) {
        const filterOptions = await loadFilterOptions(admin);
        if (filterOptions.errors?.length) {
          logger.warn("products.filters.graphql.error", {
            filters: logFilters,
            errors: filterOptions.errors,
          });
        }

        logger.info("products.filters.loaded", {
          collections: filterOptions.collections.length,
          vendors: filterOptions.vendors.length,
          productTypes: filterOptions.productTypes.length,
          tags: filterOptions.tags.length,
        });

        return {
          products: [],
          pageInfo: emptyPageInfo,
          collections: filterOptions.collections,
          vendors: filterOptions.vendors,
          productTypes: filterOptions.productTypes,
          tags: filterOptions.tags,
          bulkLimited: false,
          counts: null,
          error: null,
          lookup: null,
        };
      }

      if (collectionIds.length) {
        const hasNonCollectionTaxonomy = Boolean(
          vendors.length || types.length || tags.length,
        );
        const hasCollectionTitlePattern =
          collectionTitles.length > collectionIds.length;

        if (
          (taxonomyJoin === "or" && hasNonCollectionTaxonomy) ||
          (collectionJoin === "any" && hasCollectionTitlePattern)
        ) {
          const collectionResult = await loadFilteredCollectionProducts({
            admin,
            collectionIds,
            filters: productFilters,
            first,
            after: null,
            bulk: true,
            maxProducts: maxBulkProducts,
          });

          const searchEdges: Array<{ node: unknown }> = [];
          const loadSearchPage = (cursor: string | null) =>
            admin.graphql(PRODUCTS_QUERY, {
              variables: {
                first: MAX_PRODUCT_PAGE_SIZE,
                after: cursor,
                query: shopifyQuery || null,
                sortKey,
              },
            });

          let searchRes = await loadSearchPage(null);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let searchJson = (await searchRes.json()) as any;
          if (searchJson.errors?.length) {
            logger.warn("products.collection_union.graphql.error", {
              filters: logFilters,
              errors: searchJson.errors,
            });
            return productsErrorResponse(
              searchJson.errors[0]?.message ?? "Shopify returned an error.",
            );
          }

          searchEdges.push(...(searchJson.data?.products?.edges ?? []));
          let searchPageInfo = searchJson.data?.products?.pageInfo;

          while (
            searchPageInfo?.hasNextPage &&
            searchPageInfo.endCursor &&
            searchEdges.length < maxBulkProducts
          ) {
            searchRes = await loadSearchPage(searchPageInfo.endCursor);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            searchJson = (await searchRes.json()) as any;
            if (searchJson.errors?.length) {
              logger.warn("products.collection_union.bulk_page.graphql.error", {
                filters: logFilters,
                errors: searchJson.errors,
                loadedProducts: searchEdges.length,
              });
              break;
            }
            searchEdges.push(...(searchJson.data?.products?.edges ?? []));
            searchPageInfo = searchJson.data?.products?.pageInfo;
          }

          const mergedProducts = new Map<string, ProductData>();
          collectionResult.products.forEach((product) => {
            mergedProducts.set(product.id, product);
          });
          searchEdges
            .map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ({ node }: any) => productFromNode(node),
            )
            .filter((product) => productMatchesFilters(product, productFilters))
            .forEach((product) => {
              if (!mergedProducts.has(product.id))
                mergedProducts.set(product.id, product);
            });

          const merged = [...mergedProducts.values()].slice(0, maxBulkProducts);
          const skipMatches = bulk ? 0 : collectionCursorOffset(after);
          const pageProducts = bulk
            ? merged
            : merged.slice(skipMatches, skipMatches + first);
          const hasNextPage = !bulk && merged.length > skipMatches + first;
          const bulkLimited =
            collectionResult.bulkLimited ||
            Boolean(
              searchPageInfo?.hasNextPage &&
              searchEdges.length >= maxBulkProducts,
            );

          logger.info("products.collection_union.loaded", {
            filters: logFilters,
            productCount: pageProducts.length,
            totalMatched: merged.length,
            hasNextPage,
            bulkLimited,
            scannedProducts:
              collectionResult.scannedProducts + searchEdges.length,
          });

          return {
            products: pageProducts,
            pageInfo: {
              hasNextPage,
              hasPreviousPage: skipMatches > 0,
              startCursor:
                skipMatches > 0
                  ? collectionCursor(Math.max(0, skipMatches - first))
                  : null,
              endCursor: hasNextPage
                ? collectionCursor(skipMatches + first)
                : null,
            },
            collections: [],
            vendors: [],
            productTypes: [],
            tags: [],
            bulkLimited,
            counts: null,
            error: null,
            lookup: null,
          };
        }

        const collectionResult = await loadFilteredCollectionProducts({
          admin,
          collectionIds,
          filters: productFilters,
          first,
          after,
          bulk,
          maxProducts: maxBulkProducts,
        });

        logger.info("products.collection.loaded", {
          filters: logFilters,
          productCount: collectionResult.products.length,
          hasNextPage: collectionResult.pageInfo.hasNextPage,
          bulkLimited: collectionResult.bulkLimited,
          scannedProducts: collectionResult.scannedProducts,
        });

        return {
          products: collectionResult.products,
          pageInfo: collectionResult.pageInfo,
          collections: [],
          vendors: [],
          productTypes: [],
          tags: [],
          bulkLimited: collectionResult.bulkLimited,
          counts: null,
          error: null,
          lookup: null,
        };
      }

      const loadPage = (cursor: string | null) =>
        admin.graphql(PRODUCTS_QUERY, {
          variables: {
            first,
            after: cursor,
            query: shopifyQuery || null,
            sortKey,
          },
        });

      if (productFiltersNeedPostFilter(productFilters)) {
        const postFilterResult = await loadPostFilteredProducts({
          loadPage: (cursor) =>
            admin.graphql(PRODUCTS_QUERY, {
              variables: {
                first: MAX_PRODUCT_PAGE_SIZE,
                after: cursor,
                query: shopifyQuery || null,
                sortKey,
              },
            }),
          filters: productFilters,
          first,
          after,
          bulk,
          maxProducts: maxBulkProducts,
        });

        logger.info("products.post_filter.loaded", {
          filters: logFilters,
          productCount: postFilterResult.products.length,
          hasNextPage: postFilterResult.pageInfo.hasNextPage,
          bulkLimited: postFilterResult.bulkLimited,
          scannedProducts: postFilterResult.scannedProducts,
        });

        return {
          products: postFilterResult.products,
          pageInfo: postFilterResult.pageInfo,
          collections: [],
          vendors: [],
          productTypes: [],
          tags: [],
          bulkLimited: postFilterResult.bulkLimited,
          counts: null,
          error: null,
          lookup: null,
        };
      }

      const productsRes = await loadPage(bulk ? null : after);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const productsJson = (await productsRes.json()) as any;

      if (productsJson.errors?.length) {
        logger.warn("products.graphql.error", {
          filters: logFilters,
          errors: productsJson.errors,
        });
        return productsErrorResponse(
          productsJson.errors[0]?.message ?? "Shopify returned an error.",
        );
      }

      const edges = [...(productsJson.data?.products?.edges ?? [])];
      let raw = productsJson.data?.products?.pageInfo;
      let bulkLimited = false;

      while (
        bulk &&
        raw?.hasNextPage &&
        raw.endCursor &&
        edges.length < maxBulkProducts
      ) {
        const nextRes = await loadPage(raw.endCursor);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nextJson = (await nextRes.json()) as any;
        if (nextJson.errors?.length) {
          logger.warn("products.bulk_page.graphql.error", {
            filters: logFilters,
            errors: nextJson.errors,
            loadedProducts: edges.length,
          });
          break;
        }
        edges.push(...(nextJson.data?.products?.edges ?? []));
        raw = nextJson.data?.products?.pageInfo;
      }
      if (bulk && raw?.hasNextPage && edges.length >= maxBulkProducts) {
        bulkLimited = true;
      }

      const products = edges.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ node }: any) => productFromNode(node),
      );

      const pageInfo = {
        hasNextPage: (raw?.hasNextPage ?? false) as boolean,
        hasPreviousPage: (raw?.hasPreviousPage ?? false) as boolean,
        startCursor: (raw?.startCursor ?? null) as string | null,
        endCursor: (raw?.endCursor ?? null) as string | null,
      };

      const collections: { id: string; title: string }[] = [];
      const vendorOptions: string[] = [];
      const productTypes: string[] = [];
      const tagOptions: string[] = [];

      logger.info("products.loaded", {
        filters: logFilters,
        productCount: products.length,
        hasNextPage: pageInfo.hasNextPage,
        bulkLimited,
      });

      return {
        products,
        pageInfo,
        collections,
        vendors: vendorOptions,
        productTypes,
        tags: tagOptions,
        bulkLimited,
        counts: null,
        error: null,
        lookup: null,
      };
    } catch (error) {
      logger.error("products.load.failed", {
        filters: logFilters,
        error: logger.serializeError(error),
      });
      return productsErrorResponse(
        "Products could not load from Shopify. Retry the sync or clear filters to load all products.",
      );
    }
  });
};

// No default export -> resource route (never rendered as a page)
