import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/webhooks.orders-create";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  recordOrderAnalyticsFromWebhook: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: mocks.authenticateWebhook,
  },
}));

vi.mock("../services/analytics.server", () => ({
  recordOrderAnalyticsFromWebhook: mocks.recordOrderAnalyticsFromWebhook,
}));

describe("ORDERS_CREATE webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateWebhook.mockResolvedValue({
      payload: { admin_graphql_api_id: "gid://shopify/Order/1001" },
      shop: "test-shop.myshopify.com",
    });
  });

  it("records order analytics from the webhook payload", async () => {
    const response = await action({
      request: new Request("https://app.example/webhooks/orders-create", {
        method: "POST",
      }),
      params: {},
      context: {},
    } as never);

    expect(response.status).toBe(200);
    expect(mocks.recordOrderAnalyticsFromWebhook).toHaveBeenCalledWith(
      "test-shop.myshopify.com",
      { admin_graphql_api_id: "gid://shopify/Order/1001" },
    );
  });
});
