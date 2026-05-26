import { beforeEach, describe, expect, it, vi } from "vitest";
import { lbToGrams, normalizeRuleInput } from "./rule-config";
import { createBillingSubscription } from "./billing.server";
import { ensureDeliveryDiscount } from "./discount.server";
import { billingIsActive, markShopUninstalled } from "./shop.server";
import { storefrontProgressConfigFromRule } from "./progress-config.server";

const mocks = vi.hoisted(() => {
  const db = {
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    ruleSet: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    eventLog: {
      create: vi.fn(),
    },
  };
  return { db };
});

vi.mock("../db.server", () => ({ default: mocks.db }));

describe("backend rule and billing services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_APP_URL = "https://freeship-rules.example";
    process.env.MONTHLY_PRICE = "10";
    process.env.TRIAL_DAYS = "7";
    process.env.SHOPIFY_BILLING_TEST = "true";
    process.env.SHOPIFY_BILLING_BYPASS = "false";
  });

  it("saves rules by normalizing merchant input", () => {
    const rule = normalizeRuleInput({
      enabled: "true",
      minSubtotal: "400",
      maxWeight: "30",
      weightUnit: "lb",
      maxQuantity: "6",
      excludedTitleTerms: "Next Day, Overnight, Express, Air",
    });

    expect(rule.enabled).toBe(true);
    expect(rule.minSubtotalCents).toBe(40000);
    expect(rule.maxWeightGrams).toBe(13608);
    expect(rule.maxQuantity).toBe(6);
  });

  it("can disable individual cart limit rules", () => {
    const rule = normalizeRuleInput({
      minSubtotalEnabled: "false",
      maxWeightEnabled: "false",
      maxQuantityEnabled: "false",
    });

    expect(rule.configJson.minSubtotalEnabled).toBe(false);
    expect(rule.configJson.maxWeightEnabled).toBe(false);
    expect(rule.configJson.maxQuantityEnabled).toBe(false);
  });

  it("enables test mode by default", () => {
    const rule = normalizeRuleInput({});

    expect(rule.configJson.testMode).toBe(true);
  });

  it("builds storefront progress config from saved app settings", () => {
    const rule = normalizeRuleInput({
      name: "freeship",
      minSubtotal: "500",
      maxWeight: "40",
      maxQuantity: "10",
      progressHeading: "Almost there",
      progressAwayTemplate: "Spend [amount] more",
      progressQualifiedMessage: "You got free shipping",
      progressWeightMessage: "Stay under [weight] lb",
      progressQuantityMessage: "Up to [quantity] bottles",
    });

    expect(storefrontProgressConfigFromRule(rule.configJson)).toMatchObject({
      enabled: true,
      heading: "Almost there",
      goalCents: 50000,
      maxWeightPounds: 40,
      maxQuantity: 10,
      messages: {
        awayTemplate: "Spend [amount] more",
        qualified: "You got free shipping",
        weight: "Stay under [weight] lb",
        quantity: "Up to [quantity] bottles",
      },
    });
  });

  it("hides the storefront progress widget when test mode name is not freeship", () => {
    const rule = normalizeRuleInput({
      name: "No stacking free shipping",
      offerName: "Free Shipping",
    });

    expect(storefrontProgressConfigFromRule(rule.configJson).enabled).toBe(false);
  });

  it("converts lb to grams correctly", () => {
    expect(lbToGrams(30)).toBe(13608);
  });

  it("writes metafield config when creating the Shopify discount", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.ruleSet.findUnique.mockResolvedValue({ configJson: {} });
    mocks.db.ruleSet.update.mockImplementation(async ({ data }) => ({
      ...(ruleSet() as Record<string, unknown>),
      configJson: data.configJson,
    }));
    mocks.db.eventLog.create.mockResolvedValue({});

    const admin = mockAdmin([
      {
        data: {
          discountAutomaticAppCreate: {
            userErrors: [],
            automaticAppDiscount: {
              discountId: "gid://shopify/DiscountAutomaticNode/1",
              title: "Free Shipping",
              status: "ACTIVE",
              appDiscountType: { functionId: "function-id" },
            },
          },
        },
      },
    ]);

    await ensureDeliveryDiscount(
      admin as never,
      "test-shop.myshopify.com",
      ruleSet() as never,
    );

    const variables = admin.graphql.mock.calls[0][1].variables;
    const discount = variables.automaticAppDiscount;
    expect(discount.functionHandle).toBe("freeship-rules-delivery-discount");
    expect(discount.combinesWith).toEqual({
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    });
    expect(discount.metafields[0]).toMatchObject({
      namespace: "$app:freeship-rules",
      key: "configuration",
      type: "json",
    });
    expect(JSON.parse(discount.metafields[0].value)).toMatchObject({
      enabled: true,
      name: "No stacking free shipping",
      testMode: true,
      minSubtotalCents: 40000,
      maxWeightGrams: 13608,
      maxQuantity: 6,
    });
  });

  it("blocks unpaid stores", () => {
    expect(billingIsActive("INACTIVE")).toBe(false);
    expect(billingIsActive("ACTIVE")).toBe(true);
  });

  it("unlocks billing for local bypass testing", () => {
    process.env.SHOPIFY_BILLING_BYPASS = "true";

    expect(billingIsActive("INACTIVE")).toBe(true);
  });

  it("creates billing subscription", async () => {
    mocks.db.shop.upsert.mockResolvedValue({});
    const admin = mockAdmin([
      {
        data: {
          appSubscriptionCreate: {
            userErrors: [],
            confirmationUrl: "https://shopify.example/confirm",
            appSubscription: { id: "gid://shopify/AppSubscription/1" },
          },
        },
      },
    ]);

    const subscription = await createBillingSubscription(
      admin as never,
      "test-shop.myshopify.com",
    );

    expect(subscription.confirmationUrl).toBe(
      "https://shopify.example/confirm",
    );
    expect(admin.graphql.mock.calls[0][1].variables).toMatchObject({
      name: "FreeShip Rules Monthly",
      trialDays: 7,
      test: true,
    });
    expect(mocks.db.shop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopDomain: "test-shop.myshopify.com" },
        create: expect.objectContaining({ billingStatus: "PENDING" }),
        update: expect.objectContaining({ billingStatus: "PENDING" }),
      }),
    );
  });

  it("handles uninstall webhook cleanup", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.shop.update.mockResolvedValue({});

    await markShopUninstalled("test-shop.myshopify.com");

    expect(mocks.db.shop.update).toHaveBeenCalledWith({
      where: { shopDomain: "test-shop.myshopify.com" },
      data: {
        uninstalledAt: expect.any(Date),
        billingStatus: "CANCELLED",
        accessTokenEncrypted: null,
      },
    });
  });
});

function ruleSet() {
  return {
    id: "rule_1",
    shopId: "shop_1",
    enabled: true,
    name: "No stacking free shipping",
    minSubtotalCents: 40000,
    maxWeightGrams: 13608,
    maxQuantity: 6,
    blockDiscountCodes: true,
    blockOrderDiscounts: true,
    blockProductDiscounts: true,
    blockShippingDiscounts: true,
    applyMode: "CHEAPEST_ELIGIBLE",
    shippingTitleMatchType: "NONE",
    shippingTitleMatchValue: null,
    excludedTitleTerms: ["Next Day", "Overnight", "Express", "Air"],
    configJson: {
      enabled: true,
      name: "No stacking free shipping",
      offerName: "Free Shipping",
      message: "Free Shipping",
      testMode: true,
      minSubtotalCents: 40000,
      currencyCode: "USD",
      maxWeightGrams: 13608,
      maxQuantity: 6,
      blockDiscountCodes: true,
      blockOrderDiscounts: true,
      blockProductDiscounts: true,
      blockShippingDiscounts: true,
      applyMode: "CHEAPEST_ELIGIBLE",
      shippingTitleMatchType: "NONE",
      shippingTitleMatchValue: "",
      excludedTitleTerms: ["Next Day", "Overnight", "Express", "Air"],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never as Record<string, unknown>;
}

function mockAdmin(responses: Array<Record<string, unknown>>) {
  return {
    graphql: vi.fn(async () => {
      const response = responses.shift();
      return new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      });
    }),
  } as { graphql: ReturnType<typeof vi.fn> };
}
