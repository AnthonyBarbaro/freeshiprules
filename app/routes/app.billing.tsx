import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import {
  billingTestMode,
  monthlyPrice,
  trialDays,
} from "../services/billing.server";
import { billingBypassEnabled, billingIsActive } from "../services/shop.server";
import styles from "../styles/app-shell.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({ admin, session });

  if (
    url.searchParams.get("billing_return") &&
    billingIsActive(shop.billingStatus)
  ) {
    throw redirect("/app/settings");
  }

  return {
    billingStatus: shop.billingStatus,
    billingActive: billingIsActive(shop.billingStatus),
    billingError: url.searchParams.get("billing_error"),
    price: monthlyPrice(),
    trialDays: trialDays(),
    testMode: billingTestMode(),
    bypassEnabled: billingBypassEnabled(),
  };
};

export default function Billing() {
  const {
    billingStatus,
    billingActive,
    billingError,
    price,
    trialDays,
    testMode,
    bypassEnabled,
  } =
    useLoaderData<typeof loader>();
  const billingMode = bypassEnabled
    ? "Bypass"
    : testMode
      ? "Test subscription"
      : "Live subscription";

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Billing</p>
          <h2 className={styles.pageTitle}>FreeShip Rules Monthly</h2>
          <p className={styles.pageText}>
            Approve the Shopify subscription that unlocks rule editing,
            Function sync, and storefront progress messaging for this store.
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
          <div className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Plan active</h3>
              <p className={styles.panelText}>
                {bypassEnabled
                  ? "Billing bypass is enabled for this deployment. Settings are unlocked without creating a Shopify subscription."
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
                <h3 className={styles.panelTitle}>Approve plan</h3>
                <p className={styles.panelText}>
                  Shopify handles the merchant approval and adds the recurring
                  app charge to the store invoice.
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
              <PlanFact label="Mode" value={billingMode} />
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
                  Approve billing
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
              <StatusRow label="Billing mode" value={billingMode} />
              <StatusRow
                label="Settings"
                value={billingActive ? "Unlocked" : "Blocked"}
              />
              <StatusRow
                label="Collection"
                value={testMode ? "No real charge" : "Shopify invoice"}
              />
            </div>
            <div className={styles.notice}>
              For launch, set SHOPIFY_BILLING_TEST=false and
              SHOPIFY_BILLING_BYPASS=false.
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
