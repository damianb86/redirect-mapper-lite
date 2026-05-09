import type { LoaderFunctionArgs } from "react-router";
import { withRequestLogging } from "../request-logging.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "healthz.loader", () =>
    Response.json({
      ok: true,
      service: "redirect-mapper-lite",
      ts: new Date().toISOString(),
    }),
  );
};
