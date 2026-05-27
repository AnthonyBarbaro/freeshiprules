import { beforeEach, describe, expect, it, vi } from "vitest";
import { lbToGrams, normalizeRuleInput } from "./rule-config";
import { createBillingSubscription } from "./billing.server";
import { ensureDeliveryDiscount } from "./discount.server";
import { saveRuleSet } from "./rules.server";
import { billingIsActive, markShopUninstalled } from "./shop.server";
import { storefrontProgressConfigFromRule } from "./progress-config.server";
import {
  computeShippingProtectionPriceCents,
  normalizeShippingProtectionInput,
  requiredProtectionVariantAmounts,
} from "./shipping-protection-config";
import {
  ensureShippingProtectionProduct,
  saveShippingProtectionSettings,
} from "./shipping-protection.server";

const mocks = vi.hoisted(() => {
  const db = {
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    ruleSet: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    shippingProtection: {
      create: vi.fn(),
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

  it("preserves Shopify sync metadata when saving settings", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.ruleSet.findFirst.mockResolvedValue({
      ...(ruleSet() as Record<string, unknown>),
      configJson: {
        automaticDiscountId: "gid://shopify/DiscountAutomaticNode/1",
        functionHandle: "freeship-rules-delivery-discount",
      },
    });
    mocks.db.ruleSet.update.mockResolvedValue({});

    await saveRuleSet("test-shop.myshopify.com", {
      offerName: "Updated Free Shipping",
    });

    expect(mocks.db.ruleSet.update.mock.calls[0][0].data.configJson).toMatchObject({
      automaticDiscountId: "gid://shopify/DiscountAutomaticNode/1",
      functionHandle: "freeship-rules-delivery-discount",
      offerName: "Updated Free Shipping",
    });
  });

  it("keeps storefront progress visible in test mode", () => {
    const rule = normalizeRuleInput({
      name: "No stacking free shipping",
      offerName: "Free Shipping",
    });

    expect(storefrontProgressConfigFromRule(rule.configJson).enabled).toBe(true);
  });

  it("hides storefront progress when the checkout rule is paused", () => {
    const rule = normalizeRuleInput({
      enabled: "false",
      progressBarEnabled: "true",
    });

    expect(storefrontProgressConfigFromRule(rule.configJson).enabled).toBe(false);
  });

  it("computes tiered shipping protection prices", () => {
    const config = normalizeShippingProtectionInput({
      enabled: "true",
      pricingMode: "TIERED",
      tierMin: ["0", "10", "30"],
      tierMax: ["10", "30", "60"],
      tierAmount: ["1", "3", "5"],
    });

    expect(computeShippingProtectionPriceCents(config, 900)).toBe(100);
    expect(computeShippingProtectionPriceCents(config, 1000)).toBe(300);
    expect(computeShippingProtectionPriceCents(config, 4500)).toBe(500);
  });

  it("computes formula shipping protection prices", () => {
    const config = normalizeShippingProtectionInput({
      enabled: "true",
      pricingMode: "FORMULA",
      formulaAmount: "1",
      formulaEvery: "10",
      formulaMinCharge: "1",
      formulaMaxCharge: "5",
    });

    expect(computeShippingProtectionPriceCents(config, 1)).toBe(100);
    expect(computeShippingProtectionPriceCents(config, 2500)).toBe(300);
    expect(computeShippingProtectionPriceCents(config, 9000)).toBe(500);
    expect(requiredProtectionVariantAmounts(config)).toEqual([
      100, 200, 300, 400, 500,
    ]);
  });

  it("saves shipping protection settings", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.shippingProtection.findUnique.mockResolvedValue(
      shippingProtectionSettings(),
    );
    mocks.db.shippingProtection.update.mockResolvedValue({});

    await saveShippingProtectionSettings("test-shop.myshopify.com", {
      enabled: "true",
      productTitle: "Package Protection",
      tierMin: ["0", "30"],
      tierMax: ["30", ""],
      tierAmount: ["2", "5"],
    });

    expect(mocks.db.shippingProtection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          productTitle: "Package Protection",
          tiersJson: [
            { minCents: 0, maxCents: 3000, amountCents: 200 },
            { minCents: 3000, maxCents: null, amountCents: 500 },
          ],
        }),
      }),
    );
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
          automaticDiscountNodes: {
            nodes: [],
          },
        },
      },
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

    const variables = admin.graphql.mock.calls[1][1].variables;
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

  it("recovers and updates an existing app discount with the same title", async () => {
    process.env.SHOPIFY_API_KEY = "app-key";
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
          automaticDiscountNodes: {
            nodes: [
              {
                id: "gid://shopify/DiscountAutomaticNode/1",
                automaticDiscount: {
                  __typename: "DiscountAutomaticApp",
                  discountId: "gid://shopify/DiscountAutomaticNode/1",
                  title: "Free Shipping",
                  status: "ACTIVE",
                  appDiscountType: {
                    appKey: "app-key",
                    functionId: "function-id",
                    title: "FreeShip Rules Delivery Discount",
                  },
                },
              },
            ],
          },
        },
      },
      {
        data: {
          discountAutomaticAppUpdate: {
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

    expect(admin.graphql.mock.calls[1][1].variables.id).toBe(
      "gid://shopify/DiscountAutomaticNode/1",
    );
  });

  it("creates a shipping protection product and variant prices", async () => {
    mocks.db.shop.findUnique.mockResolvedValue({ id: "shop_1" });
    mocks.db.shippingProtection.update.mockImplementation(async ({ data }) => ({
      ...(shippingProtectionSettings() as Record<string, unknown>),
      ...data,
    }));
    mocks.db.eventLog.create.mockResolvedValue({});

    const admin = mockAdmin([
      {
        data: {
          products: {
            nodes: [],
          },
        },
      },
      {
        data: {
          productCreate: {
            userErrors: [],
            product: productNode([]),
          },
        },
      },
      {
        data: {
          productVariantsBulkCreate: {
            userErrors: [],
            productVariants: variantNodes([100, 300, 500, 700]),
          },
        },
      },
      {
        data: {
          node: productNode(variantNodes([100, 300, 500, 700])),
        },
      },
      {
        data: {
          productVariantsBulkUpdate: {
            userErrors: [],
            productVariants: variantNodes([100, 300, 500, 700]),
          },
        },
      },
      {
        data: {
          productCreateMedia: {
            media: [
              {
                id: "gid://shopify/MediaImage/1",
                alt: "Shipping protection shield by FreeShip Rules",
                mediaContentType: "IMAGE",
                status: "UPLOADED",
              },
            ],
            mediaUserErrors: [],
          },
        },
      },
      {
        data: {
          publications: {
            nodes: [],
          },
        },
      },
    ]);

    await ensureShippingProtectionProduct(
      admin as never,
      "test-shop.myshopify.com",
      shippingProtectionSettings({ enabled: true }) as never,
    );

    expect(admin.graphql.mock.calls[1][1].variables.product).toMatchObject({
      title: "Shipping Protection",
      status: "ACTIVE",
      tags: ["freeship-rules-shipping-protection"],
    });
    expect(admin.graphql.mock.calls[2][1].variables.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          price: "1.00",
          taxable: false,
          inventoryItem: {
            tracked: false,
            requiresShipping: false,
          },
        }),
      ]),
    );
    expect(admin.graphql.mock.calls[5][1].variables.media).toEqual([
      expect.objectContaining({
        alt: "Shipping protection shield by FreeShip Rules",
        mediaContentType: "IMAGE",
        originalSource:
          "https://freeship-rules.example/shipping-protection.png?v=1",
      }),
    ]);
    expect(mocks.db.shippingProtection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "gid://shopify/Product/1",
          syncError: null,
        }),
      }),
    );
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

function shippingProtectionSettings(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "protection_1",
    shopId: "shop_1",
    enabled: false,
    pricingMode: "TIERED",
    productTitle: "Shipping Protection",
    widgetHeading: "Shipping protection",
    widgetDescription: "Protect your order from loss, damage, or theft.",
    optInLabel: "Add shipping protection",
    defaultSelected: false,
    tiersJson: [
      { minCents: 0, maxCents: 1000, amountCents: 100 },
      { minCents: 1000, maxCents: 3000, amountCents: 300 },
      { minCents: 3000, maxCents: 6000, amountCents: 500 },
      { minCents: 6000, maxCents: null, amountCents: 700 },
    ],
    formulaJson: {
      amountCents: 100,
      everyCents: 1000,
      minChargeCents: 100,
      maxChargeCents: 1500,
    },
    productId: null,
    variantMapJson: {},
    syncError: null,
    syncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never as Record<string, unknown>;
}

function productNode(
  variants: Array<Record<string, unknown>>,
  media: Array<Record<string, unknown>> = [],
) {
  return {
    id: "gid://shopify/Product/1",
    title: "Shipping Protection",
    handle: "shipping-protection",
    status: "ACTIVE",
    media: {
      nodes: media,
    },
    variants: {
      nodes: variants,
    },
  };
}

function variantNodes(amounts: number[]) {
  return amounts.map((amount) => ({
    id: `gid://shopify/ProductVariant/${amount}`,
    legacyResourceId: String(amount),
    title: `$${(amount / 100).toFixed(2)}`,
    price: (amount / 100).toFixed(2),
    selectedOptions: [{ name: "Title", value: `$${(amount / 100).toFixed(2)}` }],
  }));
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
