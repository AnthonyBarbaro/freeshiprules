import type { OrderAnalytics, Prisma } from "@prisma/client";
import db from "../db.server";

const PROTECTION_PROPERTY = "_freeship_shipping_protection";
const PROTECTION_TAG = "freeship-rules-shipping-protection";
const DAY_MS = 24 * 60 * 60 * 1000;

type JsonArray = Prisma.InputJsonValue[];

type LineItemMetric = {
  discountCents: number;
  grams: number;
  isProtection: boolean;
  productId: string | null;
  productType: string | null;
  quantity: number;
  requiresShipping: boolean;
  revenueCents: number;
  sku: string | null;
  title: string;
  variantId: string | null;
  vendor: string | null;
};

type ShippingLineMetric = {
  code: string | null;
  discountCents: number;
  discountedPriceCents: number | null;
  priceCents: number;
  source: string | null;
  title: string;
};

type DiscountCodeMetric = {
  amountCents: number;
  code: string;
  type: string | null;
};

type OrderMetricInput = {
  currencyCode: string;
  customerId: string | null;
  customerOrderCount: number | null;
  discountCents: number;
  discountCodesJson: JsonArray;
  financialStatus: string | null;
  freeShippingApplied: boolean;
  fulfillmentStatus: string | null;
  itemQuantity: number;
  lineItemsJson: JsonArray;
  orderCreatedAt: Date;
  orderName: string | null;
  paidShippingCents: number;
  paymentGatewayNamesJson: JsonArray;
  shippingCity: string | null;
  shippingCountry: string | null;
  shippingDiscountCents: number;
  shippingLinesJson: JsonArray;
  shippingMethod: string | null;
  shippingPriceCents: number;
  shippingProtectionCents: number;
  shippingProtectionPurchased: boolean;
  shippingProvince: string | null;
  shopifyOrderId: string;
  sourceName: string | null;
  subtotalCents: number;
  tagsJson: JsonArray;
  taxCents: number;
  totalCents: number;
  totalWeightGrams: number;
  uniqueProductCount: number;
};

export type AnalyticsSummary = {
  averageOrderCents: number;
  averageUnitsPerOrder: number;
  currencyCode: string;
  dailySales: Array<{
    date: string;
    discountCents: number;
    orderCount: number;
    protectionRevenueCents: number;
    revenueCents: number;
    shippingSavingsCents: number;
  }>;
  discountCents: number;
  discountRate: number;
  freeShippingOrders: number;
  freeShippingRate: number;
  grossSalesCents: number;
  itemQuantity: number;
  netSalesCents: number;
  orderCount: number;
  paidShippingCents: number;
  protectedOrders: number;
  protectionRate: number;
  protectionRevenueCents: number;
  recentOrders: Array<{
    discountCents: number;
    financialStatus: string | null;
    freeShippingApplied: boolean;
    itemQuantity: number;
    location: string;
    orderCreatedAt: string;
    orderName: string;
    protectionRevenueCents: number;
    shippingMethod: string;
    shippingSavingsCents: number;
    sourceName: string;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
  }>;
  repeatCustomerOrders: number;
  shippingSavingsCents: number;
  sourceChannels: RankedMetric[];
  taxCents: number;
  topDiscountCodes: RankedMetric[];
  topLocations: RankedMetric[];
  topProducts: Array<RankedMetric & { sku: string | null }>;
  topShippingMethods: RankedMetric[];
  uniqueCustomerCount: number;
};

type RankedMetric = {
  amountCents: number;
  count: number;
  label: string;
  orderCount: number;
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

  return summarizeOrders(orders, days);
}

export async function syncRecentOrderAnalyticsFromShopify({
  accessToken,
  days = 30,
  shopDomain,
}: {
  accessToken?: string;
  days?: number;
  shopDomain: string;
}) {
  if (!accessToken) {
    throw new Error("Shopify access token is missing.");
  }

  const createdAtMin = new Date(Date.now() - days * DAY_MS).toISOString();
  const fields = [
    "id",
    "admin_graphql_api_id",
    "name",
    "created_at",
    "currency",
    "line_items",
    "shipping_lines",
    "subtotal_price",
    "total_price",
    "total_discounts",
    "total_tax",
    "shipping_address",
    "customer",
    "discount_codes",
    "financial_status",
    "fulfillment_status",
    "payment_gateway_names",
    "source_name",
    "tags",
  ].join(",");
  let url: string | null =
    `https://${shopDomain}/admin/api/2026-04/orders.json` +
    `?status=any&limit=100&created_at_min=${encodeURIComponent(
      createdAtMin,
    )}&fields=${encodeURIComponent(fields)}`;
  let scanned = 0;
  let synced = 0;
  let pageCount = 0;

  while (url && pageCount < 5) {
    pageCount += 1;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Shopify orders sync failed with ${response.status}.`);
    }

    const body = (await response.json()) as { orders?: unknown[] };
    const orders = arrayValue(body.orders);
    scanned += orders.length;

    for (const order of orders) {
      const saved = await recordOrderAnalyticsFromWebhook(
        shopDomain,
        recordValue(order),
      );
      if (saved) synced += 1;
    }

    url = nextPageUrl(response.headers.get("link"));
  }

  return { scanned, synced };
}

export function orderMetricsFromPayload(
  payload: Record<string, unknown>,
): OrderMetricInput | null {
  const shopifyOrderId = orderId(payload);
  if (!shopifyOrderId) return null;

  const shippingLines = arrayValue(payload.shipping_lines).map(shippingLine);
  const rawLineItems = arrayValue(payload.line_items).map(recordValue);
  const lineItems = rawLineItems.map(lineItemMetric);
  const shippableItems = lineItems.filter((line) => !line.isProtection);
  const shippingPriceCents = shippingLines.reduce(
    (sum, line) => sum + line.priceCents,
    0,
  );
  const shippingDiscountCents = shippingLines.reduce(
    (sum, line) => sum + line.discountCents,
    0,
  );
  const hasZeroShippingLine = shippingLines.some(
    (line) => line.priceCents === 0 || line.discountedPriceCents === 0,
  );
  const protectionCents = lineItems
    .filter((line) => line.isProtection)
    .reduce((sum, line) => sum + line.revenueCents, 0);
  const shippingAddress = recordValue(payload.shipping_address);
  const customer = recordValue(payload.customer);

  return {
    currencyCode: stringValue(payload.currency, "USD"),
    customerId: idValue(customer.admin_graphql_api_id) ?? idValue(customer.id),
    customerOrderCount: integerValue(customer.orders_count, null),
    discountCents: moneyCents(payload.total_discounts),
    discountCodesJson: discountCodes(payload),
    financialStatus: stringValue(payload.financial_status, null),
    freeShippingApplied:
      shippingDiscountCents > 0 ||
      (shippingLines.length > 0 && hasZeroShippingLine),
    fulfillmentStatus: stringValue(payload.fulfillment_status, null),
    itemQuantity: shippableItems.reduce((sum, line) => sum + line.quantity, 0),
    lineItemsJson: lineItems as unknown as JsonArray,
    orderCreatedAt: dateValue(payload.created_at),
    orderName: stringValue(payload.name, null),
    paidShippingCents: Math.max(0, shippingPriceCents - shippingDiscountCents),
    paymentGatewayNamesJson: arrayValue(
      payload.payment_gateway_names,
    ) as JsonArray,
    shippingCity: stringValue(shippingAddress.city, null),
    shippingCountry:
      stringValue(shippingAddress.country_code, null) ??
      stringValue(shippingAddress.country, null),
    shippingDiscountCents,
    shippingLinesJson: shippingLines as unknown as JsonArray,
    shippingMethod: shippingLines[0]?.title ?? null,
    shippingPriceCents,
    shippingProtectionCents: protectionCents,
    shippingProtectionPurchased: protectionCents > 0,
    shippingProvince:
      stringValue(shippingAddress.province_code, null) ??
      stringValue(shippingAddress.province, null),
    shopifyOrderId,
    sourceName: stringValue(payload.source_name, null),
    subtotalCents: moneyCents(payload.subtotal_price),
    tagsJson: tags(payload.tags) as JsonArray,
    taxCents: moneyCents(payload.total_tax),
    totalCents: moneyCents(payload.total_price),
    totalWeightGrams: shippableItems.reduce(
      (sum, line) => sum + line.grams * line.quantity,
      0,
    ),
    uniqueProductCount: new Set(
      shippableItems.map(
        (line) => line.productId ?? line.variantId ?? normalized(line.title),
      ),
    ).size,
  };
}

function summarizeOrders(
  orders: OrderAnalytics[],
  days = 30,
): AnalyticsSummary {
  const orderCount = orders.length;
  const totals = orders.reduce(
    (sum, order) => ({
      discountCents: sum.discountCents + order.discountCents,
      freeShippingOrders:
        sum.freeShippingOrders + (order.freeShippingApplied ? 1 : 0),
      grossSalesCents: sum.grossSalesCents + order.subtotalCents,
      itemQuantity: sum.itemQuantity + order.itemQuantity,
      paidShippingCents: sum.paidShippingCents + order.paidShippingCents,
      protectedOrders:
        sum.protectedOrders + (order.shippingProtectionPurchased ? 1 : 0),
      protectionRevenueCents:
        sum.protectionRevenueCents + order.shippingProtectionCents,
      repeatCustomerOrders:
        sum.repeatCustomerOrders +
        ((order.customerOrderCount ?? 0) > 1 ? 1 : 0),
      shippingSavingsCents:
        sum.shippingSavingsCents + order.shippingDiscountCents,
      taxCents: sum.taxCents + order.taxCents,
      totalCents: sum.totalCents + order.totalCents,
    }),
    {
      discountCents: 0,
      freeShippingOrders: 0,
      grossSalesCents: 0,
      itemQuantity: 0,
      paidShippingCents: 0,
      protectedOrders: 0,
      protectionRevenueCents: 0,
      repeatCustomerOrders: 0,
      shippingSavingsCents: 0,
      taxCents: 0,
      totalCents: 0,
    },
  );
  const customerIds = new Set(
    orders.map((order) => order.customerId).filter(Boolean),
  );

  return {
    averageOrderCents: orderCount
      ? Math.round(totals.totalCents / orderCount)
      : 0,
    averageUnitsPerOrder: orderCount
      ? round(totals.itemQuantity / orderCount, 1)
      : 0,
    currencyCode: orders[0]?.currencyCode ?? "USD",
    dailySales: dailySales(orders, days),
    discountCents: totals.discountCents,
    discountRate: totals.grossSalesCents
      ? Math.round((totals.discountCents / totals.grossSalesCents) * 100)
      : 0,
    freeShippingOrders: totals.freeShippingOrders,
    freeShippingRate: orderCount
      ? Math.round((totals.freeShippingOrders / orderCount) * 100)
      : 0,
    grossSalesCents: totals.grossSalesCents,
    itemQuantity: totals.itemQuantity,
    netSalesCents: Math.max(0, totals.grossSalesCents - totals.discountCents),
    orderCount,
    paidShippingCents: totals.paidShippingCents,
    protectedOrders: totals.protectedOrders,
    protectionRate: orderCount
      ? Math.round((totals.protectedOrders / orderCount) * 100)
      : 0,
    protectionRevenueCents: totals.protectionRevenueCents,
    recentOrders: orders.slice(0, 20).map((order) => ({
      discountCents: order.discountCents,
      financialStatus: order.financialStatus,
      freeShippingApplied: order.freeShippingApplied,
      itemQuantity: order.itemQuantity,
      location: locationLabel(order),
      orderCreatedAt: order.orderCreatedAt.toISOString(),
      orderName: order.orderName || order.shopifyOrderId,
      protectionRevenueCents: order.shippingProtectionCents,
      shippingMethod: order.shippingMethod || "No shipping method",
      shippingSavingsCents: order.shippingDiscountCents,
      sourceName: sourceLabel(order.sourceName),
      subtotalCents: order.subtotalCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
    })),
    repeatCustomerOrders: totals.repeatCustomerOrders,
    shippingSavingsCents: totals.shippingSavingsCents,
    sourceChannels: rankedSourceChannels(orders),
    taxCents: totals.taxCents,
    topDiscountCodes: rankedDiscountCodes(orders),
    topLocations: rankedLocations(orders),
    topProducts: rankedProducts(orders),
    topShippingMethods: rankedShippingMethods(orders),
    uniqueCustomerCount: customerIds.size,
  };
}

function emptySummary(): AnalyticsSummary {
  return summarizeOrders([]);
}

function dailySales(orders: OrderAnalytics[], days: number) {
  const today = startOfDay(new Date());
  const start = new Date(today.getTime() - Math.max(days - 1, 0) * DAY_MS);
  const byDate = new Map<
    string,
    AnalyticsSummary["dailySales"][number]
  >();

  for (let index = 0; index < days; index += 1) {
    const date = new Date(start.getTime() + index * DAY_MS);
    const key = isoDate(date);
    byDate.set(key, {
      date: key,
      discountCents: 0,
      orderCount: 0,
      protectionRevenueCents: 0,
      revenueCents: 0,
      shippingSavingsCents: 0,
    });
  }

  for (const order of orders) {
    const key = isoDate(order.orderCreatedAt);
    const bucket = byDate.get(key);
    if (!bucket) continue;
    bucket.discountCents += order.discountCents;
    bucket.orderCount += 1;
    bucket.protectionRevenueCents += order.shippingProtectionCents;
    bucket.revenueCents += order.totalCents;
    bucket.shippingSavingsCents += order.shippingDiscountCents;
  }

  return Array.from(byDate.values());
}

function rankedProducts(orders: OrderAnalytics[]) {
  const map = new Map<
    string,
    RankedMetric & { orderIds: Set<string>; sku: string | null }
  >();

  for (const order of orders) {
    for (const item of arrayValue(order.lineItemsJson)) {
      const record = recordValue(item);
      if (record.isProtection) continue;
      const title = stringValue(record.title, "Untitled product");
      const sku = stringValue(record.sku, null);
      const key = `${title}::${sku ?? ""}`;
      const entry = map.get(key) ?? {
        amountCents: 0,
        count: 0,
        label: title,
        orderCount: 0,
        orderIds: new Set<string>(),
        sku,
      };
      entry.amountCents += integerValue(record.revenueCents, 0) ?? 0;
      entry.count += integerValue(record.quantity, 0) ?? 0;
      entry.orderIds.add(order.shopifyOrderId);
      entry.orderCount = entry.orderIds.size;
      map.set(key, entry);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.amountCents - a.amountCents || b.count - a.count)
    .slice(0, 8)
    .map((entry) => ({
      amountCents: entry.amountCents,
      count: entry.count,
      label: entry.label,
      orderCount: entry.orderCount,
      sku: entry.sku,
    }));
}

function rankedDiscountCodes(orders: OrderAnalytics[]) {
  const map = new Map<string, RankedMetric & { orderIds: Set<string> }>();

  for (const order of orders) {
    const discounts = arrayValue(order.discountCodesJson);
    for (const discount of discounts) {
      const record = recordValue(discount);
      const code = stringValue(record.code, null);
      if (!code) continue;
      const entry = map.get(code) ?? {
        amountCents: 0,
        count: 0,
        label: code,
        orderCount: 0,
        orderIds: new Set<string>(),
      };
      entry.amountCents += integerValue(record.amountCents, 0) ?? 0;
      entry.count += 1;
      entry.orderIds.add(order.shopifyOrderId);
      entry.orderCount = entry.orderIds.size;
      map.set(code, entry);
    }
  }

  return rankedMap(map);
}

function rankedShippingMethods(orders: OrderAnalytics[]) {
  const map = new Map<string, RankedMetric & { orderIds: Set<string> }>();

  for (const order of orders) {
    const label = order.shippingMethod || "No shipping method";
    const entry = map.get(label) ?? {
      amountCents: 0,
      count: 0,
      label,
      orderCount: 0,
      orderIds: new Set<string>(),
    };
    entry.amountCents += order.paidShippingCents;
    entry.count += 1;
    entry.orderIds.add(order.shopifyOrderId);
    entry.orderCount = entry.orderIds.size;
    map.set(label, entry);
  }

  return rankedMap(map);
}

function rankedLocations(orders: OrderAnalytics[]) {
  const map = new Map<string, RankedMetric & { orderIds: Set<string> }>();

  for (const order of orders) {
    const label = locationLabel(order);
    const entry = map.get(label) ?? {
      amountCents: 0,
      count: 0,
      label,
      orderCount: 0,
      orderIds: new Set<string>(),
    };
    entry.amountCents += order.totalCents;
    entry.count += 1;
    entry.orderIds.add(order.shopifyOrderId);
    entry.orderCount = entry.orderIds.size;
    map.set(label, entry);
  }

  return rankedMap(map);
}

function rankedSourceChannels(orders: OrderAnalytics[]) {
  const map = new Map<string, RankedMetric & { orderIds: Set<string> }>();

  for (const order of orders) {
    const label = sourceLabel(order.sourceName);
    const entry = map.get(label) ?? {
      amountCents: 0,
      count: 0,
      label,
      orderCount: 0,
      orderIds: new Set<string>(),
    };
    entry.amountCents += order.totalCents;
    entry.count += 1;
    entry.orderIds.add(order.shopifyOrderId);
    entry.orderCount = entry.orderIds.size;
    map.set(label, entry);
  }

  return rankedMap(map);
}

function rankedMap(map: Map<string, RankedMetric & { orderIds: Set<string> }>) {
  return Array.from(map.values())
    .sort((a, b) => b.amountCents - a.amountCents || b.count - a.count)
    .slice(0, 8)
    .map((entry) => ({
      amountCents: entry.amountCents,
      count: entry.count,
      label: entry.label,
      orderCount: entry.orderCount,
    }));
}

function orderId(payload: Record<string, unknown>) {
  return idValue(payload.admin_graphql_api_id) ?? idValue(payload.id);
}

function shippingLine(value: unknown): ShippingLineMetric {
  const record = recordValue(value);
  const priceCents = moneyCents(record.price);
  let discountedPriceCents: number | null = null;
  if (record.discounted_price !== undefined) {
    discountedPriceCents = moneyCents(record.discounted_price);
  }
  const allocationDiscountCents = arrayValue(
    record.discount_allocations,
  ).reduce(
    (sum, allocation) => sum + moneyCents(recordValue(allocation).amount),
    0,
  );
  const discountFromPrices =
    discountedPriceCents === null
      ? 0
      : Math.max(0, priceCents - discountedPriceCents);

  return {
    code: stringValue(record.code, null),
    discountCents: Math.max(allocationDiscountCents, discountFromPrices),
    discountedPriceCents,
    priceCents,
    source: stringValue(record.source, null),
    title:
      stringValue(record.title, null) ??
      stringValue(record.code, null) ??
      "Shipping",
  };
}

function lineItemMetric(line: Record<string, unknown>): LineItemMetric {
  const quantity = quantityValue(line.quantity);
  const priceCents = moneyCents(line.price);
  const discountCents = moneyCents(line.total_discount);
  const isProtection = isProtectionLine(line);

  return {
    discountCents,
    grams: integerValue(line.grams, 0) ?? 0,
    isProtection,
    productId: idValue(line.product_id),
    productType: stringValue(line.product_type, null),
    quantity,
    requiresShipping: line.requires_shipping !== false,
    revenueCents: Math.max(0, priceCents * quantity - discountCents),
    sku: stringValue(line.sku, null),
    title:
      stringValue(line.title, null) ??
      stringValue(line.name, null) ??
      "Untitled product",
    variantId: idValue(line.variant_id),
    vendor: stringValue(line.vendor, null),
  };
}

function discountCodes(payload: Record<string, unknown>): JsonArray {
  return arrayValue(payload.discount_codes)
    .map((discount) => {
      const record = recordValue(discount);
      const code = stringValue(record.code, null);
      if (!code) return null;
      return {
        amountCents: moneyCents(record.amount),
        code,
        type: stringValue(record.type, null),
      } satisfies DiscountCodeMetric;
    })
    .filter((discount): discount is DiscountCodeMetric => Boolean(discount));
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

function locationLabel(order: Pick<OrderAnalytics, "shippingCity" | "shippingCountry" | "shippingProvince">) {
  const city = order.shippingCity;
  const region = [order.shippingProvince, order.shippingCountry]
    .filter(Boolean)
    .join(", ");

  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  return region || "Unknown location";
}

function sourceLabel(value: string | null) {
  if (!value) return "Unknown source";
  if (value === "web") return "Online store";
  if (value === "pos") return "Point of sale";
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function nextPageUrl(linkHeader: string | null) {
  if (!linkHeader) return null;
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/.test(part));
  const match = next?.match(/<([^>]+)>/);
  return match?.[1] ?? null;
}

function tags(value: unknown) {
  if (Array.isArray(value)) return value.filter((tag) => typeof tag === "string");
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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

function integerValue(value: unknown, fallback: number): number;
function integerValue(value: unknown, fallback: null): number | null;
function integerValue(value: unknown, fallback: number | null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function moneyCents(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function normalized(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
