import { AppProvider, redirect } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = inferShopDomain(request);

  if (shop && url.searchParams.get("top_level") !== "1") {
    return {
      errors: { shop: undefined },
      shop,
      redirectUrl: topLevelLoginUrl(request, shop),
    };
  }

  const errors = loginErrorMessage(await login(request));

  return { errors, shop, redirectUrl: null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState(loaderData.shop);
  const { errors } = actionData || loaderData;

  if (loaderData.redirectUrl) {
    return <TopLevelRedirect url={loaderData.redirectUrl} />;
  }

  return (
    <AppProvider embedded={false}>
      <s-page>
        <form
          method="get"
          target="_top"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const selectedShop = normalizeShop(String(formData.get("shop")));
            if (!selectedShop) return;

            redirect(topLevelLoginUrl(window.location.href, selectedShop));
          }}
        >
          <s-section heading="Log in">
            <input type="hidden" name="top_level" value="1" />
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

function TopLevelRedirect({ url }: { url: string }) {
  redirect(url);

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Connecting to Shopify">
          <s-paragraph>Opening Shopify authorization.</s-paragraph>
          <s-link href={url} target="_top">
            Continue
          </s-link>
        </s-section>
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

function topLevelLoginUrl(requestUrl: Request | string, shop: string) {
  const url =
    typeof requestUrl === "string" ? new URL(requestUrl) : new URL(requestUrl.url);
  url.searchParams.set("shop", shop);
  url.searchParams.set("top_level", "1");
  return url.toString();
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
