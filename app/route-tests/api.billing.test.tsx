import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/api.billing";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  billingDisabled: vi.fn(),
  createBillingSubscription: vi.fn(),
  shopifyAppPricingEnabled: vi.fn(),
  shopifyAppPricingUrl: vi.fn(),
  shopifyRedirect: vi.fn(),
  syncBillingCheckStatus: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: mocks.authenticateAdmin,
  },
}));

vi.mock("../services/billing.server", () => ({
  createBillingSubscription: mocks.createBillingSubscription,
  syncBillingCheckStatus: mocks.syncBillingCheckStatus,
}));

vi.mock("../services/billing-config.server", () => ({
  billingDisabled: mocks.billingDisabled,
  shopifyAppPricingEnabled: mocks.shopifyAppPricingEnabled,
  shopifyAppPricingUrl: mocks.shopifyAppPricingUrl,
}));

vi.mock("../services/shop.server", () => ({
  billingBypassEnabled: () => false,
  billingIsActive: (status: string) => status === "ACTIVE",
}));

describe("/api/billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shopifyRedirect.mockImplementation(
      (url: string) =>
        new Response(null, {
          status: 302,
          headers: { Location: url },
        }),
    );
    mocks.authenticateAdmin.mockResolvedValue({
      admin: {},
      billing: {},
      redirect: mocks.shopifyRedirect,
      session: { shop: "test-shop.myshopify.com" },
    });
    mocks.billingDisabled.mockReturnValue(false);
    mocks.shopifyAppPricingEnabled.mockReturnValue(true);
    mocks.shopifyAppPricingUrl.mockReturnValue(
      "https://admin.shopify.com/store/test-shop/charges/freeship-rules/pricing_plans",
    );
    mocks.syncBillingCheckStatus.mockResolvedValue({
      billingStatus: "INACTIVE",
    });
  });

  it("redirects unpaid stores to Shopify App Pricing", async () => {
    const response = await run();

    expect(response.headers.get("Location")).toBe(
      "https://admin.shopify.com/store/test-shop/charges/freeship-rules/pricing_plans",
    );
    expect(mocks.shopifyRedirect).toHaveBeenCalledWith(
      "https://admin.shopify.com/store/test-shop/charges/freeship-rules/pricing_plans",
      { target: "_top" },
    );
    expect(mocks.createBillingSubscription).not.toHaveBeenCalled();
  });

  it("skips plan selection when Shopify App Pricing is already active", async () => {
    mocks.syncBillingCheckStatus.mockResolvedValue({
      billingStatus: "ACTIVE",
    });

    const response = await run();

    expect(response.headers.get("Location")).toBe(
      "/app/settings?billing=active",
    );
    expect(mocks.shopifyRedirect).toHaveBeenCalledWith(
      "/app/settings?billing=active",
    );
  });

  it("skips plan selection when billing is disabled", async () => {
    mocks.billingDisabled.mockReturnValue(true);

    const response = await run();

    expect(response.headers.get("Location")).toBe(
      "/app/settings?billing=disabled",
    );
    expect(mocks.shopifyRedirect).toHaveBeenCalledWith(
      "/app/settings?billing=disabled",
    );
    expect(mocks.syncBillingCheckStatus).not.toHaveBeenCalled();
    expect(mocks.createBillingSubscription).not.toHaveBeenCalled();
  });

  it("uses Billing API when Manual pricing mode is enabled", async () => {
    mocks.shopifyAppPricingEnabled.mockReturnValue(false);
    mocks.createBillingSubscription.mockResolvedValue({
      confirmationUrl: "https://shopify.example/confirm",
    });

    const response = await run();

    expect(response.headers.get("Location")).toBe(
      "https://shopify.example/confirm",
    );
    expect(mocks.createBillingSubscription).toHaveBeenCalledWith(
      {},
      "test-shop.myshopify.com",
    );
    expect(mocks.shopifyRedirect).toHaveBeenCalledWith(
      "https://shopify.example/confirm",
      { target: "_top" },
    );
  });
});

function run() {
  return action({
    request: new Request("https://app.example/api/billing", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as never);
}
