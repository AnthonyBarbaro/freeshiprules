import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsSummaryForShopDomain,
  orderMetricsFromPayload,
  recordOrderAnalyticsFromWebhook,
} from "./analytics.server";

const mocks = vi.hoisted(() => ({
  db: {
    shop: {
      findUnique: vi.fn(),
    },
    orderAnalytics: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../db.server", () => ({ default: mocks.db }));

describe("analytics service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts free shipping and protection metrics from order webhook payload", () => {
    const metrics = orderMetricsFromPayload(orderPayload());

    expect(metrics).toMatchObject({
      shopifyOrderId: "gid://shopify/Order/1001",
      orderName: "#1001",
      currencyCode: "USD",
      subtotalCents: 5000,
      totalCents: 5400,
      shippingPriceCents: 800,
      shippingDiscountCents: 800,
      freeShippingApplied: true,
      shippingProtectionCents: 800,
      shippingProtectionPurchased: true,
    });
  });

  it("upserts order analytics by shop and Shopify order id", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.orderAnalytics.upsert.mockImplementation(async (args) => args.create);

    const result = await recordOrderAnalyticsFromWebhook(
      "test-shop.myshopify.com",
      orderPayload(),
    );

    expect(mocks.db.orderAnalytics.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shopId_shopifyOrderId: {
            shopId: "shop_1",
            shopifyOrderId: "gid://shopify/Order/1001",
          },
        },
      }),
    );
    expect(result).toMatchObject({
      shopId: "shop_1",
      shippingDiscountCents: 800,
      shippingProtectionCents: 800,
    });
  });

  it("summarizes 30 day analytics", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.orderAnalytics.findMany.mockResolvedValue([
      orderAnalyticsRecord({
        freeShippingApplied: true,
        orderName: "#1001",
        shippingDiscountCents: 800,
        shippingProtectionCents: 400,
        shippingProtectionPurchased: true,
        totalCents: 5400,
      }),
      orderAnalyticsRecord({
        freeShippingApplied: false,
        orderName: "#1002",
        shippingDiscountCents: 0,
        shippingProtectionCents: 0,
        shippingProtectionPurchased: false,
        totalCents: 2600,
      }),
    ]);

    const summary = await analyticsSummaryForShopDomain(
      "test-shop.myshopify.com",
      30,
    );

    expect(summary).toMatchObject({
      averageOrderCents: 4000,
      freeShippingOrders: 1,
      freeShippingRate: 50,
      orderCount: 2,
      protectedOrders: 1,
      protectionRevenueCents: 400,
      shippingSavingsCents: 800,
    });
    expect(summary.recentOrders).toHaveLength(2);
    expect(mocks.db.orderAnalytics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { orderCreatedAt: "desc" },
        where: expect.objectContaining({ shopId: "shop_1" }),
      }),
    );
  });
});

function orderPayload() {
  return {
    admin_graphql_api_id: "gid://shopify/Order/1001",
    created_at: "2026-06-01T12:00:00.000Z",
    currency: "USD",
    line_items: [
      {
        price: "21.00",
        quantity: 2,
        title: "Long Sleeve",
      },
      {
        price: "4.00",
        properties: [
          { name: "_freeship_shipping_protection", value: "true" },
        ],
        quantity: 2,
        sku: "FREESHIP-RULES-SHIPPING-PROTECTION-400",
        title: "Shipping Protection",
      },
    ],
    name: "#1001",
    shipping_lines: [
      {
        discounted_price: "0.00",
        price: "8.00",
      },
    ],
    subtotal_price: "50.00",
    total_price: "54.00",
  };
}

function orderAnalyticsRecord(
  overrides: Partial<{
    freeShippingApplied: boolean;
    orderName: string;
    shippingDiscountCents: number;
    shippingProtectionCents: number;
    shippingProtectionPurchased: boolean;
    totalCents: number;
  }>,
) {
  return {
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    currencyCode: "USD",
    freeShippingApplied: false,
    id: "analytics_1",
    orderCreatedAt: new Date("2026-06-01T12:00:00.000Z"),
    orderName: "#1000",
    shippingDiscountCents: 0,
    shippingPriceCents: 0,
    shippingProtectionCents: 0,
    shippingProtectionPurchased: false,
    shopId: "shop_1",
    shopifyOrderId: "gid://shopify/Order/1000",
    subtotalCents: 0,
    totalCents: 0,
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    ...overrides,
  };
}
