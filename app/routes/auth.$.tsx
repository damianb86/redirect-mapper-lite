
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { addLogContext } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "auth.callback.loader", async () => {
    const { session } = await authenticate.admin(request);
    addLogContext({ shop: session.shop });

    return null;
  });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
