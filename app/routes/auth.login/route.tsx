import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";
import { withRequestLogging } from "../../request-logging.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "auth.login.loader", async () => {
    const url = new URL(request.url);
    if (!url.searchParams.get("shop")) return null;

    await login(request);
    throw redirect("/");
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return withRequestLogging(request, "auth.login.action", async () => {
    await login(request);

    throw redirect("/");
  });
};

export default function Auth() {
  return null;
}
