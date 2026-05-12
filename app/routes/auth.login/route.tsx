import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";
import { withRequestLogging } from "../../request-logging.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return withRequestLogging(request, "auth.login.loader", async () => {
    const url = new URL(request.url);
    if (!url.searchParams.get("shop")) {
      const referer = request.headers.get("referer");
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          const refererShop = refererUrl.searchParams.get("shop");
          if (refererShop) {
            throw redirect(`/auth/login?shop=${encodeURIComponent(refererShop)}`);
          }
        } catch (error) {
          if (error instanceof Response) throw error;
        }
      }

      throw redirect("/");
    }

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
