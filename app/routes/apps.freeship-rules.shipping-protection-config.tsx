import type { LoaderFunctionArgs } from "react-router";
import { authenticate, normalizeShop } from "../shopify.server";
import {
  getShippingProtectionForShopDomain,
  storefrontShippingProtectionConfigFromRecord,
} from "../services/shipping-protection.server";
import { billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = normalizeShop(session?.shop ?? url.searchParams.get("shop"));

  if (!shop) {
    return protectionResponse({ enabled: false, setupRequired: true }, 400);
  }

  const record = await getShippingProtectionForShopDomain(shop);
  if (!record) {
    return protectionResponse({ enabled: false, setupRequired: true }, 404);
  }
  if (!billingIsActive(record.shop.billingStatus)) {
    return protectionResponse({ enabled: false, setupRequired: true });
  }

  return protectionResponse(
    storefrontShippingProtectionConfigFromRecord(record.shippingProtection),
  );
};

function protectionResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
