import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { createBillingSubscription } from "../services/billing.server";
import { billingBypassEnabled } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return createBillingRedirect(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return createBillingRedirect(request);
};

async function createBillingRedirect(request: Request) {
  try {
    const { admin, session } = await authenticate.admin(request);

    if (billingBypassEnabled()) {
      return redirect("/app/settings?billing=bypass");
    }

    const subscription = await createBillingSubscription(admin, session.shop);
    return redirect(subscription.confirmationUrl!);
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

    return redirect(url.toString());
  }
}

function billingErrorMessage(message: string) {
  if (/403|forbidden/i.test(message)) {
    return [
      "Shopify rejected the billing request.",
      "Reopen the app to refresh the public-app access token, then try again.",
      "If this keeps happening, set App Store pricing to Manual pricing before using the Billing API.",
    ].join(" ");
  }

  return message;
}
