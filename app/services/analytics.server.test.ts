import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsSummaryForShopDomain,
  orderMetricsFromPayload,
  recordOrderAnalyticsFromWebhook,
  syncRecentOrderAnalyticsFromShopify,
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
    vi.unstubAllGlobals();
  });

  it("extracts free shipping and protection metrics from order webhook payload", () => {
    const metrics = orderMetricsFromPayload(orderPayload());

    expect(metrics).toMatchObject({
      shopifyOrderId: "gid://shopify/Order/1001",
      orderName: "#1001",
      currencyCode: "USD",
      subtotalCents: 5000,
      totalCents: 5400,
      discountCents: 500,
      taxCents: 400,
      shippingPriceCents: 800,
      shippingDiscountCents: 800,
      paidShippingCents: 0,
      freeShippingApplied: true,
      itemQuantity: 2,
      shippingProtectionCents: 800,
      shippingProtectionPurchased: true,
      shippingCity: "El Cajon",
      shippingCountry: "US",
      shippingMethod: "UPS Ground Saver",
      shippingProvince: "CA",
      sourceName: "web",
      uniqueProductCount: 1,
    });
    expect(metrics?.discountCodesJson).toEqual([
      { amountCents: 500, code: "VIP", type: "fixed_amount" },
    ]);
    expect(metrics?.lineItemsJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isProtection: false,
          quantity: 2,
          revenueCents: 4200,
          title: "Long Sleeve",
        }),
      ]),
    );
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
      discountCents: 500,
      itemQuantity: 2,
      shopId: "shop_1",
      sourceName: "web",
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
        discountCents: 500,
        itemQuantity: 3,
        lineItemsJson: [
          {
            isProtection: false,
            quantity: 2,
            revenueCents: 4200,
            sku: "LS-1",
            title: "Long Sleeve",
          },
          {
            isProtection: false,
            quantity: 1,
            revenueCents: 800,
            sku: "HAT-1",
            title: "Hat",
          },
        ],
        paidShippingCents: 0,
        shippingCity: "El Cajon",
        shippingCountry: "US",
        shippingDiscountCents: 800,
        shippingMethod: "UPS Ground Saver",
        shippingProvince: "CA",
        shippingProtectionCents: 400,
        shippingProtectionPurchased: true,
        sourceName: "web",
        subtotalCents: 6000,
        taxCents: 500,
        totalCents: 5400,
      }),
      orderAnalyticsRecord({
        freeShippingApplied: false,
        orderName: "#1002",
        discountCodesJson: [{ amountCents: 300, code: "WELCOME" }],
        discountCents: 300,
        itemQuantity: 1,
        lineItemsJson: [
          {
            isProtection: false,
            quantity: 1,
            revenueCents: 2600,
            sku: "GLASS-1",
            title: "Glassware",
          },
        ],
        paidShippingCents: 700,
        shippingCity: "San Diego",
        shippingCountry: "US",
        shippingDiscountCents: 0,
        shippingMethod: "UPS Ground",
        shippingProvince: "CA",
        shippingProtectionCents: 0,
        shippingProtectionPurchased: false,
        sourceName: "pos",
        subtotalCents: 2900,
        taxCents: 200,
        totalCents: 2600,
      }),
    ]);

    const summary = await analyticsSummaryForShopDomain(
      "test-shop.myshopify.com",
      30,
    );

    expect(summary).toMatchObject({
      averageOrderCents: 4000,
      discountCents: 800,
      discountRate: 9,
      freeShippingOrders: 1,
      freeShippingRate: 50,
      grossSalesCents: 8900,
      itemQuantity: 4,
      netSalesCents: 8100,
      orderCount: 2,
      paidShippingCents: 700,
      protectedOrders: 1,
      protectionRate: 50,
      protectionRevenueCents: 400,
      shippingSavingsCents: 800,
      taxCents: 700,
    });
    expect(summary.topProducts[0]).toMatchObject({
      count: 2,
      label: "Long Sleeve",
    });
    expect(summary.topDiscountCodes[0]).toMatchObject({
      amountCents: 300,
      label: "WELCOME",
    });
    expect(summary.topShippingMethods).toEqual([
      expect.objectContaining({ label: "UPS Ground", amountCents: 700 }),
      expect.objectContaining({ label: "UPS Ground Saver", amountCents: 0 }),
    ]);
    expect(summary.topLocations[0]).toMatchObject({
      label: "El Cajon, CA, US",
    });
    expect(summary.sourceChannels).toEqual([
      expect.objectContaining({ label: "Online store", amountCents: 5400 }),
      expect.objectContaining({ label: "Point of sale", amountCents: 2600 }),
    ]);
    expect(summary.recentOrders).toHaveLength(2);
    expect(mocks.db.orderAnalytics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { orderCreatedAt: "desc" },
        where: expect.objectContaining({ shopId: "shop_1" }),
      }),
    );
  });

  it("syncs recent Shopify orders into analytics", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.orderAnalytics.upsert.mockImplementation(async (args) => args.create);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ orders: [orderPayload()] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }),
    );

    const result = await syncRecentOrderAnalyticsFromShopify({
      accessToken: "token",
      days: 30,
      shopDomain: "test-shop.myshopify.com",
    });

    expect(result).toEqual({ scanned: 1, synced: 1 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/api/2026-04/orders.json"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "token",
        }),
      }),
    );
  });
});

function orderPayload() {
  return {
    admin_graphql_api_id: "gid://shopify/Order/1001",
    created_at: "2026-06-01T12:00:00.000Z",
    currency: "USD",
    customer: {
      admin_graphql_api_id: "gid://shopify/Customer/1",
      orders_count: 3,
    },
    discount_codes: [
      {
        amount: "5.00",
        code: "VIP",
        type: "fixed_amount",
      },
    ],
    financial_status: "paid",
    line_items: [
      {
        grams: 454,
        price: "21.00",
        product_id: 10,
        product_type: "Apparel",
        quantity: 2,
        sku: "LS-1",
        title: "Long Sleeve",
        total_discount: "0.00",
        variant_id: 20,
        vendor: "Barbaro",
      },
      {
        grams: 0,
        price: "4.00",
        properties: [
          { name: "_freeship_shipping_protection", value: "true" },
        ],
        quantity: 2,
        sku: "FREESHIP-RULES-SHIPPING-PROTECTION-400",
        title: "Shipping Protection",
        total_discount: "0.00",
      },
    ],
    name: "#1001",
    payment_gateway_names: ["shopify_payments"],
    shipping_address: {
      city: "El Cajon",
      country_code: "US",
      province_code: "CA",
    },
    shipping_lines: [
      {
        code: "GROUND",
        discounted_price: "0.00",
        price: "8.00",
        source: "shopify",
        title: "UPS Ground Saver",
      },
    ],
    source_name: "web",
    subtotal_price: "50.00",
    tags: "vip, wholesale",
    total_discounts: "5.00",
    total_price: "54.00",
    total_tax: "4.00",
  };
}

function orderAnalyticsRecord(
  overrides: Partial<{
    freeShippingApplied: boolean;
    orderName: string;
    discountCents: number;
    discountCodesJson: unknown[];
    shippingDiscountCents: number;
    itemQuantity: number;
    lineItemsJson: unknown[];
    paidShippingCents: number;
    shippingCity: string;
    shippingCountry: string;
    shippingMethod: string;
    shippingProvince: string;
    shippingProtectionCents: number;
    shippingProtectionPurchased: boolean;
    sourceName: string;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
  }>,
) {
  return {
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    currencyCode: "USD",
    customerId: null,
    customerOrderCount: null,
    discountCents: 0,
    discountCodesJson: [],
    freeShippingApplied: false,
    financialStatus: "paid",
    fulfillmentStatus: null,
    id: "analytics_1",
    itemQuantity: 0,
    lineItemsJson: [],
    orderCreatedAt: new Date("2026-06-01T12:00:00.000Z"),
    orderName: "#1000",
    paidShippingCents: 0,
    paymentGatewayNamesJson: [],
    shippingCity: null,
    shippingCountry: null,
    shippingDiscountCents: 0,
    shippingLinesJson: [],
    shippingMethod: null,
    shippingPriceCents: 0,
    shippingProtectionCents: 0,
    shippingProtectionPurchased: false,
    shippingProvince: null,
    shopId: "shop_1",
    shopifyOrderId: "gid://shopify/Order/1000",
    sourceName: null,
    subtotalCents: 0,
    tagsJson: [],
    taxCents: 0,
    totalCents: 0,
    totalWeightGrams: 0,
    uniqueProductCount: 0,
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    ...overrides,
  };
}
