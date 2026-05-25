import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { beginOAuth } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = inferShopDomain(request);

  if (shop) {
    return beginOAuth(request, shop);
  }

  return { errors: { shop: undefined }, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = normalizeShop(formData.get("shop")?.toString());

  if (shop) {
    return beginOAuth(request, shop);
  }

  return {
    errors: { shop: "Enter a valid myshopify.com store domain." },
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState(loaderData.shop);
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <form method="post">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </form>
      </s-page>
    </AppProvider>
  );
}

function inferShopDomain(request: Request) {
  const url = new URL(request.url);
  const candidates = [
    url.searchParams.get("shop"),
    url.searchParams.get("shopDomain"),
    url.searchParams.get("store"),
    shopFromEncodedHost(url.searchParams.get("host")),
    shopFromAdminUrl(request.headers.get("referer")),
    process.env.DEFAULT_SHOP_DOMAIN,
    process.env.SHOPIFY_DEV_STORE_DOMAIN,
  ];

  for (const candidate of candidates) {
    const shop = normalizeShop(candidate);
    if (shop) return shop;
  }

  return "";
}

function shopFromEncodedHost(host: string | null) {
  if (!host) return null;

  try {
    const normalized = host.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return shopFromAdminUrl(`https://${decoded}`);
  } catch {
    return null;
  }
}

function shopFromAdminUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    const storeHandle = url.pathname.match(/\/store\/([^/?#]+)/)?.[1];
    return storeHandle ? `${storeHandle}.myshopify.com` : null;
  } catch {
    return null;
  }
}

function normalizeShop(value: string | null | undefined) {
  if (!value) return null;

  const cleaned = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (!cleaned) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned)) return cleaned;
  if (/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) return `${cleaned}.myshopify.com`;

  return null;
}
