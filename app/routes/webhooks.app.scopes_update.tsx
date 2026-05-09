import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticateWebhook } from "../webhooks.server";
import { logger } from "../logger.server";
import { withRequestLogging } from "../request-logging.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "webhooks.app.scopes_update.action", async () => {
    const { payload, session, topic, shop } = await authenticateWebhook(request);
    logger.info("webhook.received", { topic, shop });

    const current = payload.current as string[];
    if (session) {
        await db.session.update({   
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
  });
};
