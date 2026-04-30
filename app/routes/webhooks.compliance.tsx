import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendContactEmail } from "../email.server";

type CustomerPayload = {
  customer?: { id?: number; email?: string };
  orders_requested?: number[];
  data_request?: { id?: number };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      const p = payload as CustomerPayload;
      await sendContactEmail({
        type: "GDPR: Customer data request",
        subject: "GDPR — Customer data request received",
        shop,
        message: [
          `Shop: ${shop}`,
          `Customer ID: ${p?.customer?.id ?? "unknown"}`,
          `Customer email: ${p?.customer?.email ?? "unknown"}`,
          `Data request ID: ${p?.data_request?.id ?? "unknown"}`,
          "",
          "This app stores no personal customer data.",
          "Only merchant-level redirect records are stored (product URLs, cleanup history).",
          "No customer-specific action is required.",
        ].join("\n"),
      });
      break;
    }

    case "CUSTOMERS_REDACT": {
      const p = payload as CustomerPayload;
      await sendContactEmail({
        type: "GDPR: Customer redact request",
        subject: "GDPR — Customer redact request received",
        shop,
        message: [
          `Shop: ${shop}`,
          `Customer ID: ${p?.customer?.id ?? "unknown"}`,
          `Customer email: ${p?.customer?.email ?? "unknown"}`,
          "",
          "This app stores no personal customer data.",
          "Only merchant-level redirect records are stored (product URLs, cleanup history).",
          "No customer-specific deletion is required.",
        ].join("\n"),
      });
      break;
    }

    case "SHOP_REDACT": {
      // Delete all data for this shop — triggered 48 h after uninstall.
      // CleanupRedirect records are removed via CASCADE from CleanupRun.
      await Promise.all([
        prisma.cleanupRun.deleteMany({ where: { shop } }),
        prisma.contactRequest.deleteMany({ where: { shop } }),
        prisma.session.deleteMany({ where: { shop } }),
      ]);

      await sendContactEmail({
        type: "GDPR: Shop redact",
        subject: "GDPR — Shop data deleted",
        shop,
        message: [
          `Shop: ${shop}`,
          "",
          "All app data for this shop has been permanently deleted:",
          "- Cleanup runs and redirect history (CleanupRun + CleanupRedirect)",
          "- Contact requests",
          "- Sessions (if any remained after uninstall)",
        ].join("\n"),
      });
      break;
    }

    default:
      console.warn(`[webhook:compliance] Unhandled topic: ${topic} for ${shop}`);
  }

  return new Response();
};
