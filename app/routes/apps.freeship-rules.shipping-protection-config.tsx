import type { LoaderFunctionArgs } from "react-router";
import { authenticate, normalizeShop } from "../shopify.server";
import {
  getShippingProtectionForShopDomain,
  storefrontShippingProtectionConfigFromRecord,
} from "../services/shipping-protection.server";
import { billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxyShop = await authenticatedProxyShop(request);
  if (proxyShop === null) {
    return protectionResponse({ enabled: false, setupRequired: true });
  }

  const url = new URL(request.url);
  const shop = normalizeShop(proxyShop ?? url.searchParams.get("shop"));

  if (!shop) {
    return protectionResponse({ enabled: false, setupRequired: true });
  }

  const record = await getShippingProtectionForShopDomain(shop);
  if (!record) {
    return protectionResponse({ enabled: false, setupRequired: true });
  }
  if (!billingIsActive(record.shop.billingStatus)) {
    return protectionResponse({ enabled: false, setupRequired: true });
  }

  return protectionResponse(
    storefrontShippingProtectionConfigFromRecord(record.shippingProtection),
  );
};

async function authenticatedProxyShop(request: Request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    return session?.shop;
  } catch (error) {
    if (
      error instanceof Response &&
      error.status >= 400 &&
      error.status < 500
    ) {
      return null;
    }

    throw error;
  }
}

function protectionResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
