import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/webhooks.app.uninstalled";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  markShopUninstalled: vi.fn(),
  sessionDeleteMany: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    webhook: mocks.authenticateWebhook,
  },
}));

vi.mock("../db.server", () => ({
  default: {
    session: {
      deleteMany: mocks.sessionDeleteMany,
    },
  },
}));

vi.mock("../services/shop.server", () => ({
  markShopUninstalled: mocks.markShopUninstalled,
}));

describe("APP_UNINSTALLED webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "test-shop.myshopify.com",
      session: { id: "offline_test-shop.myshopify.com" },
      topic: "APP_UNINSTALLED",
    });
    mocks.sessionDeleteMany.mockResolvedValue({ count: 1 });
    mocks.markShopUninstalled.mockResolvedValue({ count: 1 });
  });

  it("cleans up local shop records and acknowledges uninstall", async () => {
    const response = await run();

    expect(response.status).toBe(200);
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { shop: "test-shop.myshopify.com" },
    });
    expect(mocks.markShopUninstalled).toHaveBeenCalledWith(
      "test-shop.myshopify.com",
    );
  });

  it("acknowledges repeated uninstall webhooks when the session is gone", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "test-shop.myshopify.com",
      session: undefined,
      topic: "APP_UNINSTALLED",
    });

    const response = await run();

    expect(response.status).toBe(200);
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();
    expect(mocks.markShopUninstalled).toHaveBeenCalledWith(
      "test-shop.myshopify.com",
    );
  });

  it("acknowledges valid uninstall webhooks even when cleanup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.sessionDeleteMany.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await run();

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Uninstall cleanup skipped"),
    );
    warn.mockRestore();
  });
});

function run() {
  return action({
    request: new Request("https://app.example/webhooks/app-uninstalled", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as never);
}
