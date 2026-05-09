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
    $allQuery: String
      $activeQuery: String
      $archivedQuery: String
      $draftQuery: String
      $outOfStockQuery: String
    ) {
    products(first: $first, after: $after, query: $query) {
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
    allCount: productsCount(query: $allQuery) {
      count
    }
    activeCount: productsCount(query: $activeQuery) {
      count
    }
      archivedCount: productsCount(query: $archivedQuery) {
        count
      }
      draftCount: productsCount(query: $draftQuery) {
        count
      }
      outOfStockCount: productsCount(query: $outOfStockQuery) {
      count
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

const emptyCounts = { all: 0, active: 0, archived: 0, draft: 0, oos: 0 };

function productsErrorResponse(message: string) {
  return {
    products: [],
    pageInfo: emptyPageInfo,
    collections: [],
    vendors: [],
    productTypes: [],
    tags: [],
    bulkLimited: false,
    counts: emptyCounts,
    error: message,
  };
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
    const updated = url.searchParams.get("updated") ?? "";
    const after = url.searchParams.get("after") ?? null;
    const init = url.searchParams.get("init") === "1";
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
    const updatedPart = updatedQuery(updated);
    if (updatedPart) baseParts.push(updatedPart);
  
    const parts = [...baseParts];
    if (tab === "active") parts.push("status:active");
    else if (tab === "archived") parts.push("status:archived");
    else if (tab === "draft") parts.push("status:draft");
    else if (tab === "oos") parts.push("inventory_total:0");

  const shopifyQuery = joinQuery(parts);
  const allQuery = joinQuery(baseParts);
    const activeQuery = joinQuery([...baseParts, "status:active"]);
    const archivedQuery = joinQuery([...baseParts, "status:archived"]);
    const draftQuery = joinQuery([...baseParts, "status:draft"]);
    const outOfStockQuery = joinQuery([...baseParts, "inventory_total:0"]);
  
    const logFilters = {
      search: Boolean(q),
      tab,
      vendor: Boolean(vendor),
      type: Boolean(type),
      collection: Boolean(collectionId),
      tag: Boolean(tag),
      season: Boolean(season),
      inventory,
      updated,
      hasAfter: Boolean(after),
      init,
      bulk,
    };

    try {
      const loadPage = (cursor: string | null) =>
        admin.graphql(PRODUCTS_QUERY, {
          variables: {
            first,
            after: cursor,
            query: shopifyQuery || null,
            allQuery: allQuery || null,
            activeQuery: activeQuery || null,
            archivedQuery: archivedQuery || null,
            draftQuery: draftQuery || null,
            outOfStockQuery: outOfStockQuery || null,
          },
        });
  
      const requests: Promise<Response>[] = [loadPage(bulk ? null : after)];
      if (init) {
        requests.push(admin.graphql(FILTERS_QUERY));
      }

      const [productsRes, filtersRes] = await Promise.all(requests);

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

      let collections: { id: string; title: string }[] = [];
      let vendors: string[] = [];
      let productTypes: string[] = [];
      let tags: string[] = [];
      if (init && filtersRes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filtersJson = (await filtersRes.json()) as any;
        if (filtersJson.errors?.length) {
          logger.warn("products.filters.graphql.error", {
            filters: logFilters,
            errors: filtersJson.errors,
          });
        }
        collections = (filtersJson.data?.collections?.nodes ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (node: any) => ({
            id: node.id as string,
            title: node.title as string,
          }),
        );
        vendors = (filtersJson.data?.productVendors?.nodes ?? []).filter(Boolean);
        productTypes = (filtersJson.data?.productTypes?.nodes ?? []).filter(Boolean);
        tags = (filtersJson.data?.productTags?.nodes ?? []).filter(Boolean);
      }

      const counts = {
        all: productsJson.data?.allCount?.count ?? 0,
        active: productsJson.data?.activeCount?.count ?? 0,
        archived: productsJson.data?.archivedCount?.count ?? 0,
        draft: productsJson.data?.draftCount?.count ?? 0,
        oos: productsJson.data?.outOfStockCount?.count ?? 0,
      };

      logger.info("products.loaded", {
        filters: logFilters,
        productCount: products.length,
        counts,
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
        counts,
        error: null,
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
