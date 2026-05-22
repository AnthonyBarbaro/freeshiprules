import db from "../db.server";
import { adminGraphql, userErrorMessage } from "./admin-graphql.server";
import { mapSubscriptionStatus } from "./shop.server";

type AdminClient = Parameters<typeof adminGraphql>[0];

type SubscriptionCreateResponse = {
  appSubscriptionCreate: {
    confirmationUrl: string | null;
    appSubscription: { id: string } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

export const PLAN_NAME = "FreeShip Rules Monthly";

export function monthlyPrice() {
  return Number(process.env.MONTHLY_PRICE || 10);
}

export function trialDays() {
  return Number(process.env.TRIAL_DAYS || 7);
}

export function billingTestMode() {
  return process.env.SHOPIFY_BILLING_TEST !== "false";
}

export async function createBillingSubscription(
  admin: AdminClient,
  shopDomain: string,
) {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    throw new Error("SHOPIFY_APP_URL is required to create billing.");
  }

  const returnUrl = `${appUrl.replace(/\/$/, "")}/app/billing?billing_return=1`;
  const data = await adminGraphql<SubscriptionCreateResponse>(
    admin,
    `#graphql
      mutation AppSubscriptionCreate(
        $name: String!
        $returnUrl: URL!
        $lineItems: [AppSubscriptionLineItemInput!]!
        $trialDays: Int
        $test: Boolean
      ) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          lineItems: $lineItems
          trialDays: $trialDays
          test: $test
        ) {
          userErrors {
            field
            message
          }
          appSubscription {
            id
          }
          confirmationUrl
        }
      }`,
    {
      name: PLAN_NAME,
      returnUrl,
      trialDays: trialDays(),
      test: billingTestMode(),
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: monthlyPrice(),
                currencyCode: "USD",
              },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  );

  const payload = data.appSubscriptionCreate;
  const error = userErrorMessage(payload.userErrors);
  if (error) throw new Error(error);
  if (!payload.confirmationUrl || !payload.appSubscription?.id) {
    throw new Error("Shopify did not return a billing confirmation URL.");
  }

  await db.shop.update({
    where: { shopDomain },
    data: {
      billingStatus: "PENDING",
      subscriptionId: payload.appSubscription.id,
      planName: PLAN_NAME,
    },
  });

  return payload;
}

export async function updateBillingFromWebhook(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  const subscriptionId = String(
    payload.admin_graphql_api_id ?? payload.id ?? "",
  );
  const status = mapSubscriptionStatus(String(payload.status ?? ""));

  return db.shop.updateMany({
    where: { shopDomain },
    data: {
      billingStatus: status,
      subscriptionId: subscriptionId || undefined,
      planName: String(payload.name ?? PLAN_NAME),
    },
  });
}
