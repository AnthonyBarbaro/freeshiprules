import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import { billingIsActive, syncBillingStatus } from "../services/shop.server";
import {
  ensureDefaultShippingProtection,
  ensureShippingProtectionProduct,
  markShippingProtectionSyncError,
  saveShippingProtectionSettings,
  shippingProtectionConfigFromRecord,
  storefrontShippingProtectionConfigFromRecord,
} from "../services/shipping-protection.server";
import type { ShippingProtectionInput } from "../services/shipping-protection-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });
  const shippingProtection = await ensureDefaultShippingProtection(shop.id);

  return Response.json({
    settings: shippingProtection,
    config: shippingProtectionConfigFromRecord(shippingProtection),
    storefront: storefrontShippingProtectionConfigFromRecord(shippingProtection),
    billingStatus: shop.billingStatus,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });
  const shippingProtection = await ensureDefaultShippingProtection(shop.id);

  const billingShop = await syncBillingStatus(admin, session.shop).catch(() => ({
    ...shop,
    billingStatus: "INACTIVE" as const,
  }));

  if (!billingIsActive(billingShop.billingStatus)) {
    return Response.json(
      { ok: false, error: "Billing must be active before saving settings." },
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
      shippingProtection.id,
      message,
    ).catch(() => undefined);

    return Response.json({ ok: false, error: message });
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
