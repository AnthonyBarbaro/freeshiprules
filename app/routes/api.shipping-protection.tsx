import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { billingIsActive, syncBillingStatus } from "../services/shop.server";
import {
  ensureShippingProtectionProduct,
  getShippingProtectionForShopDomain,
  markShippingProtectionSyncError,
  saveShippingProtectionSettings,
  shippingProtectionConfigFromRecord,
  storefrontShippingProtectionConfigFromRecord,
} from "../services/shipping-protection.server";
import type { ShippingProtectionInput } from "../services/shipping-protection-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const record = await getShippingProtectionForShopDomain(session.shop);
  if (!record)
    return Response.json({ error: "Shop not found" }, { status: 404 });

  return Response.json({
    settings: record.shippingProtection,
    config: shippingProtectionConfigFromRecord(record.shippingProtection),
    storefront: storefrontShippingProtectionConfigFromRecord(
      record.shippingProtection,
    ),
    billingStatus: record.shop.billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const record = await getShippingProtectionForShopDomain(session.shop);
  if (!record)
    return Response.json({ error: "Shop not found" }, { status: 404 });

  const billingShop = await syncBillingStatus(admin, session.shop).catch(() => ({
    ...record.shop,
    billingStatus: "INACTIVE" as const,
  }));

  if (!billingIsActive(billingShop.billingStatus)) {
    return Response.json(
      { ok: false, error: "Billing must be active before saving settings." },
      { status: 402 },
    );
  }

  const input = await parseProtectionInput(request);
  const actionName = String(input._action ?? "save");

  try {
    const settings = await saveShippingProtectionSettings(session.shop, input);
    const shouldSync = settings.enabled || actionName === "sync";
    const synced = shouldSync
      ? await ensureShippingProtectionProduct(admin, session.shop, settings)
      : null;

    return Response.json({
      ok: true,
      settings: synced?.settings ?? settings,
      product: synced?.product ?? null,
      storefront: storefrontShippingProtectionConfigFromRecord(
        synced?.settings ?? settings,
      ),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save shipping protection.";

    await markShippingProtectionSyncError(
      record.shippingProtection.id,
      message,
    ).catch(() => undefined);

    return Response.json({ ok: false, error: message }, { status: 400 });
  }
};

async function parseProtectionInput(request: Request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    return (await request.json()) as ShippingProtectionInput & {
      _action?: unknown;
    };
  }

  const formData = await request.formData();

  return {
    ...Object.fromEntries(formData),
    tierMin: formData.getAll("tierMin"),
    tierMax: formData.getAll("tierMax"),
    tierAmount: formData.getAll("tierAmount"),
  } as ShippingProtectionInput & { _action?: unknown };
}
