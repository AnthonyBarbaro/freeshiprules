import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import {
  beginOAuth,
  inferShopFromRequest,
  normalizeShop,
} from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = inferShopFromRequest(request);

  if (shop && new URL(request.url).searchParams.get("top_level") === "1") {
    return beginOAuth(request, shop);
  }

  return {
    errors: { shop: undefined },
    redirectUrl: shop ? topLevelLoginUrl(request, shop) : null,
    shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = normalizeShop(formData.get("shop")?.toString());

  if (shop) {
    return beginOAuth(request, shop);
  }

  return {
    errors: { shop: "Enter a valid myshopify.com store domain." },
    redirectUrl: null,
    shop: "",
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
        <form method="post" target="_top">
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

function TopLevelRedirect({ url }: { url: string }) {
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Connecting to Shopify">
          <s-paragraph>Opening Shopify authorization.</s-paragraph>
          <script
            dangerouslySetInnerHTML={{
              __html: `window.open(${JSON.stringify(url)}, "_top");`,
            }}
          />
          <a href={url} target="_top" rel="noreferrer">
            Continue
          </a>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

function topLevelLoginUrl(request: Request, shop: string) {
  const url = new URL(request.url);
  url.searchParams.set("shop", shop);
  url.searchParams.set("top_level", "1");
  return url.toString();
}
