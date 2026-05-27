import { ensureDeliveryDiscount } from "./discount.server";
import { ensureDefaultRuleSet } from "./rules.server";
import {
  billingIsActive,
  ensureShopRecord,
  logEvent,
  syncBillingStatus,
} from "./shop.server";

type AdminClient = Parameters<typeof syncBillingStatus>[0];
type ShopifySession = {
  shop: string;
  accessToken?: string;
};

export async function prepareInstalledShop({
  admin,
  session,
  syncDiscount = false,
}: {
  admin: AdminClient;
  session: ShopifySession;
  syncDiscount?: boolean;
}) {
  const shop = await ensureShopRecord({
    shopDomain: session.shop,
    accessToken: session.accessToken,
  });
  const billingShop = await syncBillingStatus(admin, session.shop).catch(
    async (error) => {
      await logEvent(shop.id, "billing_sync_failed", error.message);
      return { ...shop, billingStatus: "INACTIVE" as const };
    },
  );
  const ruleSet = await ensureDefaultRuleSet(shop.id);

  if (syncDiscount && billingIsActive(billingShop.billingStatus)) {
    await ensureDeliveryDiscount(admin, session.shop, ruleSet).catch(
      async (error) => {
        await logEvent(shop.id, "discount_sync_failed", error.message);
      },
    );
  }

  return { shop: billingShop, ruleSet };
}
