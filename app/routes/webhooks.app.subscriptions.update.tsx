import type { ActionFunctionArgs } from "react-router";
import { authenticateWebhook } from "../webhooks.server";
import { logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "webhooks.app.subscriptions.update.action", async () => {
    const { topic, shop, payload } = await authenticateWebhook(request);

    logger.info("webhook.received", { topic, shop, payload });

    // No persistent plan storage needed — plan is resolved live from Shopify billing.check().
    // This webhook serves as an audit log and future hook point.
    return new Response("OK", { status: 200 });
  });
};
