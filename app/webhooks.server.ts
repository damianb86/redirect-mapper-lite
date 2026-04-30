import { authenticate } from "./shopify.server";

type ShopifyWebhookContext = Awaited<ReturnType<typeof authenticate.webhook>>;

function isResponse(error: unknown): error is Response {
  return error instanceof Response;
}

export async function authenticateWebhook(
  request: Request,
): Promise<ShopifyWebhookContext> {
  try {
    return await authenticate.webhook(request);
  } catch (error) {
    if (isResponse(error) && (error.status === 400 || error.status === 401)) {
      throw new Response(null, {
        status: 400,
        statusText: "Bad Request",
      });
    }

    throw error;
  }
}
