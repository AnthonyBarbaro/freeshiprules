import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/webhooks.app-subscriptions-update";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  adminContextForShopDomain: vi.fn(),
  updateBillingFromWebhook: vi.fn(),
  ensureDeliveryDiscount: vi.fn(),
  suspendDeliveryDiscount: vi.fn(),
  getRuleSetForShopDomain: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  adminContextForShopDomain: mocks.adminContextForShopDomain,
  authenticate: {
    webhook: mocks.authenticateWebhook,
  },
}));

vi.mock("../services/billing.server", () => ({
  updateBillingFromWebhook: mocks.updateBillingFromWebhook,
}));

vi.mock("../services/discount.server", () => ({
  ensureDeliveryDiscount: mocks.ensureDeliveryDiscount,
  suspendDeliveryDiscount: mocks.suspendDeliveryDiscount,
}));

vi.mock("../services/rules.server", () => ({
  getRuleSetForShopDomain: mocks.getRuleSetForShopDomain,
}));

vi.mock("../services/shop.server", () => ({
  billingIsActive: (status: string) => status === "ACTIVE",
}));

describe("APP_SUBSCRIPTIONS_UPDATE webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "test-shop.myshopify.com",
      payload: { status: "CANCELLED" },
    });
    mocks.adminContextForShopDomain.mockResolvedValue({});
    mocks.getRuleSetForShopDomain.mockResolvedValue({
      ruleSet: { id: "rule_1" },
    });
  });

  it("suspends paid features when billing becomes inactive", async () => {
    mocks.updateBillingFromWebhook.mockResolvedValue({
      billingStatus: "CANCELLED",
    });

    const response = await run();

    expect(response.status).toBe(200);
    expect(mocks.suspendDeliveryDiscount).toHaveBeenCalledWith(
      {},
      "test-shop.myshopify.com",
      { id: "rule_1" },
    );
    expect(mocks.ensureDeliveryDiscount).not.toHaveBeenCalled();
  });

  it("resyncs paid features when billing becomes active", async () => {
    mocks.updateBillingFromWebhook.mockResolvedValue({
      billingStatus: "ACTIVE",
    });

    const response = await run();

    expect(response.status).toBe(200);
    expect(mocks.ensureDeliveryDiscount).toHaveBeenCalledWith(
      {},
      "test-shop.myshopify.com",
      { id: "rule_1" },
    );
    expect(mocks.suspendDeliveryDiscount).not.toHaveBeenCalled();
  });

  it("does not fail the webhook if remote suspension fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.updateBillingFromWebhook.mockResolvedValue({
      billingStatus: "CANCELLED",
    });
    mocks.suspendDeliveryDiscount.mockRejectedValue(new Error("Shopify down"));

    const response = await run();

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

function run() {
  return action({
    request: new Request("https://app.example/webhooks/app-subscriptions-update", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as never);
}
