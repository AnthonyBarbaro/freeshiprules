import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import {
  billingTestMode,
  monthlyPrice,
  trialDays,
} from "../services/billing.server";
import { billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({ admin, session });

  if (
    url.searchParams.get("billing_return") &&
    billingIsActive(shop.billingStatus)
  ) {
    throw redirect("/app/settings");
  }

  return {
    billingStatus: shop.billingStatus,
    billingActive: billingIsActive(shop.billingStatus),
    price: monthlyPrice(),
    trialDays: trialDays(),
    testMode: billingTestMode(),
  };
};

export default function Billing() {
  const { billingStatus, billingActive, price, trialDays, testMode } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Billing">
      {billingActive ? (
        <s-section heading="Plan active">
          <s-paragraph>FreeShip Rules is active at ${price}/month.</s-paragraph>
          <s-button href="/app/settings">Open settings</s-button>
        </s-section>
      ) : (
        <s-section heading="Approve plan">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Start FreeShip Rules for ${price}/month with a {trialDays}-day
              free trial.
            </s-paragraph>
            {testMode && (
              <s-banner tone="info">
                <s-paragraph>Billing test mode is enabled.</s-paragraph>
              </s-banner>
            )}
            <s-box>
              <s-text>Current status: {billingStatus}</s-text>
            </s-box>
            <s-button variant="primary" href="/api/billing" target="_top">
              Approve billing
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
