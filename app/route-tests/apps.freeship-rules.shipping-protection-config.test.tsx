import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "../routes/apps.freeship-rules.shipping-protection-config";

const mocks = vi.hoisted(() => ({
  appProxy: vi.fn(),
  getShippingProtectionForShopDomain: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: mocks.appProxy,
    },
  },
  normalizeShop: (value: string | null | undefined) =>
    value ? "test-shop.myshopify.com" : null,
}));

vi.mock("../services/shipping-protection.server", () => ({
  getShippingProtectionForShopDomain: mocks.getShippingProtectionForShopDomain,
  storefrontShippingProtectionConfigFromRecord: () => ({
    enabled: true,
    setupRequired: false,
    variantMap: {
      "100": {
        variantId: "gid://shopify/ProductVariant/1",
        legacyVariantId: "1",
        priceCents: 100,
      },
    },
  }),
}));

vi.mock("../services/shop.server", () => ({
  billingIsActive: (status: string) => status === "ACTIVE",
}));

describe("shipping protection app proxy config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appProxy.mockResolvedValue({
      session: { shop: "test-shop.myshopify.com" },
    });
  });

  it("returns disabled setupRequired config when billing is inactive", async () => {
    mocks.getShippingProtectionForShopDomain.mockResolvedValue(
      record("INACTIVE"),
    );

    const response = await load();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      setupRequired: true,
    });
  });

  it("returns enabled config when billing is active and variants exist", async () => {
    mocks.getShippingProtectionForShopDomain.mockResolvedValue(record("ACTIVE"));

    const response = await load();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      setupRequired: false,
      variantMap: {
        "100": expect.objectContaining({ legacyVariantId: "1" }),
      },
    });
  });

  it("sets Cache-Control no-store", async () => {
    mocks.getShippingProtectionForShopDomain.mockResolvedValue(record("ACTIVE"));

    const response = await load();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

function load() {
  return loader({
    request: new Request(
      "https://test-shop.myshopify.com/apps/freeship-rules/shipping-protection-config?shop=test-shop.myshopify.com",
    ),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

function record(billingStatus: string) {
  return {
    shop: { billingStatus },
    shippingProtection: {
      enabled: true,
      variantMapJson: {},
    },
  };
}
