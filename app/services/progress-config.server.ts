import type { FunctionConfig } from "./rule-config";

const GRAMS_PER_POUND = 453.59237;

export type StorefrontProgressConfig = {
  enabled: boolean;
  heading: string;
  goalCents: number;
  currencyCode: string;
  checkDiscountCode: boolean;
  weightEnabled: boolean;
  maxWeightPounds: number;
  quantityEnabled: boolean;
  maxQuantity: number;
  showEmptyCart: boolean;
  hideWhenQualified: boolean;
  messages: {
    awayTemplate: string;
    qualified: string;
    discountCode: string;
    weight: string;
    quantity: string;
  };
};

export function storefrontProgressConfigFromRule(
  config: FunctionConfig,
): StorefrontProgressConfig {
  return {
    enabled: config.enabled && config.progressBarEnabled,
    heading: config.progressHeading,
    goalCents: config.minSubtotalEnabled ? config.minSubtotalCents : 0,
    currencyCode: config.currencyCode || "USD",
    checkDiscountCode: config.blockDiscountCodes,
    weightEnabled: config.maxWeightEnabled,
    maxWeightPounds: round(config.maxWeightGrams / GRAMS_PER_POUND, 1),
    quantityEnabled: config.maxQuantityEnabled,
    maxQuantity: config.maxQuantity,
    showEmptyCart: config.progressShowEmptyCart,
    hideWhenQualified: config.progressHideWhenQualified,
    messages: {
      awayTemplate: config.progressAwayTemplate,
      qualified: config.progressQualifiedMessage,
      discountCode: config.progressCodeMessage,
      weight: config.progressWeightMessage,
      quantity: config.progressQuantityMessage,
    },
  };
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
