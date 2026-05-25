export const DEFAULT_OFFER_NAME = "Free Shipping";
export const DEFAULT_RULE_NAME = "No stacking free shipping";
export const DEFAULT_MESSAGE = "Free shipping";
export const DEFAULT_PROGRESS_HEADING = "Free shipping";
export const DEFAULT_PROGRESS_AWAY_TEMPLATE =
  "You are [amount] away from free shipping";
export const DEFAULT_PROGRESS_QUALIFIED_MESSAGE =
  "You qualify for free shipping";
export const DEFAULT_PROGRESS_CODE_MESSAGE =
  "Free shipping cannot be combined with discount codes";
export const DEFAULT_PROGRESS_WEIGHT_MESSAGE =
  "Free shipping available under [weight] lb";
export const DEFAULT_PROGRESS_QUANTITY_MESSAGE =
  "Free shipping available up to [quantity] items";
export const DEFAULT_EXCLUDED_TITLE_TERMS = [
  "Next Day",
  "Overnight",
  "Express",
  "Air",
];

export const FUNCTION_METAFIELD_NAMESPACE = "$app:freeship-rules";
export const FUNCTION_METAFIELD_KEY = "configuration";
export const FUNCTION_HANDLE = "freeship-rules-delivery-discount";
export const FUNCTION_TITLE = "FreeShip Rules Delivery Discount";

export type WeightUnit = "lb" | "kg";
export type ApplyMode = "CHEAPEST_ELIGIBLE" | "MATCHING_TITLE" | "ALL_ELIGIBLE";
export type ShippingTitleMatchType =
  | "NONE"
  | "CONTAINS"
  | "EXACT"
  | "STARTS_WITH"
  | "REGEX";

export type RuleInput = {
  enabled?: unknown;
  name?: unknown;
  offerName?: unknown;
  message?: unknown;
  testMode?: unknown;
  minSubtotalEnabled?: unknown;
  minSubtotal?: unknown;
  minSubtotalCents?: unknown;
  currencyCode?: unknown;
  maxWeightEnabled?: unknown;
  maxWeight?: unknown;
  maxWeightGrams?: unknown;
  maxQuantityEnabled?: unknown;
  weightUnit?: unknown;
  maxQuantity?: unknown;
  blockDiscountCodes?: unknown;
  blockOrderDiscounts?: unknown;
  blockProductDiscounts?: unknown;
  blockShippingDiscounts?: unknown;
  applyMode?: unknown;
  shippingTitleMatchType?: unknown;
  shippingTitleMatchValue?: unknown;
  excludedTitleTerms?: unknown;
  allowExpedited?: unknown;
  progressBarEnabled?: unknown;
  progressHeading?: unknown;
  progressAwayTemplate?: unknown;
  progressQualifiedMessage?: unknown;
  progressCodeMessage?: unknown;
  progressWeightMessage?: unknown;
  progressQuantityMessage?: unknown;
  progressShowEmptyCart?: unknown;
  progressHideWhenQualified?: unknown;
  countMode?: unknown;
  eligibleProductTags?: unknown;
  excludedProductTags?: unknown;
  excludedCollectionIds?: unknown;
  eligibleCountries?: unknown;
  eligibleStates?: unknown;
  customerTagInclude?: unknown;
  customerTagExclude?: unknown;
  regexEnabled?: unknown;
};

export type NormalizedRule = {
  enabled: boolean;
  name: string;
  minSubtotalCents: number;
  maxWeightGrams: number;
  maxQuantity: number;
  blockDiscountCodes: boolean;
  blockOrderDiscounts: boolean;
  blockProductDiscounts: boolean;
  blockShippingDiscounts: boolean;
  applyMode: ApplyMode;
  shippingTitleMatchType: ShippingTitleMatchType;
  shippingTitleMatchValue: string | null;
  excludedTitleTerms: string[];
  configJson: FunctionConfig;
};

export type FunctionConfig = {
  enabled: boolean;
  name: string;
  offerName: string;
  message: string;
  testMode: boolean;
  minSubtotalEnabled: boolean;
  minSubtotalCents: number;
  currencyCode: string;
  maxWeightEnabled: boolean;
  maxWeightGrams: number;
  maxQuantityEnabled: boolean;
  maxQuantity: number;
  blockDiscountCodes: boolean;
  blockOrderDiscounts: boolean;
  blockProductDiscounts: boolean;
  blockShippingDiscounts: boolean;
  applyMode: ApplyMode;
  shippingTitleMatchType: ShippingTitleMatchType;
  shippingTitleMatchValue: string;
  excludedTitleTerms: string[];
  allowExpedited: boolean;
  progressBarEnabled: boolean;
  progressHeading: string;
  progressAwayTemplate: string;
  progressQualifiedMessage: string;
  progressCodeMessage: string;
  progressWeightMessage: string;
  progressQuantityMessage: string;
  progressShowEmptyCart: boolean;
  progressHideWhenQualified: boolean;
  countMode: "ALL" | "MATCHING_PRODUCT_TAGS";
  eligibleProductTags: string[];
  excludedProductTags: string[];
  excludedCollectionIds: string[];
  eligibleCountries: string[];
  eligibleStates: string[];
  customerTagInclude: string[];
  customerTagExclude: string[];
  regexEnabled: boolean;
};

const MAX_TEXT_LENGTH = 120;
const MAX_LIST_ITEMS = 50;

export function lbToGrams(lb: number): number {
  return Math.round(lb * 453.59237);
}

export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000);
}

export function centsFromDecimal(value: number): number {
  return Math.max(0, Math.round(value * 100));
}

export function sanitizeSingleLine(value: unknown, fallback = ""): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const sanitized = Array.from(text)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return (sanitized || fallback).slice(0, MAX_TEXT_LENGTH);
}

export function parseDelimitedList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeList(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeList(parsed);
    } catch {
      // Fall back to comma/newline parsing below.
    }
    return normalizeList(trimmed.split(/[\n,]/g));
  }

  return [];
}

export function normalizeRuleInput(input: RuleInput): NormalizedRule {
  const weightUnit = input.weightUnit === "kg" ? "kg" : "lb";
  const minSubtotalCents = readInteger(input.minSubtotalCents, () =>
    centsFromDecimal(readNumber(input.minSubtotal, 400)),
  );
  const maxWeightGrams = readInteger(input.maxWeightGrams, () => {
    const weight = readNumber(input.maxWeight, 30);
    return weightUnit === "kg" ? kgToGrams(weight) : lbToGrams(weight);
  });
  const maxQuantity = readInteger(input.maxQuantity, () => 6);
  const applyMode = readApplyMode(input.applyMode);
  const shippingTitleMatchType = readMatchType(input.shippingTitleMatchType);
  const excludedTitleTerms =
    parseDelimitedList(input.excludedTitleTerms).length > 0
      ? parseDelimitedList(input.excludedTitleTerms)
      : DEFAULT_EXCLUDED_TITLE_TERMS;

  const configJson: FunctionConfig = {
    enabled: readBoolean(input.enabled, true),
    name: sanitizeSingleLine(input.name, DEFAULT_RULE_NAME),
    offerName: sanitizeSingleLine(input.offerName, DEFAULT_OFFER_NAME),
    message: sanitizeSingleLine(input.message, DEFAULT_MESSAGE),
    testMode: readBoolean(input.testMode, true),
    minSubtotalEnabled: readBoolean(input.minSubtotalEnabled, true),
    minSubtotalCents,
    currencyCode: sanitizeCurrency(input.currencyCode),
    maxWeightEnabled: readBoolean(input.maxWeightEnabled, true),
    maxWeightGrams,
    maxQuantityEnabled: readBoolean(input.maxQuantityEnabled, true),
    maxQuantity,
    blockDiscountCodes: readBoolean(input.blockDiscountCodes, true),
    blockOrderDiscounts: readBoolean(input.blockOrderDiscounts, true),
    blockProductDiscounts: readBoolean(input.blockProductDiscounts, true),
    blockShippingDiscounts: readBoolean(input.blockShippingDiscounts, true),
    applyMode,
    shippingTitleMatchType,
    shippingTitleMatchValue: sanitizeSingleLine(input.shippingTitleMatchValue),
    excludedTitleTerms,
    allowExpedited: readBoolean(input.allowExpedited, false),
    progressBarEnabled: readBoolean(input.progressBarEnabled, true),
    progressHeading: sanitizeSingleLine(
      input.progressHeading,
      DEFAULT_PROGRESS_HEADING,
    ),
    progressAwayTemplate: sanitizeSingleLine(
      input.progressAwayTemplate,
      DEFAULT_PROGRESS_AWAY_TEMPLATE,
    ),
    progressQualifiedMessage: sanitizeSingleLine(
      input.progressQualifiedMessage,
      DEFAULT_PROGRESS_QUALIFIED_MESSAGE,
    ),
    progressCodeMessage: sanitizeSingleLine(
      input.progressCodeMessage,
      DEFAULT_PROGRESS_CODE_MESSAGE,
    ),
    progressWeightMessage: sanitizeSingleLine(
      input.progressWeightMessage,
      DEFAULT_PROGRESS_WEIGHT_MESSAGE,
    ),
    progressQuantityMessage: sanitizeSingleLine(
      input.progressQuantityMessage,
      DEFAULT_PROGRESS_QUANTITY_MESSAGE,
    ),
    progressShowEmptyCart: readBoolean(input.progressShowEmptyCart, true),
    progressHideWhenQualified: readBoolean(
      input.progressHideWhenQualified,
      false,
    ),
    countMode:
      sanitizeSingleLine(input.countMode).toUpperCase() ===
      "MATCHING_PRODUCT_TAGS"
        ? "MATCHING_PRODUCT_TAGS"
        : "ALL",
    eligibleProductTags: parseDelimitedList(input.eligibleProductTags),
    excludedProductTags: parseDelimitedList(input.excludedProductTags),
    excludedCollectionIds: parseDelimitedList(input.excludedCollectionIds),
    eligibleCountries: parseDelimitedList(input.eligibleCountries).map((code) =>
      code.toUpperCase(),
    ),
    eligibleStates: parseDelimitedList(input.eligibleStates).map((code) =>
      code.toUpperCase(),
    ),
    customerTagInclude: parseDelimitedList(input.customerTagInclude),
    customerTagExclude: parseDelimitedList(input.customerTagExclude),
    regexEnabled: readBoolean(input.regexEnabled, false),
  };

  return {
    enabled: configJson.enabled,
    name: configJson.name,
    minSubtotalCents: configJson.minSubtotalCents,
    maxWeightGrams: configJson.maxWeightGrams,
    maxQuantity: configJson.maxQuantity,
    blockDiscountCodes: configJson.blockDiscountCodes,
    blockOrderDiscounts: configJson.blockOrderDiscounts,
    blockProductDiscounts: configJson.blockProductDiscounts,
    blockShippingDiscounts: configJson.blockShippingDiscounts,
    applyMode: configJson.applyMode,
    shippingTitleMatchType: configJson.shippingTitleMatchType,
    shippingTitleMatchValue: configJson.shippingTitleMatchValue || null,
    excludedTitleTerms: configJson.excludedTitleTerms,
    configJson,
  };
}

export function defaultFunctionConfig(): FunctionConfig {
  return normalizeRuleInput({}).configJson;
}

function normalizeList(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => sanitizeSingleLine(value))
        .filter(Boolean)
        .slice(0, MAX_LIST_ITEMS),
    ),
  );
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["true", "1", "on", "yes"].includes(value.toLowerCase());
  }
  return fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function readInteger(value: unknown, fallback: () => number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback();
}

function readApplyMode(value: unknown): ApplyMode {
  const normalized = sanitizeSingleLine(value).toUpperCase();
  if (normalized === "MATCHING_TITLE") return "MATCHING_TITLE";
  if (normalized === "ALL_ELIGIBLE") return "ALL_ELIGIBLE";
  return "CHEAPEST_ELIGIBLE";
}

function readMatchType(value: unknown): ShippingTitleMatchType {
  const normalized = sanitizeSingleLine(value).toUpperCase().replace(/-/g, "_");
  if (normalized === "NONE") return "NONE";
  if (normalized === "EXACT") return "EXACT";
  if (normalized === "STARTS_WITH") return "STARTS_WITH";
  if (normalized === "REGEX") return "REGEX";
  return "CONTAINS";
}

function sanitizeCurrency(value: unknown): string {
  const currency = sanitizeSingleLine(value, "USD").toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}
