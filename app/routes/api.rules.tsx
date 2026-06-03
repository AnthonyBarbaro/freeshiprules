import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import {
  ensureDeliveryDiscount,
  suspendDeliveryDiscount,
} from "../services/discount.server";
import {
  functionConfigFromRuleSet,
  saveRuleSet,
} from "../services/rules.server";
import { billingIsActive, syncBillingStatus } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, ruleSet } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });

  return Response.json({
    rule: ruleSet,
    config: functionConfigFromRuleSet(ruleSet),
    billingStatus: shop.billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const record = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });

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
    );
  }
};
