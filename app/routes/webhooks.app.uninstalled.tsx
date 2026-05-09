import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticateWebhook } from "../webhooks.server";
import { logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "webhooks.app.uninstalled.action", async () => {
    const { shop, session, topic } = await authenticateWebhook(request);

    logger.info("webhook.received", { topic, shop });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

    return new Response();
  });
};
