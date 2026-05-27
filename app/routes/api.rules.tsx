import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureDeliveryDiscount,
  suspendDeliveryDiscount,
} from "../services/discount.server";
import {
  functionConfigFromRuleSet,
  getRuleSetForShopDomain,
  saveRuleSet,
} from "../services/rules.server";
import { billingIsActive, syncBillingStatus } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const record = await getRuleSetForShopDomain(session.shop);
  if (!record)
    return Response.json({ error: "Shop not found" }, { status: 404 });

  return Response.json({
    rule: record.ruleSet,
    config: functionConfigFromRuleSet(record.ruleSet),
    billingStatus: record.shop.billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const record = await getRuleSetForShopDomain(session.shop);
  if (!record)
    return Response.json({ error: "Shop not found" }, { status: 404 });

  const billingShop = await syncBillingStatus(admin, session.shop).catch(() => ({
    ...record.shop,
    billingStatus: "INACTIVE" as const,
  }));

  if (!billingIsActive(billingShop.billingStatus)) {
    await suspendDeliveryDiscount(admin, session.shop, record.ruleSet).catch(
      () => undefined,
    );
    return Response.json(
      { ok: false, error: "Billing must be active before saving settings." },
      { status: 402 },
    );
  }

  const input = request.headers
    .get("content-type")
    ?.includes("application/json")
    ? await request.json()
    : Object.fromEntries(await request.formData());

  try {
    const ruleSet = await saveRuleSet(session.shop, input);
    const synced = await ensureDeliveryDiscount(admin, session.shop, ruleSet);
    return Response.json({
      ok: true,
      rule: synced.ruleSet,
      discount: synced.discount,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save rules.",
      },
      { status: 400 },
    );
  }
};
