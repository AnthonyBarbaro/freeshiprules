import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader as appLoader } from "../routes/app";
import { loader as rootLoader } from "../routes/_index/route";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  prepareInstalledShop: vi.fn(),
  suspendDeliveryDiscount: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: mocks.authenticateAdmin,
  },
  login: vi.fn(),
  normalizeShop: (value: string | null | undefined) =>
    value ? `${value.replace(/\.myshopify\.com$/, "")}.myshopify.com` : null,
}));

vi.mock("../services/app-installation.server", () => ({
  prepareInstalledShop: mocks.prepareInstalledShop,
}));

vi.mock("../services/discount.server", () => ({
  suspendDeliveryDiscount: mocks.suspendDeliveryDiscount,
}));

vi.mock("../services/shop.server", () => ({
  billingIsActive: (status: string) => status === "ACTIVE",
}));

describe("auth entry redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({
      admin: {},
      session: { shop: "test-shop.myshopify.com" },
    });
    mocks.prepareInstalledShop.mockResolvedValue({
      shop: { billingStatus: "ACTIVE" },
      ruleSet: {},
    });
  });

  it("sends root shop links to Shopify login instead of /app", async () => {
    const response = await catchRedirect(
      rootLoader({
        request: new Request("https://app.example/?shop=test-shop"),
        params: {},
        context: {},
      } as never),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/auth/login?shop=test-shop.myshopify.com",
    );
  });

  it("sends bare app shop links to Shopify login before admin auth", async () => {
    const response = await catchRedirect(
      appLoader({
        request: new Request("https://app.example/app?shop=test-shop"),
        params: {},
        context: {},
      } as never),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/auth/login?shop=test-shop.myshopify.com",
    );
    expect(mocks.authenticateAdmin).not.toHaveBeenCalled();
  });

  it("keeps embedded app requests on the normal admin auth path", async () => {
    const data = await appLoader({
      request: new Request(
        "https://app.example/app?shop=test-shop.myshopify.com&host=abc",
      ),
      params: {},
      context: {},
    } as never);

    expect(data).toMatchObject({
      shopDomain: "test-shop.myshopify.com",
      billingStatus: "ACTIVE",
    });
    expect(mocks.authenticateAdmin).toHaveBeenCalled();
  });
});

async function catchRedirect(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("Expected a redirect response.");
  } catch (error) {
    return error as Response;
  }
}
