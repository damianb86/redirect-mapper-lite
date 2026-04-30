import type { ActionFunctionArgs } from "react-router";
import { authenticateWebhook } from "../webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticateWebhook(request);

  console.log(`[webhook] ${topic} for ${shop}`, JSON.stringify(payload, null, 2));

  // No persistent plan storage needed — plan is resolved live from Shopify billing.check().
  // This webhook serves as an audit log and future hook point.
  return new Response("OK", { status: 200 });
};
