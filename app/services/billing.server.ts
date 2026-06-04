import db from "../db.server";
import { adminGraphql, userErrorMessage } from "./admin-graphql.server";
import { shopifyAppPricingEnabled } from "./billing-config.server";
import { mapSubscriptionStatus } from "./shop.server";

type AdminClient = Parameters<typeof adminGraphql>[0];

type SubscriptionCreateResponse = {
  appSubscriptionCreate: {
    confirmationUrl: string | null;
    appSubscription: { id: string } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

type BillingCheckContext = {
  check: (options?: { isTest?: boolean }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions: Array<{
      id: string;
      name: string;
      status: string;
      currentPeriodEnd?: string | null;
    }>;
  }>;
};

export const PLAN_NAME = "FreeShip Rules Monthly";

export function monthlyPrice() {
  return Number(process.env.MONTHLY_PRICE || 9.99);
}

export function trialDays() {
  return Number(process.env.TRIAL_DAYS || 7);
}

export function billingTestMode() {
  return (
    process.env.SHOPIFY_BILLING_TEST === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export function validateBillingConfig() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) {
    throw new Error("SHOPIFY_APP_URL is required to create billing.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error("SHOPIFY_APP_URL must be a valid public HTTPS URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("SHOPIFY_APP_URL must start with https:// for billing.");
  }

  if (parsedUrl.hostname.endsWith(".railway.internal")) {
    throw new Error(
      "SHOPIFY_APP_URL is using Railway's internal domain. Use the public Railway service domain instead.",
    );
  }

  const price = monthlyPrice();
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("MONTHLY_PRICE must be greater than 0.");
  }

  const trial = trialDays();
  if (!Number.isInteger(trial) || trial < 0) {
    throw new Error(
      "TRIAL_DAYS must be a whole number greater than or equal to 0.",
    );
  }

  return {
    appUrl: parsedUrl.origin,
    price,
    trialDays: trial,
  };
}

export async function createBillingSubscription(
  admin: AdminClient,
  shopDomain: string,
) {
  if (shopifyAppPricingEnabled()) {
    throw new Error(
      "Shopify App Pricing is enabled. Redirect merchants to Shopify's hosted plan selection page instead of creating Billing API charges.",
    );
  }

  const config = validateBillingConfig();

  const returnUrl = `${config.appUrl}/app/billing?billing_return=1`;
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
      trialDays: config.trialDays,
      test: billingTestMode(),
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: config.price,
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

  await db.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      billingStatus: "PENDING",
      subscriptionId: payload.appSubscription.id,
      planName: PLAN_NAME,
    },
    update: {
      billingStatus: "PENDING",
      subscriptionId: payload.appSubscription.id,
      planName: PLAN_NAME,
    },
  });

  return payload;
}

export async function syncBillingCheckStatus(
  billing: BillingCheckContext,
  shopDomain: string,
) {
  const check = await billing.check({ isTest: billingTestMode() });
  const activeSubscription =
    check.appSubscriptions.find((subscription) =>
      ["ACTIVE", "ACCEPTED"].includes(subscription.status),
    ) ?? check.appSubscriptions[0];
  const billingStatus = check.hasActivePayment
    ? mapSubscriptionStatus(activeSubscription?.status ?? "ACTIVE")
    : mapSubscriptionStatus(activeSubscription?.status);
  const trialEndsAt = activeSubscription?.currentPeriodEnd
    ? new Date(activeSubscription.currentPeriodEnd)
    : null;

  return db.shop.update({
    where: { shopDomain },
    data: {
      billingStatus,
      subscriptionId: activeSubscription?.id ?? null,
      planName: activeSubscription?.name ?? null,
      trialEndsAt,
    },
  });
}

export async function updateBillingFromWebhook(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  const subscriptionId = String(
    payload.admin_graphql_api_id ?? payload.id ?? "",
  );
  const status = mapSubscriptionStatus(String(payload.status ?? ""));

  await db.shop.updateMany({
    where: { shopDomain },
    data: {
      billingStatus: status,
      subscriptionId: subscriptionId || undefined,
      planName: String(payload.name ?? PLAN_NAME),
    },
  });

  return {
    billingStatus: status,
    subscriptionId,
  };
}
