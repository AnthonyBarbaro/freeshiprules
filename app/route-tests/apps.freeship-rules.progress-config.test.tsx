import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "../routes/apps.freeship-rules.progress-config";

const mocks = vi.hoisted(() => ({
  appProxy: vi.fn(),
  getRuleSetForShopDomain: vi.fn(),
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

vi.mock("../services/rules.server", () => ({
  functionConfigFromRuleSet: (ruleSet: {
    configJson: Record<string, unknown>;
  }) => ruleSet.configJson,
  getRuleSetForShopDomain: mocks.getRuleSetForShopDomain,
}));

vi.mock("../services/progress-config.server", () => ({
  storefrontProgressConfigFromRule: (config: Record<string, unknown>) => ({
    enabled: Boolean(config.enabled),
    goalCents: 40000,
  }),
}));

vi.mock("../services/shipping-protection.server", () => ({
  getShippingProtectionForShopDomain: mocks.getShippingProtectionForShopDomain,
  shippingProtectionVariantMapFromRecord: () => ({}),
}));

vi.mock("../services/shop.server", () => ({
  billingIsActive: (status: string) => status === "ACTIVE",
}));

describe("progress app proxy config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appProxy.mockResolvedValue({
      session: { shop: "test-shop.myshopify.com" },
    });
    mocks.getShippingProtectionForShopDomain.mockResolvedValue(null);
  });

  it("returns disabled config when billing is inactive", async () => {
    mocks.getRuleSetForShopDomain.mockResolvedValue(record("INACTIVE"));

    const response = await load();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false });
  });

  it("returns disabled config with 200 when setup has not created a shop record yet", async () => {
    mocks.getRuleSetForShopDomain.mockResolvedValue(null);

    const response = await load();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false });
  });

  it("returns disabled config with 200 when app proxy authentication fails", async () => {
    mocks.appProxy.mockRejectedValue(new Response(null, { status: 400 }));

    const response = await load();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false });
    expect(mocks.getRuleSetForShopDomain).not.toHaveBeenCalled();
  });

  it("returns enabled config when billing is active", async () => {
    mocks.getRuleSetForShopDomain.mockResolvedValue(record("ACTIVE"));

    const response = await load();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      goalCents: 40000,
      protectionVariantIds: [],
    });
  });

  it("sets Cache-Control no-store", async () => {
    mocks.getRuleSetForShopDomain.mockResolvedValue(record("ACTIVE"));

    const response = await load();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

function load() {
  return loader({
    request: new Request(
      "https://test-shop.myshopify.com/apps/freeship-rules/progress-config?shop=test-shop.myshopify.com",
    ),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

function record(billingStatus: string) {
  return {
    shop: { billingStatus },
    ruleSet: {
      configJson: { enabled: true },
    },
  };
}
