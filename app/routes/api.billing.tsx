import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { createBillingSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return createBillingRedirect(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return createBillingRedirect(request);
};

async function createBillingRedirect(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  const subscription = await createBillingSubscription(admin, session.shop);
  return redirect(subscription.confirmationUrl!);
}
