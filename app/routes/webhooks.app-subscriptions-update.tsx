import type { ActionFunctionArgs } from "react-router";
import { adminContextForShopDomain, authenticate } from "../shopify.server";
import {
  ensureDeliveryDiscount,
  suspendDeliveryDiscount,
} from "../services/discount.server";
import { updateBillingFromWebhook } from "../services/billing.server";
import { getRuleSetForShopDomain } from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const billing = await updateBillingFromWebhook(
    shop,
    payload as Record<string, unknown>,
  );

  await syncPaidFeaturesForBilling(shop, billing.billingStatus).catch((error) => {
    console.warn(
      `Billing feature sync skipped for ${shop}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  });

  return new Response();
};

async function syncPaidFeaturesForBilling(shop: string, billingStatus: string) {
  const record = await getRuleSetForShopDomain(shop);
  if (!record) return;

  const admin = await adminContextForShopDomain(shop);
  if (billingIsActive(billingStatus)) {
    await ensureDeliveryDiscount(admin, shop, record.ruleSet);
    return;
  }

  await suspendDeliveryDiscount(admin, shop, record.ruleSet);
}
