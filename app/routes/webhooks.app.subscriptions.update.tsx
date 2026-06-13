import type { ActionFunctionArgs } from "react-router";
import { authenticateWebhook } from "../webhooks.server";
import { logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";
import { syncBillingEntitlementFromWebhook } from "../plan.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "webhooks.app.subscriptions.update.action", async () => {
    const { topic, shop, payload, admin } = await authenticateWebhook(request);

    logger.info("webhook.received", { topic, shop, payload });

    await syncBillingEntitlementFromWebhook({
      shop,
      payload,
      admin,
    });

    return new Response("OK", { status: 200 });
  });
};
