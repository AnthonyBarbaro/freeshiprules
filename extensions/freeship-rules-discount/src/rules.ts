import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
} from "../generated/api";

type Money = { amount?: string; currencyCode?: string };
type DeliveryOption = {
  handle: string;
  title?: string | null;
  code?: string | null;
  deliveryMethodType?: string;
  cost?: Money;
};
type DeliveryGroup = {
  id?: string;
  deliveryAddress?: {
    countryCode?: string | null;
    provinceCode?: string | null;
  } | null;
  deliveryOptions?: DeliveryOption[];
};
type CartLine = {
  quantity?: number;
  merchandise?: {
    __typename?: string;
    weight?: number | null;
    weightUnit?: string | null;
  };
};
type FunctionInput = {
  cart?: {
    cost?: { subtotalAmount?: Money };
    lines?: CartLine[];
    deliveryGroups?: DeliveryGroup[];
  };
  discount?: {
    discountClasses?: string[];
    metafield?: { jsonValue?: unknown; value?: string | null } | null;
  };
  triggeringDiscountCode?: string | null;
};
type FunctionConfig = {
  enabled?: boolean;
  offerName?: string;
  message?: string;
  minSubtotalCents?: number;
  currencyCode?: string;
  maxWeightGrams?: number;
  maxQuantity?: number;
  blockDiscountCodes?: boolean;
  applyMode?: string;
  shippingTitleMatchType?: string;
  shippingTitleMatchValue?: string;
  excludedTitleTerms?: string[];
  allowExpedited?: boolean;
  eligibleCountries?: string[];
  eligibleStates?: string[];
  regexEnabled?: boolean;
};

const EMPTY = { operations: [] };
const DEFAULT_EXCLUDED_TERMS = ["Next Day", "Overnight", "Express", "Air"];

export function buildDeliveryDiscountResult(input: unknown) {
  const runInput = input as FunctionInput;
  const config = readConfig(runInput);

  if (!config.enabled) return EMPTY;
  if (!runInput.discount?.discountClasses?.includes(DiscountClass.Shipping)) {
    return EMPTY;
  }
  if (config.blockDiscountCodes && runInput.triggeringDiscountCode) {
    return EMPTY;
  }

  const subtotal = cents(runInput.cart?.cost?.subtotalAmount?.amount);
  if (subtotal < (config.minSubtotalCents ?? 0)) return EMPTY;

  const cartCurrency = runInput.cart?.cost?.subtotalAmount?.currencyCode;
  if (
    config.currencyCode &&
    cartCurrency &&
    config.currencyCode.toUpperCase() !== cartCurrency.toUpperCase()
  ) {
    return EMPTY;
  }

  const lines = runInput.cart?.lines ?? [];
  const quantity = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  if (quantity > (config.maxQuantity ?? Number.MAX_SAFE_INTEGER)) return EMPTY;

  const weightGrams = lines.reduce(
    (sum, line) =>
      sum +
      grams(line.merchandise?.weight, line.merchandise?.weightUnit) *
        (line.quantity ?? 0),
    0,
  );
  if (weightGrams > (config.maxWeightGrams ?? Number.MAX_SAFE_INTEGER)) {
    return EMPTY;
  }

  const candidates = (runInput.cart?.deliveryGroups ?? []).flatMap((group) => {
    if (!groupIsEligible(group, config)) return [];

    const eligibleOptions = (group.deliveryOptions ?? [])
      .filter((option) => optionIsEligible(option, config))
      .sort((a, b) => cents(a.cost?.amount) - cents(b.cost?.amount));

    if (eligibleOptions.length === 0) return [];

    const selected =
      config.applyMode === "ALL_ELIGIBLE"
        ? eligibleOptions
        : [eligibleOptions[0]];

    return selected.map((option) => ({
      message: config.message || config.offerName || "Free Shipping",
      targets: [
        {
          deliveryOption: {
            handle: option.handle,
          },
        },
      ],
      value: {
        percentage: {
          value: 100,
        },
      },
    }));
  });

  if (candidates.length === 0) return EMPTY;

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates,
          selectionStrategy: DeliveryDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

function readConfig(input: FunctionInput): Required<FunctionConfig> {
  const metafield = input.discount?.metafield;
  const raw = metafield?.jsonValue ?? parseJson(metafield?.value);
  const value = isObject(raw) ? raw : {};

  return {
    enabled: value.enabled === true,
    offerName: stringValue(value.offerName, "Free Shipping"),
    message: stringValue(value.message, "Free Shipping"),
    minSubtotalCents: numberValue(value.minSubtotalCents, 0),
    currencyCode: stringValue(value.currencyCode, ""),
    maxWeightGrams: numberValue(value.maxWeightGrams, Number.MAX_SAFE_INTEGER),
    maxQuantity: numberValue(value.maxQuantity, Number.MAX_SAFE_INTEGER),
    blockDiscountCodes: value.blockDiscountCodes !== false,
    applyMode: stringValue(value.applyMode, "CHEAPEST_ELIGIBLE"),
    shippingTitleMatchType: stringValue(
      value.shippingTitleMatchType,
      "CONTAINS",
    ),
    shippingTitleMatchValue: stringValue(value.shippingTitleMatchValue, ""),
    excludedTitleTerms: arrayValue(
      value.excludedTitleTerms,
      DEFAULT_EXCLUDED_TERMS,
    ),
    allowExpedited: value.allowExpedited === true,
    eligibleCountries: arrayValue(value.eligibleCountries, []),
    eligibleStates: arrayValue(value.eligibleStates, []),
    regexEnabled: value.regexEnabled === true,
  };
}

function groupIsEligible(
  group: DeliveryGroup,
  config: Required<FunctionConfig>,
) {
  const countries = config.eligibleCountries.map((code) => code.toUpperCase());
  const states = config.eligibleStates.map((code) => code.toUpperCase());
  const country = group.deliveryAddress?.countryCode?.toUpperCase();
  const state = group.deliveryAddress?.provinceCode?.toUpperCase();

  if (countries.length > 0 && (!country || !countries.includes(country))) {
    return false;
  }
  if (states.length > 0 && (!state || !states.includes(state))) {
    return false;
  }
  return true;
}

function optionIsEligible(
  option: DeliveryOption,
  config: Required<FunctionConfig>,
) {
  const title = `${option.title ?? ""} ${option.code ?? ""} ${option.handle}`;
  const normalizedTitle = title.toLowerCase();

  if (!config.allowExpedited) {
    const excluded = config.excludedTitleTerms.some((term) =>
      normalizedTitle.includes(term.toLowerCase()),
    );
    if (excluded) return false;
  }

  const matchValue = config.shippingTitleMatchValue.trim();
  if (!matchValue) {
    return config.applyMode !== "MATCHING_TITLE";
  }

  return titleMatches(
    title,
    matchValue,
    config.shippingTitleMatchType,
    config.regexEnabled,
  );
}

function titleMatches(
  title: string,
  value: string,
  matchType: string,
  regexEnabled: boolean,
) {
  const normalizedTitle = title.toLowerCase();
  const normalizedValue = value.toLowerCase();

  switch (matchType.toUpperCase()) {
    case "EXACT":
      return normalizedTitle.trim() === normalizedValue.trim();
    case "STARTS_WITH":
      return normalizedTitle.trim().startsWith(normalizedValue.trim());
    case "REGEX":
      if (!regexEnabled || value.length > 80) return false;
      try {
        return new RegExp(value, "i").test(title);
      } catch {
        return false;
      }
    case "NONE":
      return true;
    case "CONTAINS":
    default:
      return normalizedTitle.includes(normalizedValue);
  }
}

function cents(amount: unknown) {
  const number = Number(amount ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function grams(weight: unknown, unit: unknown) {
  const value = Number(weight ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;

  switch (unit) {
    case "KILOGRAMS":
      return value * 1000;
    case "POUNDS":
      return value * 453.59237;
    case "OUNCES":
      return value * 28.349523125;
    case "GRAMS":
    default:
      return value;
  }
}

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function arrayValue(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}
