import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { addLogContext, logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

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
          collections(first: 5) {
            edges {
              node {
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

function numericIdFromGid(gid: string) {
  return gid.split("/").pop();
}

function joinQuery(parts: string[]) {
  return parts.filter(Boolean).join(" AND ");
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

function isCatalogLookupKind(value: string | null): value is CatalogLookupKind {
  return value === "collection" ||
    value === "vendor" ||
    value === "productType" ||
    value === "tag";
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
    collections: (node.collections?.edges ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ node: c }: any) => c.title as string,
    ),
    tags: ((node.tags as string[] | null) ?? []).filter(Boolean),
    createdAt: (node.createdAt as string | null) ?? null,
    updatedAt: (node.updatedAt as string | null) ?? null,
  };
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
  vendor,
  type,
  tab,
}: {
  q: string;
  season: string;
  inventory: string;
  updated: string;
  vendor: string;
  type: string;
  tab: string;
}) {
  if (q || season) return "RELEVANCE";
  if (inventory || tab === "oos") return "INVENTORY_TOTAL";
  if (updated) return "UPDATED_AT";
  if (vendor) return "VENDOR";
  if (type) return "PRODUCT_TYPE";
  return "ID";
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
    if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "Collection lookup failed.");

    return ((json.data?.collections?.nodes ?? []) as { id: string; title: string }[])
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
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "Catalog lookup failed.");

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
      ? json.data?.productVendors?.nodes ?? []
      : kind === "productType"
        ? json.data?.productTypes?.nodes ?? []
        : json.data?.productTags?.nodes ?? [];

  return stringLookupOptions([...valuesFromProducts, ...valuesFromConnection], query);
}

// ─── Loader ───────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "app.products.loader", async () => {
    const { admin, session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });
    const url = new URL(request.url);

  const q = url.searchParams.get("q")?.trim() ?? "";
  const tab = url.searchParams.get("tab") ?? "all"; // all | active | archived | oos
    const vendor = url.searchParams.get("vendor") ?? "";
    const type = url.searchParams.get("type") ?? "";
    const collectionId = url.searchParams.get("collection") ?? "";
    const tag = url.searchParams.get("tag") ?? "";
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
    const first = bulk ? 250 : 20;
    const maxBulkProducts = 1000;
  
    const baseParts: string[] = [];
    if (q) baseParts.push(q);
    if (season) baseParts.push(season);
    if (vendor) baseParts.push(`vendor:${quoteSearchValue(vendor)}`);
    if (type) baseParts.push(`product_type:${quoteSearchValue(type)}`);
    if (collectionId) {
      const numId = numericIdFromGid(collectionId);
      if (numId) baseParts.push(`collection_id:${numId}`);
    }
    if (tag) baseParts.push(`tag:${quoteSearchValue(tag)}`);
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
  const sortKey = productSortKey({ q, season, inventory, updated, vendor, type, tab });
  
    const logFilters = {
      search: Boolean(q),
      tab,
      vendor: Boolean(vendor),
      type: Boolean(type),
      collection: Boolean(collectionId),
      tag: Boolean(tag),
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
    };

    try {
      if (isCatalogLookupKind(lookupKind)) {
        const options = await loadCatalogLookupOptions(admin, lookupKind, lookupQuery);

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

      const loadPage = (cursor: string | null) =>
        admin.graphql(PRODUCTS_QUERY, {
          variables: {
            first,
            after: cursor,
            query: shopifyQuery || null,
            sortKey,
          },
        });
  
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
      const vendors: string[] = [];
      const productTypes: string[] = [];
      const tags: string[] = [];

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
        vendors,
        productTypes,
        tags,
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
