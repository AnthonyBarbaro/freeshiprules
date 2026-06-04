import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../services/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await cleanupUninstalledShop(shop, Boolean(session)).catch((error) => {
    console.warn(
      `Uninstall cleanup skipped for ${shop}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  });

  return new Response();
};

async function cleanupUninstalledShop(shop: string, hasSession: boolean) {
  // Webhook requests can trigger multiple times and after session records are gone.
  if (hasSession) {
    await db.session.deleteMany({ where: { shop } });
  }

  await markShopUninstalled(shop);
}
