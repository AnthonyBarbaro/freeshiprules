import type { BillingStatus, Prisma } from "@prisma/client";
import db from "../db.server";
import { adminGraphql } from "./admin-graphql.server";
import { encryptSecret } from "./crypto.server";

type AdminClient = Parameters<typeof adminGraphql>[0];

type ActiveSubscriptionsResponse = {
  currentAppInstallation: {
    activeSubscriptions: Array<{
      id: string;
      name: string;
      status: string;
      trialDays?: number | null;
      currentPeriodEnd?: string | null;
    }>;
  };
};

export async function ensureShopRecord({
  shopDomain,
  accessToken,
}: {
  shopDomain: string;
  accessToken?: string;
}) {
  return db.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      accessTokenEncrypted: accessToken ? encryptSecret(accessToken) : null,
      installedAt: new Date(),
      billingStatus: "INACTIVE",
    },
    update: {
      uninstalledAt: null,
      ...(accessToken
        ? { accessTokenEncrypted: encryptSecret(accessToken) }
        : {}),
    },
  });
}

export async function syncBillingStatus(
  admin: AdminClient,
  shopDomain: string,
) {
  const data = await adminGraphql<ActiveSubscriptionsResponse>(
    admin,
    `#graphql
      query ActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            trialDays
            currentPeriodEnd
          }
        }
      }`,
  );

  const activeSubscription =
    data.currentAppInstallation.activeSubscriptions.find((subscription) =>
      ["ACTIVE", "ACCEPTED"].includes(subscription.status),
    ) ?? data.currentAppInstallation.activeSubscriptions[0];

  const billingStatus = mapSubscriptionStatus(activeSubscription?.status);
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

export async function markShopUninstalled(shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return null;

  return db.shop.update({
    where: { shopDomain },
    data: {
      uninstalledAt: new Date(),
      billingStatus: "CANCELLED",
      accessTokenEncrypted: null,
    },
  });
}

export async function logEvent(
  shopId: string,
  type: string,
  message: string,
  metadataJson: Record<string, unknown> = {},
) {
  return db.eventLog.create({
    data: {
      shopId,
      type,
      message,
      metadataJson: metadataJson as Prisma.InputJsonObject,
    },
  });
}

export function billingIsActive(status: BillingStatus | string | null) {
  return billingBypassEnabled() || status === "ACTIVE";
}

export function billingBypassEnabled() {
  return (
    process.env.SHOPIFY_BILLING_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export function mapSubscriptionStatus(status?: string | null): BillingStatus {
  switch (status) {
    case "ACTIVE":
    case "ACCEPTED":
      return "ACTIVE";
    case "PENDING":
      return "PENDING";
    case "FROZEN":
      return "FROZEN";
    case "DECLINED":
      return "DECLINED";
    case "EXPIRED":
      return "EXPIRED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "INACTIVE";
  }
}
