import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordOrderAnalyticsFromWebhook } from "../services/analytics.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  await recordOrderAnalyticsFromWebhook(shop, payload as Record<string, unknown>);
  return new Response();
};
