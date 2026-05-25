import type { LoaderFunctionArgs } from "react-router";
import { authenticate, normalizeShop } from "../shopify.server";
import { storefrontProgressConfigFromRule } from "../services/progress-config.server";
import {
  functionConfigFromRuleSet,
  getRuleSetForShopDomain,
} from "../services/rules.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = normalizeShop(session?.shop ?? url.searchParams.get("shop"));

  if (!shop) {
    return progressResponse({ enabled: false }, 400);
  }

  const record = await getRuleSetForShopDomain(shop);
  if (!record) {
    return progressResponse({ enabled: false }, 404);
  }

  return progressResponse(
    storefrontProgressConfigFromRule(functionConfigFromRuleSet(record.ruleSet)),
  );
};

function progressResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
