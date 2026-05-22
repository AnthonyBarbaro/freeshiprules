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

  it("fails when subtotal is below threshold", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ subtotalAmount: "300.00" }),
    );
    expect(result.operations).toEqual([]);
  });

  it("fails when weight is over max", () => {
    const result = buildDeliveryDiscountResult(
      baseInput({ lineWeight: 9, quantity: 4 }),
    );
    expect(result.operations).toEqual([]);
  });

  it("fails when quantity is over max", () => {
    const result = buildDeliveryDiscountResult(baseInput({ quantity: 8 }));
    expect(result.operations).toEqual([]);
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

  return {
    cart: {
      cost: {
        subtotalAmount: {
          amount: overrides.subtotalAmount ?? "450.00",
          currencyCode: "USD",
        },
      },
      lines: [
        {
          quantity,
          merchandise: {
            __typename: "ProductVariant",
            weight: lineWeight,
            weightUnit: "POUNDS",
          },
        },
      ],
      deliveryGroups,
    },
    discount: {
      discountClasses: ["SHIPPING"],
      metafield: {
        jsonValue: {
          enabled: true,
          offerName: "Free Shipping",
          message: "Free Shipping",
          minSubtotalCents: 40000,
          currencyCode: "USD",
          maxWeightGrams: 13608,
          maxQuantity: 6,
          blockDiscountCodes: true,
          applyMode: "CHEAPEST_ELIGIBLE",
          shippingTitleMatchType: "NONE",
          shippingTitleMatchValue: "",
          excludedTitleTerms: ["Next Day", "Overnight", "Express", "Air"],
          allowExpedited: false,
        },
      },
    },
    triggeringDiscountCode: overrides.triggeringDiscountCode ?? null,
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
