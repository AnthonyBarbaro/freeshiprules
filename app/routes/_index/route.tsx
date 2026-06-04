import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login, normalizeShop } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const shop = normalizeShop(url.searchParams.get("shop"));
  if (shop) {
    if (hasEmbeddedContext(url)) {
      throw redirect(`/app${url.search}`);
    }

    throw redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
  }

  return { showForm: Boolean(login) };
};

function hasEmbeddedContext(url: URL) {
  return (
    url.searchParams.has("host") ||
    url.searchParams.has("id_token") ||
    url.searchParams.get("embedded") === "1"
  );
}

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>FreeShip Rules</h1>
        <p className={styles.text}>
          Rule-based free shipping for Shopify merchants.
        </p>
        {showForm && (
          <Form
            className={styles.form}
            method="post"
            action="/auth/login"
            target="_top"
          >
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Checkout-native</strong>. Shipping discounts run in a
            Shopify Function.
          </li>
          <li>
            <strong>No stacking</strong>. No-stacking is enforced through
            Shopify discount combination rules for supported discount classes,
            plus Function-level blocking when Shopify exposes
            triggeringDiscountCode.
          </li>
          <li>
            <strong>Merchant controlled</strong>. Settings are stored in Shopify
            discount metafields.
          </li>
        </ul>
      </div>
    </div>
  );
}
