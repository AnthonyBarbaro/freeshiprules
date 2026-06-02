import type { OrderAnalytics } from "@prisma/client";
import db from "../db.server";

const PROTECTION_PROPERTY = "_freeship_shipping_protection";
const PROTECTION_TAG = "freeship-rules-shipping-protection";

type OrderMetricInput = {
  currencyCode: string;
  freeShippingApplied: boolean;
  orderCreatedAt: Date;
  orderName: string | null;
  shippingDiscountCents: number;
  shippingPriceCents: number;
  shippingProtectionCents: number;
  shippingProtectionPurchased: boolean;
  shopifyOrderId: string;
  subtotalCents: number;
  totalCents: number;
};

export type AnalyticsSummary = {
  averageOrderCents: number;
  currencyCode: string;
  freeShippingOrders: number;
  freeShippingRate: number;
  orderCount: number;
  protectedOrders: number;
  protectionRevenueCents: number;
  recentOrders: Array<{
    freeShippingApplied: boolean;
    orderCreatedAt: string;
    orderName: string;
    protectionRevenueCents: number;
    shippingSavingsCents: number;
    totalCents: number;
  }>;
  shippingSavingsCents: number;
};

export async function recordOrderAnalyticsFromWebhook(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return null;

  const metrics = orderMetricsFromPayload(payload);
  if (!metrics) return null;

  return db.orderAnalytics.upsert({
    where: {
      shopId_shopifyOrderId: {
        shopId: shop.id,
        shopifyOrderId: metrics.shopifyOrderId,
      },
    },
    create: {
      shopId: shop.id,
      ...metrics,
    },
    update: metrics,
  });
}

export async function analyticsSummaryForShopDomain(
  shopDomain: string,
  days = 30,
): Promise<AnalyticsSummary> {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return emptySummary();

  const since = new Date();
  since.setDate(since.getDate() - days);

  const orders = await db.orderAnalytics.findMany({
    where: {
      shopId: shop.id,
      orderCreatedAt: { gte: since },
    },
    orderBy: { orderCreatedAt: "desc" },
  });

  return summarizeOrders(orders);
}

export function orderMetricsFromPayload(
  payload: Record<string, unknown>,
): OrderMetricInput | null {
  const shopifyOrderId = orderId(payload);
  if (!shopifyOrderId) return null;

  const shippingLines = arrayValue(payload.shipping_lines);
  const lineItems = arrayValue(payload.line_items);
  const shippingPriceCents = shippingLines.reduce(
    (sum, line) => sum + moneyCents(recordValue(line).price),
    0,
  );
  let hasDiscountedShippingPrice = false;
  const discountedShippingCents = shippingLines.reduce((sum, line) => {
    const value = recordValue(line).discounted_price;
    if (value !== undefined) hasDiscountedShippingPrice = true;
    return value === undefined ? sum : sum + moneyCents(value);
  }, 0);
  const allocationDiscountCents = shippingLines.reduce(
    (sum, line) =>
      sum +
      arrayValue(recordValue(line).discount_allocations).reduce(
        (allocationSum, allocation) =>
          allocationSum + moneyCents(recordValue(allocation).amount),
        0,
      ),
    0,
  );
  const discountFromPrices =
    hasDiscountedShippingPrice
      ? Math.max(0, shippingPriceCents - discountedShippingCents)
      : 0;
  const shippingDiscountCents = Math.max(
    allocationDiscountCents,
    discountFromPrices,
  );
  const hasZeroShippingLine = shippingLines.some(
    (line) => moneyCents(recordValue(line).price) === 0,
  );
  const protectionCents = shippingProtectionCents(lineItems);

  return {
    currencyCode: stringValue(payload.currency, "USD"),
    freeShippingApplied:
      shippingDiscountCents > 0 ||
      (shippingLines.length > 0 && hasZeroShippingLine),
    orderCreatedAt: dateValue(payload.created_at),
    orderName: stringValue(payload.name, null),
    shippingDiscountCents,
    shippingPriceCents,
    shippingProtectionCents: protectionCents,
    shippingProtectionPurchased: protectionCents > 0,
    shopifyOrderId,
    subtotalCents: moneyCents(payload.subtotal_price),
    totalCents: moneyCents(payload.total_price),
  };
}

function summarizeOrders(orders: OrderAnalytics[]): AnalyticsSummary {
  const orderCount = orders.length;
  const totals = orders.reduce(
    (sum, order) => ({
      freeShippingOrders:
        sum.freeShippingOrders + (order.freeShippingApplied ? 1 : 0),
      protectedOrders:
        sum.protectedOrders + (order.shippingProtectionPurchased ? 1 : 0),
      protectionRevenueCents:
        sum.protectionRevenueCents + order.shippingProtectionCents,
      shippingSavingsCents:
        sum.shippingSavingsCents + order.shippingDiscountCents,
      totalCents: sum.totalCents + order.totalCents,
    }),
    {
      freeShippingOrders: 0,
      protectedOrders: 0,
      protectionRevenueCents: 0,
      shippingSavingsCents: 0,
      totalCents: 0,
    },
  );

  return {
    averageOrderCents: orderCount
      ? Math.round(totals.totalCents / orderCount)
      : 0,
    currencyCode: orders[0]?.currencyCode ?? "USD",
    freeShippingOrders: totals.freeShippingOrders,
    freeShippingRate: orderCount
      ? Math.round((totals.freeShippingOrders / orderCount) * 100)
      : 0,
    orderCount,
    protectedOrders: totals.protectedOrders,
    protectionRevenueCents: totals.protectionRevenueCents,
    recentOrders: orders.slice(0, 10).map((order) => ({
      freeShippingApplied: order.freeShippingApplied,
      orderCreatedAt: order.orderCreatedAt.toISOString(),
      orderName: order.orderName || order.shopifyOrderId,
      protectionRevenueCents: order.shippingProtectionCents,
      shippingSavingsCents: order.shippingDiscountCents,
      totalCents: order.totalCents,
    })),
    shippingSavingsCents: totals.shippingSavingsCents,
  };
}

function emptySummary(): AnalyticsSummary {
  return {
    averageOrderCents: 0,
    currencyCode: "USD",
    freeShippingOrders: 0,
    freeShippingRate: 0,
    orderCount: 0,
    protectedOrders: 0,
    protectionRevenueCents: 0,
    recentOrders: [],
    shippingSavingsCents: 0,
  };
}

function orderId(payload: Record<string, unknown>) {
  return idValue(payload.admin_graphql_api_id) ?? idValue(payload.id);
}

function shippingProtectionCents(lineItems: unknown[]): number {
  return lineItems
    .filter((line) => isProtectionLine(recordValue(line)))
    .reduce<number>((sum, line) => {
      const record = recordValue(line);
      return sum + moneyCents(record.price) * quantityValue(record.quantity);
    }, 0);
}

function isProtectionLine(line: Record<string, unknown>) {
  const properties = arrayValue(line.properties);
  const hasProperty = properties.some((property) => {
    const record = recordValue(property);
    return (
      record.name === PROTECTION_PROPERTY &&
      String(record.value).toLowerCase() === "true"
    );
  });
  const sku = stringValue(line.sku, "").toLowerCase();
  const title = stringValue(line.title, "");

  return (
    hasProperty ||
    sku.includes(PROTECTION_TAG) ||
    title.toLowerCase().includes("shipping protection")
  );
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string;
function stringValue(value: unknown, fallback: null): string | null;
function stringValue(value: unknown, fallback: string | null) {
  return typeof value === "string" && value ? value : fallback;
}

function idValue(value: unknown) {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function dateValue(value: unknown) {
  if (typeof value !== "string") return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function quantityValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function moneyCents(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
