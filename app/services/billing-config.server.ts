export type BillingMode = "disabled" | "shopify_app_pricing" | "billing_api";

const APP_PRICING_ALIASES = new Set([
  "shopify_app_pricing",
  "app_pricing",
  "managed_pricing",
  "managed",
]);
const BILLING_API_ALIASES = new Set(["billing_api", "manual", "api"]);
const DISABLED_ALIASES = new Set(["disabled", "off", "none", "free"]);

export function billingMode(): BillingMode {
  const value = process.env.SHOPIFY_BILLING_MODE?.trim().toLowerCase();

  if (billingDisabled()) return "disabled";
  if (value && DISABLED_ALIASES.has(value)) return "disabled";
  if (value && BILLING_API_ALIASES.has(value)) return "billing_api";
  if (value && APP_PRICING_ALIASES.has(value)) return "shopify_app_pricing";

  return "shopify_app_pricing";
}

export function billingDisabled() {
  return process.env.SHOPIFY_BILLING_DISABLED === "true";
}

export function shopifyAppPricingEnabled() {
  return billingMode() === "shopify_app_pricing";
}

export function billingModeLabel() {
  const mode = billingMode();

  if (mode === "disabled") return "Disabled";
  if (mode === "shopify_app_pricing") return "Shopify App Pricing";

  return "Shopify Billing API";
}

export function shopifyAppHandle() {
  const configured = process.env.SHOPIFY_APP_HANDLE?.trim();
  const fallback = process.env.SHOPIFY_APP_NAME?.trim() || "FreeShip Rules";
  const handle = configured || fallback;

  return handle
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function shopifyStoreHandle(shopDomain: string) {
  return shopDomain
    .trim()
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "");
}

export function shopifyAppPricingUrl(shopDomain: string) {
  const appHandle = shopifyAppHandle();
  if (!appHandle) {
    throw new Error(
      "SHOPIFY_APP_HANDLE is required when SHOPIFY_BILLING_MODE=shopify_app_pricing.",
    );
  }

  return `https://admin.shopify.com/store/${shopifyStoreHandle(
    shopDomain,
  )}/charges/${appHandle}/pricing_plans`;
}
