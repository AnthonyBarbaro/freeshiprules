import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "../routes/app.install-check";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  ensureDeliveryDiscount: vi.fn(),
  verifyFunctionAndDiscount: vi.fn(),
  prepareInstalledShop: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: mocks.authenticateAdmin,
  },
}));

vi.mock("../services/discount.server", () => ({
  ensureDeliveryDiscount: mocks.ensureDeliveryDiscount,
  verifyFunctionAndDiscount: mocks.verifyFunctionAndDiscount,
}));

vi.mock("../services/app-installation.server", () => ({
  prepareInstalledShop: mocks.prepareInstalledShop,
}));

vi.mock("../services/shop.server", () => ({
  billingDisplayStatus: (status: string) => status,
  billingIsActive: (status: string) => status === "ACTIVE",
}));

describe("/app/install-check loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({
      admin: {},
      session: { shop: "test-shop.myshopify.com" },
    });
    mocks.prepareInstalledShop.mockResolvedValue({
      shop: { billingStatus: "INACTIVE" },
      ruleSet: {
        id: "rule_1",
        enabled: true,
        configJson: { enabled: true },
      },
    });
    mocks.verifyFunctionAndDiscount.mockResolvedValue({
      functionFound: true,
      function: null,
      functionHandle: "freeship-rules-delivery-discount",
      functions: [],
      automaticDiscountId: "gid://shopify/DiscountAutomaticNode/1",
      config: { enabled: true },
    });
  });

  it("does not resync or re-enable the Shopify automatic app discount when billingStatus is inactive even if RuleSet.enabled is true", async () => {
    const data = await loader({
      request: new Request("https://app.example/app/install-check"),
      params: {},
      context: {},
    } as never);

    expect(mocks.prepareInstalledShop).toHaveBeenCalledWith({
      admin: {},
      session: { shop: "test-shop.myshopify.com" },
      syncDiscount: false,
    });
    expect(mocks.ensureDeliveryDiscount).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      billingStatus: "INACTIVE",
      billingActive: false,
    });
  });
});
