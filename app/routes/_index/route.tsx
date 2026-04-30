import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.content}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.badge}>Shopify redirect cleanup</div>
            <h1 className={styles.heading}>Redirect Mapper Lite</h1>
            <p className={styles.text}>
              Retire products without leaving customers on dead product pages.
              Select products, generate redirects, review the mapping, and apply
              everything directly in Shopify.
            </p>
            <div className={styles.metrics}>
              <span>Product retirements</span>
              <span>Smart redirect rules</span>
              <span>Rollback history</span>
            </div>
          </div>

          <div className={styles.loginPanel}>
            <div>
              <h2>Open your Shopify app</h2>
              <p>Enter your store domain to continue to the embedded admin app.</p>
            </div>
            {showForm && (
              <Form className={styles.form} method="post" action="/auth/login">
                <label className={styles.label}>
                  <span>Shop domain</span>
                  <input
                    className={styles.input}
                    type="text"
                    name="shop"
                    placeholder="my-store.myshopify.com"
                    autoComplete="organization"
                  />
                  <small>Use your full myshopify.com domain.</small>
                </label>
                <button className={styles.button} type="submit">
                  Log in
                </button>
              </Form>
            )}
          </div>
        </section>

        {showForm && (
          <p className={styles.note}>
            This page is only the public entry point. The full experience runs inside Shopify Admin after login.
          </p>
        )}

        <ul className={styles.list}>
          <li>
            <strong>Pick products faster</strong>
            <span>Filter by vendor, collection, tag, season, inventory, and product status.</span>
          </li>
          <li>
            <strong>Map redirects with rules</strong>
            <span>Create destinations by collection, vendor, product type, search results, or custom paths.</span>
          </li>
          <li>
            <strong>Apply and roll back safely</strong>
            <span>Push redirects to Shopify, archive products, and keep cleanup history for rollback.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
