import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect as reactRouterRedirect } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createBillingSubscription,
  syncBillingCheckStatus,
} from "../services/billing.server";
import {
  shopifyAppPricingEnabled,
  shopifyAppPricingUrl,
} from "../services/billing-config.server";
import { billingBypassEnabled, billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return createBillingRedirect(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return createBillingRedirect(request);
};

async function createBillingRedirect(request: Request) {
  try {
    const {
      admin,
      billing,
      redirect: shopifyRedirect,
      session,
    } = await authenticate.admin(request);

    if (billingBypassEnabled()) {
      return shopifyRedirect("/app/settings?billing=bypass");
    }

    if (shopifyAppPricingEnabled()) {
      const shop = await syncBillingCheckStatus(billing, session.shop).catch(
        () => null,
      );

      if (shop && billingIsActive(shop.billingStatus)) {
        return shopifyRedirect("/app/settings?billing=active");
      }

      return shopifyRedirect(shopifyAppPricingUrl(session.shop), {
        target: "_top",
      });
    }

    const subscription = await createBillingSubscription(admin, session.shop);
    return shopifyRedirect(subscription.confirmationUrl!, { target: "_top" });
  } catch (error) {
    if (error instanceof Response) throw error;

    const rawMessage =
      error instanceof Error ? error.message : "Billing could not be started.";
    const message = billingErrorMessage(rawMessage);
    console.error("Billing subscription creation failed:", rawMessage);

    const url = new URL(request.url);
    url.pathname = "/app/billing";
    url.search = "";
    url.searchParams.set("billing_error", message);

    return reactRouterRedirect(url.toString());
  }
}

function billingErrorMessage(message: string) {
  if (/403|forbidden/i.test(message)) {
    return [
      "Shopify rejected the billing request.",
      "Reopen the app to refresh the public-app access token, then try again.",
      "If this app uses Shopify App Pricing, keep SHOPIFY_BILLING_MODE=shopify_app_pricing so the app redirects to Shopify's hosted plan page.",
    ].join(" ");
  }

  return message;
}
