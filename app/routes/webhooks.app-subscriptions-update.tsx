import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { updateBillingFromWebhook } from "../services/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  await updateBillingFromWebhook(shop, payload as Record<string, unknown>);
  return new Response();
};
