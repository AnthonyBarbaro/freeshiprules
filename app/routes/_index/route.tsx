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
      <div className={styles.content}>
        <h1 className={styles.heading}>FreeShip Rules</h1>
        <p className={styles.text}>
          Rule-based free shipping for Shopify merchants who need no-stacking
          delivery offers.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
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
            <strong>No stacking</strong>. Shopify discount combining is disabled
            by default.
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
