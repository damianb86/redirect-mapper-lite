import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

const SHOPIFY_APP_STORE_URL = "https://apps.shopify.com/redirect-mapper-lite";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
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
              <h2>Open from Shopify</h2>
              <p>
                Install or launch Redirect Mapper Lite from a Shopify-owned
                surface. Shopify passes the store context automatically.
              </p>
            </div>
            <a className={styles.button} href={SHOPIFY_APP_STORE_URL}>
              Open Shopify App Store
            </a>
          </div>
        </section>

        <p className={styles.note}>
          The full experience runs inside Shopify Admin after OAuth authentication.
        </p>

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
