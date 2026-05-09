import { authenticate } from "./shopify.server";
import { addLogContext, logger } from "./logger.server";

type ShopifyWebhookContext = Awaited<ReturnType<typeof authenticate.webhook>>;

function isResponse(error: unknown): error is Response {
  return error instanceof Response;
}

export async function authenticateWebhook(
  request: Request,
): Promise<ShopifyWebhookContext> {
  try {
    const context = await authenticate.webhook(request);
    addLogContext({ shop: context.shop });
    return context;
  } catch (error) {
    if (isResponse(error) && (error.status === 400 || error.status === 401)) {
      logger.warn("webhook.authentication.failed", {
        status: error.status,
        statusText: error.statusText,
      });
      throw new Response(null, {
        status: 400,
        statusText: "Bad Request",
      });
    }

    throw error;
  }
}
