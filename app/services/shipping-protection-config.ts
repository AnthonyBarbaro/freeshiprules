import { centsFromDecimal, sanitizeSingleLine } from "./rule-config";

export const DEFAULT_PROTECTION_PRODUCT_TITLE = "Shipping Protection";
export const DEFAULT_PROTECTION_HEADING = "Shipping protection";
export const DEFAULT_PROTECTION_DESCRIPTION =
  "Protect your order from loss, damage, or theft.";
export const DEFAULT_PROTECTION_OPT_IN_LABEL = "Add shipping protection";
export const MAX_PROTECTION_TIERS = 20;
export const MAX_PROTECTION_VARIANTS = 100;

export type ShippingProtectionPricingMode = "TIERED" | "FORMULA";

export type ShippingProtectionTier = {
  minCents: number;
  maxCents: number | null;
  amountCents: number;
};

export type ShippingProtectionFormula = {
  amountCents: number;
  everyCents: number;
  minChargeCents: number;
  maxChargeCents: number;
};

export type ShippingProtectionVariant = {
  variantId: string;
  legacyVariantId: string;
  title: string;
  priceCents: number;
};

export type ShippingProtectionVariantMap = Record<
  string,
  ShippingProtectionVariant
>;

export type ShippingProtectionInput = {
  enabled?: unknown;
  pricingMode?: unknown;
  productTitle?: unknown;
  widgetHeading?: unknown;
  widgetDescription?: unknown;
  optInLabel?: unknown;
  defaultSelected?: unknown;
  tiersJson?: unknown;
  tierMin?: unknown;
  tierMax?: unknown;
  tierAmount?: unknown;
  formulaAmount?: unknown;
  formulaEvery?: unknown;
  formulaMinCharge?: unknown;
  formulaMaxCharge?: unknown;
  formulaJson?: unknown;
};

export type ShippingProtectionConfig = {
  enabled: boolean;
  pricingMode: ShippingProtectionPricingMode;
  productTitle: string;
  widgetHeading: string;
  widgetDescription: string;
  optInLabel: string;
  defaultSelected: boolean;
  tiers: ShippingProtectionTier[];
  formula: ShippingProtectionFormula;
};

export function defaultShippingProtectionConfig(): ShippingProtectionConfig {
  return {
    enabled: false,
    pricingMode: "TIERED",
    productTitle: DEFAULT_PROTECTION_PRODUCT_TITLE,
    widgetHeading: DEFAULT_PROTECTION_HEADING,
    widgetDescription: DEFAULT_PROTECTION_DESCRIPTION,
    optInLabel: DEFAULT_PROTECTION_OPT_IN_LABEL,
    defaultSelected: false,
    tiers: [
      { minCents: 0, maxCents: 1000, amountCents: 100 },
      { minCents: 1000, maxCents: 3000, amountCents: 300 },
      { minCents: 3000, maxCents: 6000, amountCents: 500 },
      { minCents: 6000, maxCents: null, amountCents: 700 },
    ],
    formula: {
      amountCents: 100,
      everyCents: 1000,
      minChargeCents: 100,
      maxChargeCents: 1500,
    },
  };
}

export function normalizeShippingProtectionInput(
  input: ShippingProtectionInput,
): ShippingProtectionConfig {
  const defaults = defaultShippingProtectionConfig();
  const formula = normalizeFormula(input, defaults.formula);

  return {
    enabled: readBoolean(input.enabled, false),
    pricingMode: readPricingMode(input.pricingMode),
    productTitle: sanitizeSingleLine(
      input.productTitle,
      defaults.productTitle,
    ),
    widgetHeading: sanitizeSingleLine(
      input.widgetHeading,
      defaults.widgetHeading,
    ),
    widgetDescription: sanitizeSingleLine(
      input.widgetDescription,
      defaults.widgetDescription,
    ),
    optInLabel: sanitizeSingleLine(input.optInLabel, defaults.optInLabel),
    defaultSelected: readBoolean(input.defaultSelected, false),
    tiers: normalizeTiers(input, defaults.tiers),
    formula,
  };
}

export function computeShippingProtectionPriceCents(
  config: Pick<
    ShippingProtectionConfig,
    "enabled" | "pricingMode" | "tiers" | "formula"
  >,
  cartSubtotalCents: number,
) {
  if (!config.enabled || cartSubtotalCents <= 0) return 0;

  if (config.pricingMode === "FORMULA") {
    const every = Math.max(1, config.formula.everyCents);
    const units = Math.ceil(cartSubtotalCents / every);
    let amount = units * config.formula.amountCents;

    if (config.formula.minChargeCents > 0) {
      amount = Math.max(amount, config.formula.minChargeCents);
    }

    if (config.formula.maxChargeCents > 0) {
      amount = Math.min(amount, config.formula.maxChargeCents);
    }

    return Math.max(0, amount);
  }

  const tier = config.tiers.find(
    (candidate) =>
      cartSubtotalCents >= candidate.minCents &&
      (candidate.maxCents === null || cartSubtotalCents < candidate.maxCents),
  );

  return tier?.amountCents ?? 0;
}

export function requiredProtectionVariantAmounts(
  config: Pick<ShippingProtectionConfig, "pricingMode" | "tiers" | "formula">,
) {
  const amounts = new Set<number>();

  if (config.pricingMode === "TIERED") {
    config.tiers.forEach((tier) => {
      if (tier.amountCents > 0) amounts.add(tier.amountCents);
    });
  } else {
    const step = Math.max(1, config.formula.amountCents);
    const maxCharge =
      config.formula.maxChargeCents > 0
        ? config.formula.maxChargeCents
        : step * MAX_PROTECTION_VARIANTS;

    if (config.formula.minChargeCents > 0) {
      amounts.add(config.formula.minChargeCents);
    }

    for (let amount = step; amount <= maxCharge; amount += step) {
      const clamped =
        config.formula.minChargeCents > 0
          ? Math.max(amount, config.formula.minChargeCents)
          : amount;
      amounts.add(Math.min(clamped, maxCharge));
      if (amounts.size > MAX_PROTECTION_VARIANTS) break;
    }
  }

  return Array.from(amounts).sort((a, b) => a - b);
}

export function assertProtectionVariantLimit(amounts: number[]) {
  if (amounts.length > MAX_PROTECTION_VARIANTS) {
    throw new Error(
      `Shipping protection needs ${amounts.length} prices. Shopify products support ${MAX_PROTECTION_VARIANTS} variants, so lower the maximum charge or increase the per-step amount.`,
    );
  }
}

export function protectionAmountKey(amountCents: number) {
  return String(Math.max(0, Math.round(amountCents)));
}

export function centsToDecimal(amountCents: number) {
  return (Math.max(0, Math.round(amountCents)) / 100).toFixed(2);
}

export function moneyLabel(amountCents: number) {
  return `$${centsToDecimal(amountCents)}`;
}

function normalizeTiers(
  input: ShippingProtectionInput,
  fallback: ShippingProtectionTier[],
) {
  const parsed = parseTierInput(input);
  const tiers = parsed
    .map((tier) => ({
      minCents: Math.max(0, Math.round(tier.minCents)),
      maxCents:
        tier.maxCents === null ? null : Math.max(0, Math.round(tier.maxCents)),
      amountCents: Math.max(0, Math.round(tier.amountCents)),
    }))
    .filter(
      (tier) =>
        tier.amountCents > 0 &&
        (tier.maxCents === null || tier.maxCents > tier.minCents),
    )
    .sort((a, b) => a.minCents - b.minCents)
    .slice(0, MAX_PROTECTION_TIERS);

  return tiers.length > 0 ? tiers : fallback;
}

function parseTierInput(input: ShippingProtectionInput) {
  if (Array.isArray(input.tiersJson)) {
    return input.tiersJson.map(readTierLike);
  }

  if (typeof input.tiersJson === "string" && input.tiersJson.trim()) {
    try {
      const parsed = JSON.parse(input.tiersJson);
      if (Array.isArray(parsed)) return parsed.map(readTierLike);
    } catch {
      // Fall through to field-array parsing.
    }
  }

  const mins = toArray(input.tierMin);
  const maxes = toArray(input.tierMax);
  const amounts = toArray(input.tierAmount);

  return amounts.map((amount, index) => ({
    minCents: dollarsToCents(mins[index] ?? 0),
    maxCents: blank(maxes[index]) ? null : dollarsToCents(maxes[index]),
    amountCents: dollarsToCents(amount),
  }));
}

function readTierLike(value: unknown): ShippingProtectionTier {
  const record = isRecord(value) ? value : {};
  return {
    minCents: readInteger(record.minCents, () =>
      dollarsToCents(record.min ?? record.from ?? 0),
    ),
    maxCents:
      record.maxCents === null || blank(record.maxCents)
        ? null
        : readInteger(record.maxCents, () =>
            dollarsToCents(record.max ?? record.to ?? 0),
          ),
    amountCents: readInteger(record.amountCents, () =>
      dollarsToCents(record.amount ?? record.price ?? 0),
    ),
  };
}

function normalizeFormula(
  input: ShippingProtectionInput,
  fallback: ShippingProtectionFormula,
) {
  const parsed =
    typeof input.formulaJson === "string" && input.formulaJson.trim()
      ? parseFormulaJson(input.formulaJson)
      : isRecord(input.formulaJson)
        ? input.formulaJson
        : {};

  return {
    amountCents: Math.max(
      1,
      readInteger(parsed.amountCents, () =>
        dollarsToCents(input.formulaAmount ?? fallback.amountCents / 100),
      ),
    ),
    everyCents: Math.max(
      1,
      readInteger(parsed.everyCents, () =>
        dollarsToCents(input.formulaEvery ?? fallback.everyCents / 100),
      ),
    ),
    minChargeCents: Math.max(
      0,
      readInteger(parsed.minChargeCents, () =>
        dollarsToCents(
          input.formulaMinCharge ?? fallback.minChargeCents / 100,
        ),
      ),
    ),
    maxChargeCents: Math.max(
      0,
      readInteger(parsed.maxChargeCents, () =>
        dollarsToCents(
          input.formulaMaxCharge ?? fallback.maxChargeCents / 100,
        ),
      ),
    ),
  };
}

function parseFormulaJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readPricingMode(value: unknown): ShippingProtectionPricingMode {
  return sanitizeSingleLine(value).toUpperCase() === "FORMULA"
    ? "FORMULA"
    : "TIERED";
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

function readInteger(value: unknown, fallback: () => number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback();
}

function dollarsToCents(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 1000) {
    return value;
  }

  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? centsFromDecimal(number) : 0;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function blank(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
