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
  shippingProtection?: { value?: string | null } | null;
  cost?: { subtotalAmount?: Money };
  merchandise?: {
    __typename?: string;
    weight?: number | null;
    weightUnit?: string | null;
    product?: {
      id?: string;
      handle?: string;
      productType?: string | null;
      vendor?: string | null;
      hasAnyTag?: boolean;
    } | null;
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
  name?: string;
  offerName?: string;
  message?: string;
  testMode?: boolean;
  minSubtotalEnabled?: boolean;
  minSubtotalCents?: number;
  currencyCode?: string;
  maxWeightEnabled?: boolean;
  maxWeightGrams?: number;
  maxQuantityEnabled?: boolean;
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
  productTargetingMode?: string;
  eligibleProductHandles?: string[];
  eligibleProductTypes?: string[];
  eligibleProductVendors?: string[];
};

const EMPTY = { operations: [] };
const DEFAULT_EXCLUDED_TERMS = ["Next Day", "Overnight", "Express", "Air"];
const TEST_MODE_REQUIRED_NAME = "freeship";

export function buildDeliveryDiscountResult(input: unknown) {
  const runInput = input as FunctionInput;
  const config = readConfig(runInput);

  if (!config.enabled) return EMPTY;
  if (!runInput.discount?.discountClasses?.includes(DiscountClass.Shipping)) {
    return EMPTY;
  }
  if (config.testMode && !testModeNameMatches(config)) {
    return EMPTY;
  }
  if (config.blockDiscountCodes && runInput.triggeringDiscountCode) {
    return EMPTY;
  }

  const lines = runInput.cart?.lines ?? [];
  const eligibleLines = lines.filter((line) => !isShippingProtectionLine(line));
  const productTargeting = productTargetingResult(eligibleLines, config);
  if (!productTargeting.eligible) return EMPTY;

  const countedLines = productTargeting.countedLines;
  const subtotal = eligibleSubtotalCents(runInput, lines, productTargeting);
  if (config.minSubtotalEnabled && subtotal < (config.minSubtotalCents ?? 0)) {
    return EMPTY;
  }

  const cartCurrency = runInput.cart?.cost?.subtotalAmount?.currencyCode;
  if (
    config.currencyCode &&
    cartCurrency &&
    config.currencyCode.toUpperCase() !== cartCurrency.toUpperCase()
  ) {
    return EMPTY;
  }

  const quantity = countedLines.reduce(
    (sum, line) => sum + (line.quantity ?? 0),
    0,
  );
  if (
    config.maxQuantityEnabled &&
    quantity > (config.maxQuantity ?? Number.MAX_SAFE_INTEGER)
  ) {
    return EMPTY;
  }

  const weightGrams = countedLines.reduce(
    (sum, line) =>
      sum +
      grams(line.merchandise?.weight, line.merchandise?.weightUnit) *
        (line.quantity ?? 0),
    0,
  );
  if (
    config.maxWeightEnabled &&
    weightGrams > (config.maxWeightGrams ?? Number.MAX_SAFE_INTEGER)
  ) {
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

type ProductTargetingResult = {
  countedLines: CartLine[];
  eligible: boolean;
  selectedOnly: boolean;
};

function eligibleSubtotalCents(
  input: FunctionInput,
  lines: CartLine[],
  productTargeting: ProductTargetingResult,
) {
  if (productTargeting.selectedOnly) {
    return productTargeting.countedLines.reduce(
      (sum, line) => sum + cents(line.cost?.subtotalAmount?.amount),
      0,
    );
  }

  const cartSubtotal = cents(input.cart?.cost?.subtotalAmount?.amount);
  const shippingProtectionSubtotal = lines
    .filter(isShippingProtectionLine)
    .reduce(
      (sum, line) => sum + cents(line.cost?.subtotalAmount?.amount),
      0,
    );

  return Math.max(0, cartSubtotal - shippingProtectionSubtotal);
}

function productTargetingResult(
  lines: CartLine[],
  config: Required<FunctionConfig>,
): ProductTargetingResult {
  const mode = config.productTargetingMode;
  if (mode === "ALL") {
    return { countedLines: lines, eligible: true, selectedOnly: false };
  }

  if (!hasProductTargets(config)) {
    return { countedLines: [], eligible: false, selectedOnly: true };
  }

  const matchingLines = lines.filter((line) =>
    productLineMatches(line, config),
  );

  if (mode === "ANY_SELECTED") {
    return {
      countedLines: lines,
      eligible: matchingLines.length > 0,
      selectedOnly: false,
    };
  }

  if (mode === "ALL_SELECTED") {
    return {
      countedLines: matchingLines,
      eligible:
        lines.length > 0 &&
        matchingLines.length > 0 &&
        matchingLines.length === lines.length,
      selectedOnly: true,
    };
  }

  return {
    countedLines: matchingLines,
    eligible: matchingLines.length > 0,
    selectedOnly: true,
  };
}

function hasProductTargets(config: Required<FunctionConfig>) {
  return (
    config.eligibleProductHandles.length > 0 ||
    config.eligibleProductTypes.length > 0 ||
    config.eligibleProductVendors.length > 0
  );
}

function productLineMatches(
  line: CartLine,
  config: Required<FunctionConfig>,
) {
  const product = line.merchandise?.product;
  if (!product) return false;

  return (
    matchesAny(product.handle, config.eligibleProductHandles) ||
    matchesAny(product.productType, config.eligibleProductTypes) ||
    matchesAny(product.vendor, config.eligibleProductVendors)
  );
}

function matchesAny(value: unknown, candidates: string[]) {
  const normalizedValue = normalizeToken(value);
  return (
    Boolean(normalizedValue) &&
    candidates.some((candidate) => normalizeToken(candidate) === normalizedValue)
  );
}

function isShippingProtectionLine(line: CartLine) {
  return (
    line.shippingProtection?.value === "true" ||
    line.merchandise?.product?.hasAnyTag === true
  );
}

function readConfig(input: FunctionInput): Required<FunctionConfig> {
  const metafield = input.discount?.metafield;
  const raw = metafield?.jsonValue ?? parseJson(metafield?.value);
  const value = isObject(raw) ? raw : {};

  return {
    enabled: value.enabled === true,
    name: stringValue(value.name, ""),
    offerName: stringValue(value.offerName, "Free Shipping"),
    message: stringValue(value.message, "Free Shipping"),
    testMode: value.testMode !== false,
    minSubtotalEnabled: value.minSubtotalEnabled !== false,
    minSubtotalCents: numberValue(value.minSubtotalCents, 0),
    currencyCode: stringValue(value.currencyCode, ""),
    maxWeightEnabled: value.maxWeightEnabled !== false,
    maxWeightGrams: numberValue(value.maxWeightGrams, Number.MAX_SAFE_INTEGER),
    maxQuantityEnabled: value.maxQuantityEnabled !== false,
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
    productTargetingMode: productTargetingMode(value.productTargetingMode),
    eligibleProductHandles: arrayValue(value.eligibleProductHandles, []),
    eligibleProductTypes: arrayValue(value.eligibleProductTypes, []),
    eligibleProductVendors: arrayValue(value.eligibleProductVendors, []),
  };
}

function productTargetingMode(value: unknown) {
  const mode = stringValue(value, "ALL").toUpperCase();
  if (mode === "ANY_SELECTED") return "ANY_SELECTED";
  if (mode === "SELECTED_SUBTOTAL") return "SELECTED_SUBTOTAL";
  if (mode === "ALL_SELECTED") return "ALL_SELECTED";
  return "ALL";
}

function testModeNameMatches(config: Required<FunctionConfig>) {
  return [config.name, config.offerName].some(
    (name) => name.trim().toLowerCase() === TEST_MODE_REQUIRED_NAME,
  );
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

function normalizeToken(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function arrayValue(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}
