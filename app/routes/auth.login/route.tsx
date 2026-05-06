import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await login(request);

  throw redirect("/");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await login(request);

  throw redirect("/");
};

export default function Auth() {
  return null;
}
