import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import {
  billingTestMode,
  monthlyPrice,
  syncBillingCheckStatus,
  trialDays,
} from "../services/billing.server";
import {
  billingDisabled,
  billingModeLabel,
  shopifyAppPricingEnabled,
} from "../services/billing-config.server";
import {
  billingBypassEnabled,
  billingDisplayStatus,
  billingIsActive,
} from "../services/shop.server";
import styles from "../styles/app-shell.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, billing, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({ admin, session });
  const billingOff = billingDisabled();
  const usesShopifyAppPricing = shopifyAppPricingEnabled();
  const billingShop = usesShopifyAppPricing
    ? await syncBillingCheckStatus(billing, session.shop).catch(() => shop)
    : shop;

  return {
    billingStatus: billingDisplayStatus(billingShop.billingStatus),
    billingActive: billingIsActive(billingShop.billingStatus),
    billingDisabled: billingOff,
    billingReturnComplete: Boolean(
      url.searchParams.get("billing_return") ||
      url.searchParams.get("plan_handle") ||
      url.searchParams.get("charge_id"),
    ),
    billingError: url.searchParams.get("billing_error"),
    price: monthlyPrice(),
    trialDays: trialDays(),
    testMode: !usesShopifyAppPricing && billingTestMode(),
    bypassEnabled: billingBypassEnabled(),
    billingMode: billingModeLabel(),
    usesShopifyAppPricing,
  };
};

export default function Billing() {
  const {
    billingStatus,
    billingActive,
    billingDisabled,
    billingReturnComplete,
    billingError,
    price,
    trialDays,
    testMode,
    bypassEnabled,
    billingMode,
    usesShopifyAppPricing,
  } = useLoaderData<typeof loader>();
  const effectiveBillingMode = billingDisabled
    ? "Disabled"
    : bypassEnabled
    ? "Bypass"
    : testMode
      ? "Test subscription"
      : billingMode;

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Billing</p>
          <h2 className={styles.pageTitle}>FreeShip Rules Monthly</h2>
          <p className={styles.pageText}>
            {billingDisabled
              ? "Billing is off for this deployment, so rule editing, Function sync, and storefront progress messaging are unlocked without choosing a plan."
              : "Choose or approve the Shopify plan that unlocks rule editing, Function sync, and storefront progress messaging for this store."}
          </p>
        </div>
        <span
          className={`${styles.statusBadge} ${
            billingActive ? styles.statusActive : styles.statusInactive
          }`}
        >
          {billingStatus}
        </span>
      </header>

      {billingActive ? (
        <section className={styles.activePanel}>
          {billingReturnComplete && (
            <div className={styles.successNotice}>
              Billing approval was received. Settings are ready to use.
            </div>
          )}
          <div className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Plan active</h3>
              <p className={styles.panelText}>
                {billingDisabled
                  ? "Billing is disabled for this deployment. Settings are unlocked without creating a Shopify subscription."
                  : bypassEnabled
                  ? "Billing bypass is enabled for this deployment. Settings are unlocked without creating a Shopify subscription."
                  : usesShopifyAppPricing
                    ? "This store has an active Shopify App Pricing plan for FreeShip Rules."
                    : `This store is approved for FreeShip Rules at $${price}/month.`}
              </p>
            </div>
            <span className={`${styles.statusBadge} ${styles.statusActive}`}>
              Unlocked
            </span>
          </div>
          {bypassEnabled && (
            <div className={styles.notice}>
              Turn SHOPIFY_BILLING_BYPASS off before selling the app.
            </div>
          )}
          {billingDisabled && (
            <div className={styles.notice}>
              Turn SHOPIFY_BILLING_DISABLED off before App Store review or
              selling the app.
            </div>
          )}
          <div className={styles.actionRow}>
            <Link className={styles.primaryButton} to="/app/settings">
              Open settings
            </Link>
            <Link className={styles.secondaryButton} to="/app">
              View dashboard
            </Link>
          </div>
        </section>
      ) : (
        <div className={styles.billingGrid}>
          <section className={styles.planPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>
                  {usesShopifyAppPricing ? "Choose plan" : "Approve plan"}
                </h3>
                <p className={styles.panelText}>
                  {usesShopifyAppPricing
                    ? "Shopify hosts plan selection and adds the app charge to the store invoice."
                    : "Shopify handles the merchant approval and adds the recurring app charge to the store invoice."}
                </p>
              </div>
              <span className={`${styles.statusBadge} ${styles.statusPending}`}>
                Approval needed
              </span>
            </div>

            {billingError && (
              <div className={styles.criticalNotice}>{billingError}</div>
            )}

            <div className={styles.priceBlock}>
              <span className={styles.price}>${price}</span>
              <span className={styles.priceMeta}>per month</span>
            </div>

            <div className={styles.featureGrid}>
              <PlanFact label="Trial" value={`${trialDays} days`} />
              <PlanFact label="Mode" value={effectiveBillingMode} />
              <PlanFact label="Checkout logic" value="Shopify Function" />
              <PlanFact label="Offer stacking" value="Blocked by default" />
            </div>

            {testMode && (
              <div className={styles.testNotice}>
                Billing test mode is enabled. Shopify will create a test
                subscription, not a real charge.
              </div>
            )}

            <div className={styles.actionRow}>
              <form action="/api/billing" method="post" target="_top">
                <button className={styles.primaryButton} type="submit">
                  {usesShopifyAppPricing ? "Choose plan" : "Approve billing"}
                </button>
              </form>
              <Link className={styles.secondaryButton} to="/app/settings">
                Review rules
              </Link>
            </div>
          </section>

          <aside className={styles.sidePanel}>
            <div>
              <p className={styles.eyebrow}>Store access</p>
              <h3 className={styles.panelTitle}>Locked until approved</h3>
              <p className={styles.panelText}>
                Settings remain read-only until billing is active or bypass mode
                is enabled.
              </p>
            </div>
            <div className={styles.statusList}>
              <StatusRow label="Billing status" value={billingStatus} />
              <StatusRow label="Billing mode" value={effectiveBillingMode} />
              <StatusRow
                label="Settings"
                value={billingActive ? "Unlocked" : "Blocked"}
              />
              <StatusRow
                label="Collection"
                value={
                  testMode
                    ? "No real charge"
                    : usesShopifyAppPricing
                      ? "Shopify App Pricing"
                      : "Shopify invoice"
                }
              />
            </div>
            <div className={styles.notice}>
              For launch, use Shopify App Pricing in the app listing or set
              SHOPIFY_BILLING_MODE=billing_api with Manual pricing.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.featureItem}>
      <span className={styles.featureLabel}>{label}</span>
      <strong className={styles.featureValue}>{value}</strong>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statusRow}>
      <span className={styles.rowLabel}>{label}</span>
      <strong className={styles.rowValue}>{value}</strong>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
