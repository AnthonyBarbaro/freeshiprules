import type { LoaderFunctionArgs } from "react-router";
import { authenticate, normalizeShop } from "../shopify.server";
import { storefrontProgressConfigFromRule } from "../services/progress-config.server";
import {
  functionConfigFromRuleSet,
  getRuleSetForShopDomain,
} from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";
import {
  getShippingProtectionForShopDomain,
  shippingProtectionVariantMapFromRecord,
} from "../services/shipping-protection.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxyShop = await authenticatedProxyShop(request);
  if (proxyShop === null) {
    return progressResponse({ enabled: false });
  }

  const url = new URL(request.url);
  const shop = normalizeShop(proxyShop ?? url.searchParams.get("shop"));

  if (!shop) {
    return progressResponse({ enabled: false });
  }

  const record = await getRuleSetForShopDomain(shop);
  if (!record) {
    return progressResponse({ enabled: false });
  }
  if (!billingIsActive(record.shop.billingStatus)) {
    return progressResponse({ enabled: false });
  }

  const progressConfig = storefrontProgressConfigFromRule(
    functionConfigFromRuleSet(record.ruleSet),
  );
  const protection = await getShippingProtectionForShopDomain(shop);
  const protectionVariantIds = protection
    ? Object.values(
        shippingProtectionVariantMapFromRecord(protection.shippingProtection),
      ).map((variant) => variant.legacyVariantId)
    : [];

  return progressResponse({
    ...progressConfig,
    protectionVariantIds,
  });
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

function progressResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
