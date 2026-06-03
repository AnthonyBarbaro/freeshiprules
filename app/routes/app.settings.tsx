import type { ReactNode } from "react";
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import { functionConfigFromRuleSet } from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";
import styles from "../styles/app-shell.module.css";

type ProductSelection = {
  handle: string;
  id?: string;
  title: string;
};

type PickerProduct = {
  handle?: string;
  id?: string;
  product?: {
    handle?: string;
  };
  title?: string;
};

declare global {
  interface Window {
    shopify?: {
      resourcePicker?: (options: {
        action?: "add" | "select";
        filter?: {
          variants?: boolean;
        };
        multiple?: boolean | number;
        selectionIds?: Array<{ id: string }>;
        type: "product";
      }) => Promise<PickerProduct[] | undefined>;
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, ruleSet } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });

  const config = functionConfigFromRuleSet(ruleSet);

  return {
    shopDomain: session.shop,
    billingStatus: shop.billingStatus,
    billingActive: billingIsActive(shop.billingStatus),
    rule: {
      id: ruleSet.id,
      name: ruleSet.name,
      minSubtotal: (ruleSet.minSubtotalCents / 100).toFixed(2),
      maxWeightLb: (ruleSet.maxWeightGrams / 453.59237).toFixed(1),
      maxQuantity: ruleSet.maxQuantity,
      updatedAt: ruleSet.updatedAt.toISOString(),
      config,
    },
  };
};

export default function Settings() {
  const { billingActive, billingStatus, rule, shopDomain } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const saving = fetcher.state !== "idle";
  const canSave = billingActive && !saving;
  const subtotalSummary = rule.config.minSubtotalEnabled
    ? `$${rule.minSubtotal}`
    : "No minimum";
  const weightSummary = rule.config.maxWeightEnabled
    ? `${rule.maxWeightLb} lb`
    : "No limit";
  const quantitySummary = rule.config.maxQuantityEnabled
    ? `${rule.maxQuantity} items`
    : "No limit";
  const statusSummary = rule.config.enabled ? "On" : "Paused";
  const stackingSummary = rule.config.blockDiscountCodes
    ? "Codes blocked"
    : "Codes allowed";
  const progressStatus = !rule.config.progressBarEnabled
    ? "Off"
    : rule.config.enabled
      ? "Ready"
      : "Paused";
  const targetingSummary = productTargetingSummary(
    rule.config.productTargetingMode,
  );

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Settings</p>
          <h2 className={styles.pageTitle}>Free shipping settings</h2>
          <p className={styles.pageText}>
            Set the offer, the cart limits, and which shipping rates can become
            free.
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
          Billing is {billingStatus}. Saving stays locked until billing is
          approved or testing bypass is enabled.{" "}
          <Link to="/app/billing">Open billing</Link>
        </div>
      )}

      <div className={styles.settingsSummary}>
        <SummaryPill
          label="Status"
          tone={rule.config.enabled ? "good" : "muted"}
          value={statusSummary}
        />
        <SummaryPill label="Cart goal" value={subtotalSummary} />
        <SummaryPill label="Weight" value={weightSummary} />
        <SummaryPill label="Items" value={quantitySummary} />
        <SummaryPill label="Discounts" value={stackingSummary} />
        <SummaryPill label="Products" value={targetingSummary} />
        <SummaryPill
          label="Rate"
          value={labelForApplyMode(rule.config.applyMode)}
        />
      </div>

      <fetcher.Form
        action="/api/rules"
        className={styles.settingsForm}
        id="rules-form"
        method="post"
      >
        <section className={styles.simpleCard}>
          <SectionHeading
            title="Basic offer"
            text="Start here. These settings control whether the offer appears and what customers see."
          />

          <div className={styles.compactToggleGrid}>
            <Checkbox
              defaultChecked={rule.config.enabled}
              helper="Turn off to pause free shipping."
              label="Offer is active"
              name="enabled"
            />
            <Checkbox
              defaultChecked={rule.config.testMode}
              helper="Use while testing, then turn off for launch."
              label='Testing lock: require "freeship"'
              name="testMode"
            />
          </div>

          <div className={styles.fieldGrid}>
            <Field
              defaultValue={rule.config.offerName}
              helper='Use "freeship" while the testing lock is on.'
              label="Offer name"
              name="offerName"
            />
            <Field
              defaultValue={rule.config.message}
              label="Checkout message"
              name="message"
            />
          </div>
        </section>

        <section className={styles.simpleCard}>
          <SectionHeading
            title="Cart rules"
            text="Turn on only the limits you want shoppers to meet."
          />

          <div className={styles.limitGrid}>
            <LimitCard
              defaultEnabled={rule.config.minSubtotalEnabled}
              helper="Turn off for no minimum."
              label="Minimum subtotal"
              name="minSubtotalEnabled"
            >
              {(enabled) => (
                <Field
                  defaultValue={rule.minSubtotal}
                  disabled={!enabled}
                  label="Amount"
                  min="0"
                  name="minSubtotal"
                  prefix="$"
                  step="0.01"
                  type="number"
                />
              )}
            </LimitCard>

            <LimitCard
              defaultEnabled={rule.config.maxWeightEnabled}
              helper="Turn off for no weight limit."
              label="Weight cap"
              name="maxWeightEnabled"
            >
              {(enabled) => (
                <Field
                  defaultValue={rule.maxWeightLb}
                  disabled={!enabled}
                  label="Max weight"
                  min="0"
                  name="maxWeight"
                  step="0.1"
                  suffix="lb"
                  type="number"
                />
              )}
            </LimitCard>

            <LimitCard
              defaultEnabled={rule.config.maxQuantityEnabled}
              helper="Turn off for no item limit."
              label="Item cap"
              name="maxQuantityEnabled"
            >
              {(enabled) => (
                <Field
                  defaultValue={String(rule.maxQuantity)}
                  disabled={!enabled}
                  label="Max items"
                  min="0"
                  name="maxQuantity"
                  step="1"
                  type="number"
                />
              )}
            </LimitCard>
          </div>
          <input name="weightUnit" type="hidden" value="lb" />
        </section>

        <section className={styles.simpleCard}>
          <SectionHeading
            title="Product targeting"
            text="Choose whether selected products unlock free shipping or are the only products that count toward the cart rules."
          />

          <div className={styles.fieldGrid}>
            <SelectField
              defaultValue={rule.config.productTargetingMode}
              helper="Use all products unless the offer is tied to specific items."
              label="Eligible products"
              name="productTargetingMode"
            >
              <option value="ALL">All products</option>
              <option value="ANY_SELECTED">
                Cart contains a selected product
              </option>
              <option value="SELECTED_SUBTOTAL">
                Only selected products count toward limits
              </option>
              <option value="ALL_SELECTED">
                Every product in cart must be selected
              </option>
            </SelectField>
            <ProductPickerField
              defaultProducts={productsFromRuleConfig(rule.config)}
            />
            <input name="eligibleProductTypes" type="hidden" value="" />
            <input name="eligibleProductVendors" type="hidden" value="" />
          </div>
        </section>

        <section className={styles.simpleCard}>
          <SectionHeading
            title="Discounts and rates"
            text="Keep the offer from stacking, then choose the rate that becomes free."
          />

          <div className={styles.toggleGrid}>
            <Checkbox
              defaultChecked={rule.config.blockDiscountCodes}
              label="Block discount codes"
              name="blockDiscountCodes"
            />
            <Checkbox
              defaultChecked={rule.config.blockOrderDiscounts}
              label="Block order discounts"
              name="blockOrderDiscounts"
            />
            <Checkbox
              defaultChecked={rule.config.blockProductDiscounts}
              label="Block product discounts"
              name="blockProductDiscounts"
            />
            <Checkbox
              defaultChecked={rule.config.blockShippingDiscounts}
              label="Block shipping discounts"
              name="blockShippingDiscounts"
            />
          </div>

          <div className={styles.fieldGrid}>
            <SelectField
              defaultValue={rule.config.applyMode}
              helper="Cheapest eligible is safest for most stores."
              label="Free shipping applies to"
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
              helper="Optional, like Ground or Standard."
              label="Rate name contains"
              name="shippingTitleMatchValue"
            />
            <Field
              defaultValue={rule.config.excludedTitleTerms.join(", ")}
              helper="Keeps fast rates paid by default."
              label="Exclude rate names"
              name="excludedTitleTerms"
            />
          </div>

          <Checkbox
            defaultChecked={rule.config.allowExpedited}
            helper="Only enable if overnight or express rates can be free."
            label="Allow expedited shipping"
            name="allowExpedited"
          />
          <input
            name="shippingTitleMatchType"
            type="hidden"
            value={rule.config.shippingTitleMatchType || "CONTAINS"}
          />
        </section>

        <details className={styles.advancedPanel}>
          <summary className={styles.advancedSummary}>
            Storefront message
            <span>
              Optional progress bar text. Current status: {progressStatus}.
            </span>
          </summary>
          <div className={styles.advancedBody}>
            <Checkbox
              defaultChecked={rule.config.progressBarEnabled}
              helper="Shows how much more a customer needs to spend."
              label="Use progress bar messaging"
              name="progressBarEnabled"
            />
            <div className={styles.fieldGrid}>
              <Field
                defaultValue={rule.config.progressHeading}
                label="Widget heading"
                name="progressHeading"
              />
              <Field
                defaultValue={rule.config.progressAwayTemplate}
                helper="Use [amount] for remaining spend."
                label="Before qualifying"
                name="progressAwayTemplate"
              />
              <Field
                defaultValue={rule.config.progressQualifiedMessage}
                label="After qualifying"
                name="progressQualifiedMessage"
              />
              <Field
                defaultValue={rule.config.progressCodeMessage}
                label="Discount code message"
                name="progressCodeMessage"
              />
              <Field
                defaultValue={rule.config.progressWeightMessage}
                helper="Use [weight] for the cap."
                label="Weight limit message"
                name="progressWeightMessage"
              />
              <Field
                defaultValue={rule.config.progressQuantityMessage}
                helper="Use [quantity] for the cap."
                label="Quantity limit message"
                name="progressQuantityMessage"
              />
            </div>
            <div className={styles.toggleGrid}>
              <Checkbox
                defaultChecked={rule.config.progressShowEmptyCart}
                label="Show when cart is empty"
                name="progressShowEmptyCart"
              />
              <Checkbox
                defaultChecked={rule.config.progressHideWhenQualified}
                label="Hide after qualifying"
                name="progressHideWhenQualified"
              />
            </div>
            <div className={styles.actionRow}>
              <a
                className={styles.secondaryButton}
                href={themeEditorUrl(shopDomain)}
                target="_top"
              >
                Open theme editor
              </a>
            </div>
          </div>
        </details>

        <details className={styles.advancedPanel}>
          <summary className={styles.advancedSummary}>
            Advanced targeting
            <span>Countries, states, currency, name matching, and regex.</span>
          </summary>
          <div className={styles.advancedBody}>
            <div className={styles.fieldGrid}>
              <Field
                defaultValue={rule.name}
                helper='In test mode, "freeship" also unlocks checkout.'
                label="Internal rule name"
                name="name"
              />
              <Field
                defaultValue={rule.config.currencyCode}
                label="Currency code"
                name="currencyCode"
              />
              <SelectField
                defaultValue={rule.config.shippingTitleMatchType}
                label="Shipping name match style"
                name="shippingTitleMatchType"
              >
                <option value="CONTAINS">Contains</option>
                <option value="EXACT">Exact match</option>
                <option value="STARTS_WITH">Starts with</option>
                <option value="NONE">Ignore name matching</option>
                <option value="REGEX">Regex</option>
              </SelectField>
              <Field
                defaultValue={rule.config.eligibleCountries.join(", ")}
                helper="Blank means all countries."
                label="Eligible countries"
                name="eligibleCountries"
              />
              <Field
                defaultValue={rule.config.eligibleStates.join(", ")}
                helper="Optional state or province codes."
                label="Eligible states"
                name="eligibleStates"
              />
            </div>

            <div className={styles.toggleGrid}>
              <Checkbox
                defaultChecked={rule.config.regexEnabled}
                helper="Only enable when the pattern is known."
                label="Enable regex matching"
                name="regexEnabled"
              />
            </div>
          </div>
        </details>
      </fetcher.Form>
    </div>
  );
}

function ProductPickerField({
  defaultProducts,
}: {
  defaultProducts: ProductSelection[];
}) {
  const [products, setProducts] = useState(defaultProducts);
  const [manualValue, setManualValue] = useState(
    defaultProducts.map((product) => product.handle).join(", "),
  );
  const [pickerError, setPickerError] = useState("");
  const handles = parseHandles(manualValue);
  const selectedProducts: ProductSelection[] =
    products.length > 0 ? products : handles.map(productFromHandle);
  const productIds = products.flatMap((product) =>
    product.id ? [product.id] : [],
  );
  const productTitles = products.map((product) => product.title);

  async function openPicker() {
    if (typeof window === "undefined" || !window.shopify?.resourcePicker) {
      setPickerError(
        "Product picker is available inside Shopify Admin. You can paste handles below.",
      );
      return;
    }

    const selected = await window.shopify.resourcePicker({
      action: "select",
      filter: { variants: false },
      multiple: true,
      selectionIds: products
        .filter((product) => product.id)
        .map((product) => ({ id: product.id as string })),
      type: "product",
    });

    if (!selected) return;

    const nextProducts = selected
      .map(productFromPicker)
      .filter(isProductSelection);

    setProducts(nextProducts);
    setManualValue(nextProducts.map((product) => product.handle).join(", "));
    setPickerError("");
  }

  function removeProduct(handle: string) {
    const nextProducts = selectedProducts.filter(
      (product) => product.handle !== handle,
    );
    setProducts(nextProducts.filter((product) => Boolean(product.id)));
    setManualValue(nextProducts.map((product) => product.handle).join(", "));
  }

  function updateManualValue(value: string) {
    setManualValue(value);
    setProducts([]);
  }

  return (
    <div className={`${styles.field} ${styles.productPickerField}`}>
      <span className={styles.fieldLabel}>Specific products</span>
      <input
        name="eligibleProductHandles"
        type="hidden"
        value={JSON.stringify(handles)}
      />
      <input
        name="eligibleProductIds"
        type="hidden"
        value={JSON.stringify(productIds)}
      />
      <input
        name="eligibleProductTitles"
        type="hidden"
        value={JSON.stringify(productTitles)}
      />

      <div className={styles.productPickerPanel}>
        <div className={styles.productPickerActions}>
          <button
            className={styles.secondaryButton}
            onClick={openPicker}
            type="button"
          >
            Select products
          </button>
          {selectedProducts.length > 0 && (
            <button
              className={styles.textButton}
              onClick={() => {
                setProducts([]);
                setManualValue("");
              }}
              type="button"
            >
              Clear
            </button>
          )}
        </div>

        {selectedProducts.length > 0 ? (
          <div className={styles.productChipList}>
            {selectedProducts.map((product) => (
              <span className={styles.productChip} key={product.handle}>
                <span>{product.title}</span>
                <button
                  aria-label={`Remove ${product.title}`}
                  onClick={() => removeProduct(product.handle)}
                  type="button"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className={styles.fieldHelp}>
            No specific products selected.
          </span>
        )}

        {pickerError && (
          <span className={styles.fieldHelp}>{pickerError}</span>
        )}
      </div>

      <textarea
        className={`${styles.textInput} ${styles.textAreaInput}`}
        onChange={(event) => updateManualValue(event.currentTarget.value)}
        placeholder="Or paste product handles, one per line"
        value={manualValue}
      />
      <span className={styles.fieldHelp}>
        Pick products from Shopify Admin, or paste handles like long-sleeve.
      </span>
    </div>
  );
}

function SectionHeading({ text, title }: { text: string; title: string }) {
  return (
    <div className={styles.sectionHeading}>
      <h3 className={styles.panelTitle}>{title}</h3>
      <p className={styles.panelText}>{text}</p>
    </div>
  );
}

function SummaryPill({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "good" | "muted";
  value: string;
}) {
  const toneClass =
    tone === "good"
      ? styles.summaryPillGood
      : tone === "muted"
        ? styles.summaryPillMuted
        : "";

  return (
    <div className={`${styles.summaryPill} ${toneClass}`}>
      <span className={styles.summaryLabel}>{label}</span>
      <strong className={styles.summaryValue}>{value}</strong>
    </div>
  );
}

function Field({
  defaultValue,
  disabled = false,
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
  disabled?: boolean;
  helper?: string;
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
        {disabled && <input name={name} type="hidden" value={defaultValue} />}
        <input
          className={styles.textInput}
          defaultValue={defaultValue}
          disabled={disabled}
          min={min}
          name={name}
          step={step}
          type={type}
        />
        {suffix && <span className={styles.inputAffix}>{suffix}</span>}
      </span>
      {helper && <span className={styles.fieldHelp}>{helper}</span>}
    </label>
  );
}

function LimitCard({
  children,
  defaultEnabled,
  helper,
  label,
  name,
}: {
  children: (enabled: boolean) => ReactNode;
  defaultEnabled: boolean;
  helper?: string;
  label: string;
  name: string;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const id = `setting-${name}`;

  return (
    <div
      className={`${styles.limitCard} ${
        enabled ? "" : styles.limitCardDisabled
      }`}
    >
      <input name={name} type="hidden" value="false" />
      <div className={styles.checkCard}>
        <input
          checked={enabled}
          className={styles.checkbox}
          id={id}
          name={name}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          type="checkbox"
          value="true"
        />
        <label htmlFor={id}>
          <span className={styles.checkLabel}>{label}</span>
          {helper && <span className={styles.fieldHelp}>{helper}</span>}
        </label>
      </div>
      {children(enabled)}
    </div>
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
  helper?: string;
  label: string;
  name: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <select
        className={styles.textInput}
        defaultValue={defaultValue}
        name={name}
      >
        {children}
      </select>
      {helper && <span className={styles.fieldHelp}>{helper}</span>}
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
  helper?: string;
  label: string;
  name: string;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const id = `setting-${name}`;

  return (
    <>
      <input name={name} type="hidden" value="false" />
      <div
        className={`${styles.checkCard} ${
          checked ? "" : styles.checkCardDisabled
        }`}
      >
        <input
          checked={checked}
          className={styles.checkbox}
          id={id}
          name={name}
          onChange={(event) => setChecked(event.currentTarget.checked)}
          type="checkbox"
          value="true"
        />
        <label htmlFor={id}>
          <span className={styles.checkLabel}>{label}</span>
          {helper && <span className={styles.fieldHelp}>{helper}</span>}
        </label>
      </div>
    </>
  );
}

function labelForApplyMode(mode: string) {
  if (mode === "ALL_ELIGIBLE") return "All matching";
  if (mode === "MATCHING_TITLE") return "Named rates only";
  return "Cheapest eligible";
}

function productTargetingSummary(mode: string) {
  if (mode === "ANY_SELECTED") return "Contains selected";
  if (mode === "SELECTED_SUBTOTAL") return "Selected count";
  if (mode === "ALL_SELECTED") return "Only selected";
  return "All products";
}

function productsFromRuleConfig(config: {
  eligibleProductHandles: string[];
  eligibleProductIds?: string[];
  eligibleProductTitles?: string[];
}) {
  return config.eligibleProductHandles.map((handle, index) => ({
    handle,
    id: config.eligibleProductIds?.[index],
    title: config.eligibleProductTitles?.[index] || handle,
  }));
}

function productFromPicker(product: PickerProduct): ProductSelection | null {
  const handle = sanitizeHandle(product.handle || product.product?.handle);
  if (!handle) return null;

  const selection: ProductSelection = {
    handle,
    title: product.title || handle,
  };
  if (product.id) selection.id = product.id;
  return selection;
}

function productFromHandle(handle: string): ProductSelection {
  return {
    handle,
    title: handle,
  };
}

function isProductSelection(
  product: ProductSelection | null,
): product is ProductSelection {
  return Boolean(product);
}

function parseHandles(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/g)
        .map(sanitizeHandle)
        .filter(Boolean),
    ),
  );
}

function sanitizeHandle(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/^https?:\/\/[^/]+\/products\//i, "")
    .split(/[?#]/)[0]
    .trim()
    .toLowerCase();
}

function themeEditorUrl(shopDomain: string) {
  const handle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps`;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
