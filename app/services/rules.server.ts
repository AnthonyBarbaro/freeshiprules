import type { Prisma, RuleSet } from "@prisma/client";
import db from "../db.server";
import {
  defaultFunctionConfig,
  normalizeRuleInput,
  type FunctionConfig,
  type RuleInput,
} from "./rule-config";

export async function ensureDefaultRuleSet(shopId: string) {
  const existing = await db.ruleSet.findFirst({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) return existing;

  const defaults = normalizeRuleInput({});
  return db.ruleSet.create({
    data: {
      shopId,
      ...ruleData(defaults),
    },
  });
}

export async function getRuleSetForShopDomain(shopDomain: string) {
  const shop = await db.shop.findUnique({
    where: { shopDomain },
    include: {
      ruleSets: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  if (!shop) return null;

  const ruleSet = shop.ruleSets[0] ?? (await ensureDefaultRuleSet(shop.id));

  return { shop, ruleSet };
}

export async function saveRuleSet(shopDomain: string, input: RuleInput) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop is not installed.");

  const existing = await ensureDefaultRuleSet(shop.id);
  const normalized = normalizeRuleInput(input);

  return db.ruleSet.update({
    where: { id: existing.id },
    data: ruleData(normalized),
  });
}

export async function updateRuleSyncMetadata(
  ruleSetId: string,
  metadata: Record<string, unknown>,
) {
  const ruleSet = await db.ruleSet.findUnique({ where: { id: ruleSetId } });
  const current =
    ruleSet && isRecord(ruleSet.configJson) ? ruleSet.configJson : {};

  return db.ruleSet.update({
    where: { id: ruleSetId },
    data: {
      configJson: {
        ...current,
        ...metadata,
      } as Prisma.InputJsonObject,
    },
  });
}

export function functionConfigFromRuleSet(ruleSet: RuleSet): FunctionConfig {
  const base = {
    ...defaultFunctionConfig(),
    ...(isRecord(ruleSet.configJson) ? ruleSet.configJson : {}),
  };

  return {
    ...base,
    enabled: ruleSet.enabled,
    name: String(base.name || ruleSet.name),
    offerName: String(base.offerName || ruleSet.name),
    testMode: true,
    minSubtotalCents: ruleSet.minSubtotalCents,
    maxWeightGrams: ruleSet.maxWeightGrams,
    maxQuantity: ruleSet.maxQuantity,
    blockDiscountCodes: ruleSet.blockDiscountCodes,
    blockOrderDiscounts: ruleSet.blockOrderDiscounts,
    blockProductDiscounts: ruleSet.blockProductDiscounts,
    blockShippingDiscounts: ruleSet.blockShippingDiscounts,
    applyMode: ruleSet.applyMode,
    shippingTitleMatchType: ruleSet.shippingTitleMatchType,
    shippingTitleMatchValue: ruleSet.shippingTitleMatchValue ?? "",
    excludedTitleTerms: Array.isArray(ruleSet.excludedTitleTerms)
      ? (ruleSet.excludedTitleTerms as string[])
      : defaultFunctionConfig().excludedTitleTerms,
  } as FunctionConfig;
}

function ruleData(normalized: ReturnType<typeof normalizeRuleInput>) {
  return {
    enabled: normalized.enabled,
    name: normalized.name,
    minSubtotalCents: normalized.minSubtotalCents,
    maxWeightGrams: normalized.maxWeightGrams,
    maxQuantity: normalized.maxQuantity,
    blockDiscountCodes: normalized.blockDiscountCodes,
    blockOrderDiscounts: normalized.blockOrderDiscounts,
    blockProductDiscounts: normalized.blockProductDiscounts,
    blockShippingDiscounts: normalized.blockShippingDiscounts,
    applyMode: normalized.applyMode,
    shippingTitleMatchType: normalized.shippingTitleMatchType,
    shippingTitleMatchValue: normalized.shippingTitleMatchValue,
    excludedTitleTerms: normalized.excludedTitleTerms,
    configJson: normalized.configJson as Prisma.InputJsonObject,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
