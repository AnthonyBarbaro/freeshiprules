import { describe, expect, it } from "vitest";
import { buildDeliveryDiscountResult } from "./rules";

describe("FreeShip Rules delivery discount function", () => {
  it("qualifies when no discount code and all rules pass", () => {
    const result = buildDeliveryDiscountResult(baseInput());
    expect(candidates(result)).toHaveLength(1);
    expect(firstHandle(result)).toBe("ground");
  });

  it("fails when discount code exists", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ triggeringDiscountCode: "LIQUOR25" }),
    );
    expect(result.operations).toEqual([]);
  });

  it("suppresses free shipping when a triggering discount code is present", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ triggeringDiscountCode: "SAVE10" }),
    );

    expect(result.operations).toEqual([]);
  });

  it("allows triggering discount code only when blockDiscountCodes is false", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({
        triggeringDiscountCode: "SAVE10",
        config: { blockDiscountCodes: false },
      }),
    );

    expect(candidates(result)).toHaveLength(1);
  });

  it("applies when test mode is disabled and offer name is not freeship", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({
        config: {
          testMode: false,
          name: "Launch rule",
          offerName: "Free Shipping",
        },
      }),
    );

    expect(candidates(result)).toHaveLength(1);
  });

  it("blocks test mode unless the rule or offer name is freeship", () => {
    const blocked = buildDeliveryDiscountResult(
      baseInput({
        config: {
          testMode: true,
          name: "No stacking free shipping",
          offerName: "Free Shipping",
        },
      }),
    );
    expect(blocked.operations).toEqual([]);

    const allowed = buildDeliveryDiscountResult(
      baseInput({ config: { testMode: true, name: "freeship" } }),
    );
    expect(candidates(allowed)).toHaveLength(1);
  });

  it("fails when subtotal is below threshold", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ subtotalAmount: "300.00" }),
    );
    expect(result.operations).toEqual([]);
  });

  it("can disable the minimum subtotal rule", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({
        config: { minSubtotalEnabled: false },
        subtotalAmount: "1.00",
      }),
    );
    expect(candidates(result)).toHaveLength(1);
  });

  it("fails when weight is over max", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ lineWeight: 9, quantity: 4 }),
    );
    expect(result.operations).toEqual([]);
  });

  it("can disable the maximum weight rule", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ config: { maxWeightEnabled: false }, lineWeight: 80 }),
    );
    expect(candidates(result)).toHaveLength(1);
  });

  it("fails when quantity is over max", () => {
    const result = buildDeliveryDiscountResult(baseInput({ quantity: 8 }));
    expect(result.operations).toEqual([]);
  });

  it("can disable the maximum quantity rule", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({
        config: { maxQuantityEnabled: false },
        lineWeight: 0.01,
        quantity: 100,
      }),
    );
    expect(candidates(result)).toHaveLength(1);
  });

  it("ignores shipping protection lines for subtotal and quantity limits", () => {
    const belowThreshold = buildDeliveryDiscountResult(
      baseInput({
        subtotalAmount: "405.00",
        lines: [
          line({ quantity: 4, subtotalAmount: "399.00" }),
          line({
            quantity: 1,
            subtotalAmount: "6.00",
            shippingProtection: true,
          }),
        ],
      }),
    );
    expect(belowThreshold.operations).toEqual([]);

    const eligible = buildDeliveryDiscountResult(
      baseInput({
        subtotalAmount: "406.00",
        config: { maxQuantity: 4 },
        lines: [
          line({ quantity: 4, subtotalAmount: "400.00" }),
          line({
            quantity: 1,
            subtotalAmount: "6.00",
            shippingProtection: true,
          }),
        ],
      }),
    );
    expect(candidates(eligible)).toHaveLength(1);
  });

  it("excludes overnight and express methods by default", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({
        deliveryOptions: [
          option("overnight", "Overnight", "1.00"),
          option("express", "Express Air", "2.00"),
          option("ground", "Ground", "9.00"),
        ],
      }),
    );
    expect(firstHandle(result)).toBe("ground");
  });

  it("applies to the cheapest eligible shipping option", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({
        deliveryOptions: [
          option("ground", "Ground", "12.00"),
          option("economy", "Economy Ground", "6.00"),
          option("express", "Express", "3.00"),
        ],
      }),
    );
    expect(firstHandle(result)).toBe("economy");
  });

  it("handles missing config safely", () => {
    const result = buildDeliveryDiscountResult({
      cart: { deliveryGroups: [] },
      discount: { discountClasses: ["SHIPPING"], metafield: null },
    });
    expect(result.operations).toEqual([]);
  });

  it("handles empty delivery groups safely", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ deliveryGroups: [] }),
    );
    expect(result.operations).toEqual([]);
  });

  it("handles multi-delivery-group carts safely", () => {
    const input = baseInput({
      deliveryGroups: [
        group("group-1", [
          option("ground-1", "Ground", "10.00"),
          option("economy-1", "Economy", "5.00"),
        ]),
        group("group-2", [
          option("ground-2", "Ground", "8.00"),
          option("express-2", "Express", "1.00"),
        ]),
      ],
    });

    const handles = candidates(buildDeliveryDiscountResult(input)).map(
      (candidate) => candidate.targets[0].deliveryOption.handle,
    );

    expect(handles).toEqual(["economy-1", "ground-2"]);
  });
});

function baseInput(overrides: Record<string, unknown> = {}) {
  const quantity = Number(overrides.quantity ?? 4);
  const lineWeight = Number(overrides.lineWeight ?? 5);
  const deliveryGroups = (overrides.deliveryGroups as
    | unknown[]
    | undefined) ?? [
    group(
      "group-1",
      (overrides.deliveryOptions as
        | ReturnType<typeof option>[]
        | undefined) ?? [
        option("ground", "Ground", "12.00"),
        option("express", "Express", "4.00"),
      ],
    ),
  ];

  const config = (overrides.config as Record<string, unknown> | undefined) ?? {};
  const lines = (overrides.lines as unknown[] | undefined) ?? [
    line({
      quantity,
      weight: lineWeight,
      subtotalAmount: String(overrides.subtotalAmount ?? "450.00"),
    }),
  ];

  return {
    cart: {
      cost: {
        subtotalAmount: {
          amount: overrides.subtotalAmount ?? "450.00",
          currencyCode: "USD",
        },
      },
      lines,
      deliveryGroups,
    },
    discount: {
      discountClasses: ["SHIPPING"],
      metafield: {
        jsonValue: {
          enabled: true,
          name: "No stacking free shipping",
          offerName: "Free Shipping",
          message: "Free Shipping",
          testMode: false,
          minSubtotalEnabled: true,
          minSubtotalCents: 40000,
          currencyCode: "USD",
          maxWeightEnabled: true,
          maxWeightGrams: 13608,
          maxQuantityEnabled: true,
          maxQuantity: 6,
          blockDiscountCodes: true,
          applyMode: "CHEAPEST_ELIGIBLE",
          shippingTitleMatchType: "NONE",
          shippingTitleMatchValue: "",
          excludedTitleTerms: ["Next Day", "Overnight", "Express", "Air"],
          allowExpedited: false,
          ...config,
        },
      },
    },
    triggeringDiscountCode: overrides.triggeringDiscountCode ?? null,
  };
}

function line({
  quantity,
  shippingProtection = false,
  subtotalAmount,
  weight = 5,
}: {
  quantity: number;
  shippingProtection?: boolean;
  subtotalAmount: string;
  weight?: number;
}) {
  return {
    quantity,
    shippingProtection: shippingProtection ? { value: "true" } : null,
    cost: {
      subtotalAmount: {
        amount: subtotalAmount,
        currencyCode: "USD",
      },
    },
    merchandise: {
      __typename: "ProductVariant",
      weight,
      weightUnit: "POUNDS",
      product: {
        hasAnyTag: shippingProtection,
      },
    },
  };
}

function group(id: string, deliveryOptions: ReturnType<typeof option>[]) {
  return {
    id,
    deliveryAddress: { countryCode: "US", provinceCode: "CA" },
    deliveryOptions,
  };
}

function option(handle: string, title: string, amount: string) {
  return {
    handle,
    title,
    code: handle,
    deliveryMethodType: "SHIPPING",
    cost: { amount, currencyCode: "USD" },
  };
}

function candidates(result: ReturnType<typeof buildDeliveryDiscountResult>) {
  return (result.operations[0]?.deliveryDiscountsAdd?.candidates ??
    []) as Array<{ targets: Array<{ deliveryOption: { handle: string } }> }>;
}

function firstHandle(result: ReturnType<typeof buildDeliveryDiscountResult>) {
  return candidates(result)[0]?.targets[0]?.deliveryOption.handle;
}
