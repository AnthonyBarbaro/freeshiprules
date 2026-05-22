export enum DeliveryDiscountSelectionStrategy {
  All = "ALL",
}

export enum DiscountClass {
  Shipping = "SHIPPING",
}

export type CartDeliveryOptionsDiscountsGenerateRunResult = {
  operations: Array<Record<string, unknown>>;
};

export type DeliveryInput = Record<string, unknown>;
