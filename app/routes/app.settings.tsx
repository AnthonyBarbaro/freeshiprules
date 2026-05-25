import type { ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  functionConfigFromRuleSet,
  getRuleSetForShopDomain,
} from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";
import styles from "../styles/app-shell.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const record = await getRuleSetForShopDomain(session.shop);
  if (!record) throw new Response("Shop not found", { status: 404 });

  const config = functionConfigFromRuleSet(record.ruleSet);

  return {
    billingStatus: record.shop.billingStatus,
    billingActive: billingIsActive(record.shop.billingStatus),
    rule: {
      id: record.ruleSet.id,
      name: record.ruleSet.name,
      minSubtotal: (record.ruleSet.minSubtotalCents / 100).toFixed(2),
      maxWeightLb: (record.ruleSet.maxWeightGrams / 453.59237).toFixed(1),
      maxQuantity: record.ruleSet.maxQuantity,
      updatedAt: record.ruleSet.updatedAt.toISOString(),
      config,
    },
  };
};

export default function Settings() {
  const { billingActive, billingStatus, rule } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const saving = fetcher.state !== "idle";
  const canSave = billingActive && !saving;

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Settings</p>
          <h2 className={styles.pageTitle}>Free shipping rule</h2>
          <p className={styles.pageText}>
            Set the few conditions a cart must meet. Checkout will only make
            shipping free when every enabled rule passes.
          </p>
        </div>
        <div className={styles.actionRow}>
          <Link className={styles.secondaryButton} to="/app/install-check">
            Verify install
          </Link>
          <button
            className={styles.primaryButton}
            disabled={!canSave}
            form="rules-form"
            type="submit"
          >
            {saving ? "Saving" : "Save rule"}
          </button>
        </div>
      </header>

      {fetcher.data?.ok && (
        <div className={styles.successNotice}>
          Rule saved. New checkout behavior is now stored in Shopify.
        </div>
      )}

      {fetcher.data?.error && (
        <div className={styles.criticalNotice}>{fetcher.data.error}</div>
      )}

      {!billingActive && (
        <div className={styles.notice}>
          Billing is {billingStatus}. Approve billing or enable testing bypass
          before saving changes.{" "}
          <Link to="/app/billing">Open billing</Link>
        </div>
      )}

      <div className={styles.settingsLayout}>
        <fetcher.Form
          action="/api/rules"
          className={styles.settingsForm}
          id="rules-form"
          method="post"
        >
          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>1</span>
              <div>
                <h3 className={styles.panelTitle}>Turn the offer on</h3>
                <p className={styles.panelText}>
                  This controls whether checkout can show the free shipping
                  offer.
                </p>
              </div>
            </div>

            <Checkbox
              defaultChecked={rule.config.enabled}
              helper="Leave this on when you want the checkout rule to run. Turn it off to pause the offer without deleting it."
              label="Enable free shipping rule"
              name="enabled"
            />

            <div className={styles.fieldGrid}>
              <Field
                defaultValue={rule.config.offerName}
                helper="The short name Shopify uses for this shipping discount."
                label="Offer name"
                name="offerName"
              />
              <Field
                defaultValue={rule.config.message}
                helper="The message customers see beside the free shipping rate."
                label="Checkout message"
                name="message"
              />
            </div>
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>2</span>
              <div>
                <h3 className={styles.panelTitle}>Set the cart limits</h3>
                <p className={styles.panelText}>
                  Customers must meet all three limits before shipping can be
                  free.
                </p>
              </div>
            </div>

            <div className={styles.fieldGrid}>
              <Field
                defaultValue={rule.minSubtotal}
                helper="Cart subtotal before shipping and taxes. Enter dollars, for example 400."
                label="Minimum cart subtotal"
                min="0"
                name="minSubtotal"
                prefix="$"
                step="0.01"
                type="number"
              />
              <Field
                defaultValue={rule.maxWeightLb}
                helper="If the cart is heavier than this, checkout will not make shipping free."
                label="Maximum cart weight"
                min="0"
                name="maxWeight"
                step="0.1"
                suffix="lb"
                type="number"
              />
              <Field
                defaultValue={String(rule.maxQuantity)}
                helper="If the cart has more items than this, checkout will not make shipping free."
                label="Maximum item quantity"
                min="0"
                name="maxQuantity"
                step="1"
                type="number"
              />
            </div>
            <input name="weightUnit" type="hidden" value="lb" />
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>3</span>
              <div>
                <h3 className={styles.panelTitle}>Prevent discount stacking</h3>
                <p className={styles.panelText}>
                  Keep these on if free shipping should not combine with coupon
                  codes or other promotions.
                </p>
              </div>
            </div>

            <div className={styles.toggleGrid}>
              <Checkbox
                defaultChecked={rule.config.blockDiscountCodes}
                helper="If a customer enters any code, this free shipping offer will not apply."
                label="Block discount codes"
                name="blockDiscountCodes"
              />
              <Checkbox
                defaultChecked={rule.config.blockOrderDiscounts}
                helper="Avoid combining with order-wide promotions."
                label="Block order discounts"
                name="blockOrderDiscounts"
              />
              <Checkbox
                defaultChecked={rule.config.blockProductDiscounts}
                helper="Avoid combining with discounts on specific products."
                label="Block product discounts"
                name="blockProductDiscounts"
              />
              <Checkbox
                defaultChecked={rule.config.blockShippingDiscounts}
                helper="Avoid combining with other shipping promotions."
                label="Block shipping discounts"
                name="blockShippingDiscounts"
              />
            </div>
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>4</span>
              <div>
                <h3 className={styles.panelTitle}>Choose shipping rates</h3>
                <p className={styles.panelText}>
                  Most stores should make only the cheapest standard rate free.
                </p>
              </div>
            </div>

            <div className={styles.fieldGrid}>
              <SelectField
                defaultValue={rule.config.applyMode}
                helper="Cheapest standard rate is safest because it avoids making premium rates free."
                label="Which shipping rate becomes free?"
                name="applyMode"
              >
                <option value="CHEAPEST_ELIGIBLE">
                  Cheapest eligible shipping rate
                </option>
                <option value="MATCHING_TITLE">
                  Only rates matching a name below
                </option>
                <option value="ALL_ELIGIBLE">All eligible shipping rates</option>
              </SelectField>
              <Field
                defaultValue={rule.config.shippingTitleMatchValue}
                helper="Optional. Use this when only rates containing words like Ground or Standard should qualify."
                label="Shipping rate name contains"
                name="shippingTitleMatchValue"
              />
              <Field
                defaultValue={rule.config.excludedTitleTerms.join(", ")}
                helper="Rates with these words stay paid unless you explicitly allow expedited shipping."
                label="Always exclude rate names containing"
                name="excludedTitleTerms"
              />
            </div>

            <Checkbox
              defaultChecked={rule.config.allowExpedited}
              helper="Leave this off unless you want overnight, express, air, or next-day rates to become free."
              label="Allow expedited shipping to become free"
              name="allowExpedited"
            />
            <input
              name="shippingTitleMatchType"
              type="hidden"
              value={rule.config.shippingTitleMatchType || "CONTAINS"}
            />
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>5</span>
              <div>
                <h3 className={styles.panelTitle}>Cart progress message</h3>
                <p className={styles.panelText}>
                  Optional storefront messaging. The checkout Function is still
                  the final source of truth.
                </p>
              </div>
            </div>

            <Checkbox
              defaultChecked={rule.config.progressBarEnabled}
              helper="Shows messages like how much more a customer needs to spend. You still need to enable the theme app block in the theme editor."
              label="Use progress bar messaging"
              name="progressBarEnabled"
            />
          </section>

          <details className={styles.advancedPanel}>
            <summary className={styles.advancedSummary}>
              Advanced rules
              <span>
                Product tags, customer tags, countries, states, currency, and
                regex matching.
              </span>
            </summary>
            <div className={styles.advancedBody}>
              <div className={styles.fieldGrid}>
                <Field
                  defaultValue={rule.name}
                  helper="Internal name for your team. Customers do not see this."
                  label="Internal rule name"
                  name="name"
                />
                <Field
                  defaultValue={rule.config.currencyCode}
                  helper="Only apply this rule when checkout is using this currency."
                  label="Currency code"
                  name="currencyCode"
                />
                <SelectField
                  defaultValue={rule.config.shippingTitleMatchType}
                  helper="How the shipping rate name field should match."
                  label="Shipping name match style"
                  name="shippingTitleMatchType"
                >
                  <option value="CONTAINS">Contains</option>
                  <option value="EXACT">Exact match</option>
                  <option value="STARTS_WITH">Starts with</option>
                  <option value="NONE">Ignore name matching</option>
                  <option value="REGEX">Regex</option>
                </SelectField>
                <SelectField
                  defaultValue={rule.config.countMode}
                  helper="Most stores should count every item in the cart."
                  label="Quantity count mode"
                  name="countMode"
                >
                  <option value="ALL">Count all items</option>
                  <option value="MATCHING_PRODUCT_TAGS">
                    Only count products with selected tags
                  </option>
                </SelectField>
                <Field
                  defaultValue={rule.config.eligibleProductTags.join(", ")}
                  helper="Optional comma-separated product tags."
                  label="Eligible product tags"
                  name="eligibleProductTags"
                />
                <Field
                  defaultValue={rule.config.excludedProductTags.join(", ")}
                  helper="Products with these tags should not count toward the offer."
                  label="Excluded product tags"
                  name="excludedProductTags"
                />
                <Field
                  defaultValue={rule.config.excludedCollectionIds.join(", ")}
                  helper="Optional Shopify collection IDs to exclude."
                  label="Excluded collections"
                  name="excludedCollectionIds"
                />
                <Field
                  defaultValue={rule.config.eligibleCountries.join(", ")}
                  helper="Optional country codes such as US or CA. Blank means all countries."
                  label="Eligible countries"
                  name="eligibleCountries"
                />
                <Field
                  defaultValue={rule.config.eligibleStates.join(", ")}
                  helper="Optional state or province codes such as CA or NY."
                  label="Eligible states"
                  name="eligibleStates"
                />
                <Field
                  defaultValue={rule.config.customerTagInclude.join(", ")}
                  helper="Optional customer tags that must be present."
                  label="Customer tags to include"
                  name="customerTagInclude"
                />
                <Field
                  defaultValue={rule.config.customerTagExclude.join(", ")}
                  helper="Optional customer tags that block the offer."
                  label="Customer tags to exclude"
                  name="customerTagExclude"
                />
              </div>

              <div className={styles.toggleGrid}>
                <Checkbox
                  defaultChecked={rule.config.testMode}
                  helper="Save the configuration while your team validates behavior."
                  label="Test mode"
                  name="testMode"
                />
                <Checkbox
                  defaultChecked={rule.config.regexEnabled}
                  helper="Only enable if your team knows exactly what the expression should match."
                  label="Enable regex matching"
                  name="regexEnabled"
                />
              </div>
            </div>
          </details>
        </fetcher.Form>

        <aside className={styles.sidePanel}>
          <div>
            <p className={styles.eyebrow}>Current policy</p>
            <h3 className={styles.panelTitle}>
              {rule.config.enabled ? "Enabled" : "Paused"}
            </h3>
            <p className={styles.panelText}>
              This is what the checkout Function will enforce after saving.
            </p>
          </div>
          <div className={styles.statusList}>
            <StatusRow label="Subtotal" value={`$${rule.minSubtotal}`} />
            <StatusRow label="Weight cap" value={`${rule.maxWeightLb} lb`} />
            <StatusRow
              label="Quantity cap"
              value={`${rule.maxQuantity} items`}
            />
            <StatusRow
              label="Shipping rate"
              value={labelForApplyMode(rule.config.applyMode)}
            />
            <StatusRow
              label="Discount codes"
              value={rule.config.blockDiscountCodes ? "Blocked" : "Allowed"}
            />
            <StatusRow
              label="Expedited rates"
              value={rule.config.allowExpedited ? "Can be free" : "Stay paid"}
            />
          </div>
          <div className={styles.testNotice}>
            Quick test: build a cart over ${rule.minSubtotal}, under{" "}
            {rule.maxWeightLb} lb, with {rule.maxQuantity} or fewer items and
            no discount code.
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({
  defaultValue,
  helper,
  label,
  min,
  name,
  prefix,
  step,
  suffix,
  type = "text",
}: {
  defaultValue: string;
  helper: string;
  label: string;
  min?: string;
  name: string;
  prefix?: string;
  step?: string;
  suffix?: string;
  type?: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.inputWrap}>
        {prefix && <span className={styles.inputAffix}>{prefix}</span>}
        <input
          className={styles.textInput}
          defaultValue={defaultValue}
          min={min}
          name={name}
          step={step}
          type={type}
        />
        {suffix && <span className={styles.inputAffix}>{suffix}</span>}
      </span>
      <span className={styles.fieldHelp}>{helper}</span>
    </label>
  );
}

function SelectField({
  children,
  defaultValue,
  helper,
  label,
  name,
}: {
  children: ReactNode;
  defaultValue: string;
  helper: string;
  label: string;
  name: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <select className={styles.textInput} defaultValue={defaultValue} name={name}>
        {children}
      </select>
      <span className={styles.fieldHelp}>{helper}</span>
    </label>
  );
}

function Checkbox({
  defaultChecked,
  helper,
  label,
  name,
}: {
  defaultChecked: boolean;
  helper: string;
  label: string;
  name: string;
}) {
  const id = `setting-${name}`;

  return (
    <>
      <input name={name} type="hidden" value="false" />
      <div className={styles.checkCard}>
        <input
          className={styles.checkbox}
          defaultChecked={defaultChecked}
          id={id}
          name={name}
          type="checkbox"
          value="true"
        />
        <label htmlFor={id}>
          <span className={styles.checkLabel}>{label}</span>
          <span className={styles.fieldHelp}>{helper}</span>
        </label>
      </div>
    </>
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

function labelForApplyMode(mode: string) {
  if (mode === "ALL_ELIGIBLE") return "All matching";
  if (mode === "MATCHING_TITLE") return "Named rates only";
  return "Cheapest eligible";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
