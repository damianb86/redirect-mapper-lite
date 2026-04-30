import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`[webhook] ${topic} compliance request for ${shop}`);
    return new Response("OK", { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("[webhook] Compliance webhook verification failed", error);
    return new Response("Unauthorized", { status: 401 });
  }
};
