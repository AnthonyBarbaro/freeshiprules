import type { ChangeEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { billingIsActive } from "../services/shop.server";
import {
  getShippingProtectionForShopDomain,
  shippingProtectionConfigFromRecord,
  shippingProtectionVariantMapFromRecord,
} from "../services/shipping-protection.server";
import {
  MAX_PROTECTION_VARIANTS,
  computeShippingProtectionPriceCents,
  centsToDecimal,
  moneyLabel,
  requiredProtectionVariantAmounts,
  type ShippingProtectionFormula,
  type ShippingProtectionOptions,
  type ShippingProtectionPricingMode,
  type ShippingProtectionTier,
} from "../services/shipping-protection-config";
import styles from "../styles/app-shell.module.css";

type ProtectionActionData = {
  ok?: boolean;
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const record = await getShippingProtectionForShopDomain(session.shop);
  if (!record) throw new Response("Shop not found", { status: 404 });

  const config = shippingProtectionConfigFromRecord(record.shippingProtection);
  const variantMap = shippingProtectionVariantMapFromRecord(
    record.shippingProtection,
  );

  return {
    shopDomain: session.shop,
    billingStatus: record.shop.billingStatus,
    billingActive: billingIsActive(record.shop.billingStatus),
    settings: {
      id: record.shippingProtection.id,
      productId: record.shippingProtection.productId,
      syncError: record.shippingProtection.syncError,
      syncedAt: record.shippingProtection.syncedAt?.toISOString() ?? null,
      updatedAt: record.shippingProtection.updatedAt.toISOString(),
    },
    config,
    variantCount: Object.keys(variantMap).length,
    requiredVariantCount: requiredProtectionVariantAmounts(config).length,
  };
};

export default function ShippingProtection() {
  const {
    billingActive,
    billingStatus,
    config,
    settings,
    shopDomain,
    variantCount,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ProtectionActionData>();
  const saving = fetcher.state !== "idle";
  const canSave = billingActive && !saving;
  const [enabled, setEnabled] = useState(config.enabled);
  const [pricingMode, setPricingMode] = useState<ShippingProtectionPricingMode>(
    config.pricingMode,
  );
  const [productTitle, setProductTitle] = useState(config.productTitle);
  const [widgetHeading, setWidgetHeading] = useState(config.widgetHeading);
  const [widgetDescription, setWidgetDescription] = useState(
    config.widgetDescription,
  );
  const [optInLabel, setOptInLabel] = useState(config.optInLabel);
  const [defaultSelected, setDefaultSelected] = useState(
    config.defaultSelected,
  );
  const [options, setOptions] = useState(config.options);
  const [percentageRate, setPercentageRate] = useState(
    percentFromFormula(config.formula),
  );
  const [incrementAmount, setIncrementAmount] = useState(
    centsToDecimal(config.formula.amountCents),
  );
  const [minimumCharge, setMinimumCharge] = useState(
    centsToDecimal(config.formula.minChargeCents),
  );
  const [maximumCharge, setMaximumCharge] = useState(
    centsToDecimal(config.formula.maxChargeCents),
  );
  const [fixedAmount, setFixedAmount] = useState(
    centsToDecimal(firstTierAmount(config.tiers)),
  );
  const [previewSubtotal, setPreviewSubtotal] = useState("200.00");
  const formula = useMemo(
    () =>
      formulaFromPercentage(
        percentageRate,
        incrementAmount,
        minimumCharge,
        maximumCharge,
      ),
    [incrementAmount, maximumCharge, minimumCharge, percentageRate],
  );
  const fixedTiers = useMemo(
    () => fixedTierFromAmount(fixedAmount),
    [fixedAmount],
  );
  const preview = useMemo(
    () =>
      buildPreview(
        pricingMode,
        pricingMode === "FORMULA" ? config.tiers : fixedTiers,
        pricingMode === "FORMULA" ? formula : config.formula,
        centsFromDollars(previewSubtotal),
      ),
    [
      config.formula,
      config.tiers,
      fixedTiers,
      formula,
      previewSubtotal,
      pricingMode,
    ],
  );
  const requiredVariantCount =
    pricingMode === "FORMULA" ? preview.variantCount : fixedTiers.length;
  const live = enabled && Boolean(settings.productId) && variantCount > 0;
  const updateOption = <Key extends keyof ShippingProtectionOptions>(
    key: Key,
    value: ShippingProtectionOptions[Key],
  ) => setOptions((current) => ({ ...current, [key]: value }));

  return (
    <div className={styles.widgetSetupPage}>
      <header className={styles.widgetSetupHeader}>
        <div>
          <h2 className={styles.pageTitle}>Widget Setup</h2>
          <p className={styles.pageText}>
            Keep the cart protection offer simple, priced correctly, and ready
            inside the cart drawer.
          </p>
        </div>
        <div className={styles.actionRow}>
          <a
            className={styles.secondaryButton}
            href={themeEditorUrl(shopDomain)}
            target="_top"
          >
            Theme editor
          </a>
          <button
            className={styles.primaryButton}
            disabled={!canSave}
            form="shipping-protection-form"
            name="_action"
            type="submit"
            value="save"
          >
            {saving ? "Saving" : "Save setup"}
          </button>
        </div>
      </header>

      {fetcher.data?.ok && (
        <div className={styles.successNotice}>Widget setup saved.</div>
      )}

      {fetcher.data?.error && (
        <div className={styles.criticalNotice}>{fetcher.data.error}</div>
      )}

      {settings.syncError && (
        <div className={styles.criticalNotice}>{settings.syncError}</div>
      )}

      {!billingActive && (
        <div className={styles.notice}>
          Billing is {billingStatus}. Approve billing or enable testing bypass
          before saving changes. <Link to="/app/billing">Open billing</Link>
        </div>
      )}

      <div className={styles.widgetSetupGrid}>
        <fetcher.Form
          action="/api/shipping-protection"
          className={styles.widgetSetupForm}
          id="shipping-protection-form"
          method="post"
        >
          <input
            name="formulaAmount"
            type="hidden"
            value={centsToDecimal(formula.amountCents)}
          />
          <input
            name="formulaEvery"
            type="hidden"
            value={centsToDecimal(formula.everyCents)}
          />
          <input
            name="formulaMinCharge"
            type="hidden"
            value={centsToDecimal(formula.minChargeCents)}
          />
          <input
            name="formulaMaxCharge"
            type="hidden"
            value={centsToDecimal(formula.maxChargeCents)}
          />
          <input
            name="tiersJson"
            type="hidden"
            value={JSON.stringify(fixedTiers)}
          />
          <input
            name="optionsJson"
            type="hidden"
            value={JSON.stringify(options)}
          />

          <section
            className={`${styles.setupLiveCard} ${
              live ? styles.setupLiveCardOn : styles.setupLiveCardOff
            }`}
          >
            <div className={styles.setupLiveBar}>
              <span className={styles.liveDot} aria-hidden="true" />
              <strong>
                {live
                  ? "Shipping protection is live"
                  : enabled
                    ? "Shipping protection needs sync"
                    : "Shipping protection is off"}
              </strong>
            </div>
            <div className={styles.setupLiveBody}>
              <div>
                <p className={styles.panelText}>
                  {enabled
                    ? "Deactivate the app embed in your Shopify theme editor to remove the widget from the live theme."
                    : "Turn the widget on, save, then enable the theme app embed in Shopify."}
                </p>
                <div className={styles.miniStatusGrid}>
                  <StatusPill
                    label="Product"
                    value={settings.productId ? "Created" : "Missing"}
                  />
                  <StatusPill
                    label="Prices"
                    value={`${variantCount}/${requiredVariantCount}`}
                  />
                  <StatusPill
                    label="Last sync"
                    value={
                      settings.syncedAt ? shortDate(settings.syncedAt) : "Never"
                    }
                  />
                </div>
              </div>
              <Checkbox
                checked={enabled}
                compact
                helper="Saving while enabled syncs the Shopify protection product and price variants."
                label="Live widget"
                name="enabled"
                onChange={setEnabled}
              />
            </div>
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.panelTitle}>Widget style</h3>
              <p className={styles.panelText}>
                Keep the live widget simple while still matching the cart
                drawer.
              </p>
            </div>
            <div className={styles.choiceGrid}>
              <ChoiceCard
                checked={options.layoutMode === "BUTTON"}
                description="Use a button-style protection offer."
                label="Button"
                name="layoutMode"
                onChange={() => updateOption("layoutMode", "BUTTON")}
                value="BUTTON"
              />
              <ChoiceCard
                checked={options.layoutMode === "TOGGLE"}
                description="Use a cart-safe opt-in toggle."
                label="Toggle / Checkbox"
                name="layoutMode"
                onChange={() => updateOption("layoutMode", "TOGGLE")}
                value="TOGGLE"
              />
            </div>
            <div className={styles.styleSummaryGrid}>
              <div className={styles.styleSummaryItem}>
                <span className={styles.protectionShield} aria-hidden="true">
                  <ShieldIcon />
                </span>
                <div>
                  <strong>Shield icon</strong>
                  <span>Used in the widget and protection product.</span>
                </div>
              </div>
              <div className={styles.styleSummaryItem}>
                <span className={styles.togglePreview} aria-hidden="true">
                  <span />
                </span>
                <div>
                  <strong>Toggle layout</strong>
                  <span>Updates the cart line item in place.</span>
                </div>
              </div>
            </div>
            <Checkbox
              checked={options.showIcon}
              helper="Show the shield beside the protection copy."
              label="Show shield icon"
              name="showIcon"
              onChange={(checked) => updateOption("showIcon", checked)}
            />
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.panelTitle}>Widget text</h3>
              <p className={styles.panelText}>
                Short copy works best in a drawer. The storefront preview
                updates as you type.
              </p>
            </div>
            <div className={styles.fieldGrid}>
              <TextField
                helper="Shopify product name used for the protection line."
                label="Product name"
                name="productTitle"
                onChange={setProductTitle}
                value={productTitle}
              />
              <TextField
                helper="Main title in the widget."
                label="Heading"
                name="widgetHeading"
                onChange={setWidgetHeading}
                value={widgetHeading}
              />
              <TextField
                helper="Pill text when the customer has not opted in."
                label="Opt-in wording"
                name="optInLabel"
                onChange={setOptInLabel}
                value={optInLabel}
              />
              <TextField
                helper="Button layout text. Use {{price}} or {{priceandtotal}}."
                label="Button text"
                name="buttonTextPreview"
                onChange={(value) => updateOption("buttonText", value)}
                value={options.buttonText}
              />
              <TextField
                helper="Shown while the cart updates."
                label="Loading button"
                name="loadingTextPreview"
                onChange={(value) => updateOption("loadingText", value)}
                value={options.loadingText}
              />
              <TextField
                helper="Button text weight."
                label="Button font weight"
                min="300"
                name="buttonFontWeightPreview"
                onChange={(value) =>
                  updateOption(
                    "buttonFontWeight",
                    integerFromInput(value, options.buttonFontWeight),
                  )
                }
                step="100"
                type="number"
                value={String(options.buttonFontWeight)}
              />
              <TextField
                helper="Button text size."
                label="Button font size"
                min="10"
                name="buttonFontSizePreview"
                onChange={(value) =>
                  updateOption(
                    "buttonFontSize",
                    integerFromInput(value, options.buttonFontSize),
                  )
                }
                suffix="px"
                type="number"
                value={String(options.buttonFontSize)}
              />
              <TextAreaField
                helper="One sentence below the heading."
                label="Opt-out message"
                name="widgetDescription"
                onChange={setWidgetDescription}
                value={widgetDescription}
              />
            </div>
            <div className={styles.styleControlGrid}>
              <TextField
                helper="Primary button background."
                label="Background"
                name="backgroundColorPreview"
                onChange={(value) => updateOption("backgroundColor", value)}
                type="color"
                value={options.backgroundColor}
              />
              <TextField
                helper="Button border or outline."
                label="Outline"
                name="outlineColorPreview"
                onChange={(value) => updateOption("outlineColor", value)}
                type="color"
                value={options.outlineColor}
              />
              <TextField
                helper="Price text color on button layouts."
                label="Price"
                name="priceColorPreview"
                onChange={(value) => updateOption("priceColor", value)}
                type="color"
                value={options.priceColor}
              />
              <TextField
                helper="Widget corner radius."
                label="Corners"
                min="0"
                name="cornerRadiusPreview"
                onChange={(value) =>
                  updateOption(
                    "cornerRadius",
                    integerFromInput(value, options.cornerRadius),
                  )
                }
                suffix="px"
                type="number"
                value={String(options.cornerRadius)}
              />
              <SelectField
                helper="Where the widget should sit in cart areas."
                label="Widget position"
                name="widgetPositionPreview"
                onChange={(value) =>
                  updateOption(
                    "widgetPosition",
                    value === "INLINE" ? "INLINE" : "ABOVE_CHECKOUT",
                  )
                }
                value={options.widgetPosition}
              >
                <option value="ABOVE_CHECKOUT">Above checkout</option>
                <option value="INLINE">Theme position</option>
              </SelectField>
              <SelectField
                helper="Text alignment inside the widget."
                label="Text alignment"
                name="textAlignmentPreview"
                onChange={(value) =>
                  updateOption(
                    "textAlignment",
                    value === "LEFT" ? "LEFT" : "CENTER",
                  )
                }
                value={options.textAlignment}
              >
                <option value="CENTER">Center</option>
                <option value="LEFT">Left</option>
              </SelectField>
            </div>
            <Checkbox
              checked={defaultSelected}
              helper="Leave this off unless preselecting order protection is allowed for your store."
              label="Preselect protection in the cart"
              name="defaultSelected"
              onChange={setDefaultSelected}
            />
            <Checkbox
              checked={options.showChevron}
              helper="Show the small arrow in button-style previews."
              label="Show chevron"
              name="showChevron"
              onChange={(checked) => updateOption("showChevron", checked)}
            />
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.panelTitle}>Pricing</h3>
              <p className={styles.panelText}>
                Percentage pricing scales with cart value. Fixed pricing keeps
                one flat protection price.
              </p>
            </div>
            <div className={styles.choiceGrid}>
              <ChoiceCard
                checked={pricingMode === "FORMULA"}
                description="Charge a percentage of cart value."
                label="Percentage"
                name="pricingMode"
                onChange={() => setPricingMode("FORMULA")}
                value="FORMULA"
              />
              <ChoiceCard
                checked={pricingMode === "TIERED"}
                description="Charge a fixed protection price."
                label="Fixed"
                name="pricingMode"
                onChange={() => setPricingMode("TIERED")}
                value="TIERED"
              />
            </div>

            {pricingMode === "FORMULA" ? (
              <div className={styles.fieldGrid}>
                <TextField
                  helper="Example: 10 charges about 10% of cart value."
                  label="Insurance pricing"
                  min="0.01"
                  name="percentageRatePreview"
                  onChange={setPercentageRate}
                  step="0.01"
                  suffix="%"
                  type="number"
                  value={percentageRate}
                />
                <TextField
                  helper="The smallest protection charge."
                  label="Minimum charge"
                  min="0"
                  name="minimumChargePreview"
                  onChange={setMinimumCharge}
                  prefix="$"
                  step="0.01"
                  type="number"
                  value={minimumCharge}
                />
                <TextField
                  helper="Protection increases by this amount as cart value grows."
                  label="Increment amounts"
                  min="0.01"
                  name="incrementAmountPreview"
                  onChange={setIncrementAmount}
                  prefix="$"
                  step="0.01"
                  type="number"
                  value={incrementAmount}
                />
                <TextField
                  helper="Caps the highest protection price."
                  label="Maximum charge"
                  min="0"
                  name="maximumChargePreview"
                  onChange={setMaximumCharge}
                  prefix="$"
                  step="0.01"
                  type="number"
                  value={maximumCharge}
                />
              </div>
            ) : (
              <TextField
                helper="Every protected order gets this price."
                label="Fixed protection price"
                min="0.01"
                name="fixedAmountPreview"
                onChange={setFixedAmount}
                prefix="$"
                step="0.01"
                type="number"
                value={fixedAmount}
              />
            )}

            {preview.variantCount > MAX_PROTECTION_VARIANTS && (
              <div className={styles.criticalNotice}>
                This setup needs {preview.variantCount} protection prices. Lower
                the maximum charge or increase the increment amount.
              </div>
            )}
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.panelTitle}>Product and order rules</h3>
              <p className={styles.panelText}>
                Simple controls for the protection product and order handling
                behavior.
              </p>
            </div>
            <div className={styles.settingCardStack}>
              <Checkbox
                checked={options.excludeProducts}
                helper='Exclude products tagged "excludeprotect" from protection value calculations where storefront data supports it.'
                label="Exclude products from protection"
                name="excludeProducts"
                onChange={(checked) => updateOption("excludeProducts", checked)}
              />
              <Checkbox
                checked={options.markFulfilledImmediately}
                helper="Keep this on when protection should be treated as handled immediately."
                label="Mark as fulfilled immediately"
                name="markFulfilledImmediately"
                onChange={(checked) =>
                  updateOption("markFulfilledImmediately", checked)
                }
              />
              <Checkbox
                checked={options.orderTagEnabled}
                helper="Save the order tag preference for protected orders."
                label="Protected order tag"
                name="orderTagEnabled"
                onChange={(checked) => updateOption("orderTagEnabled", checked)}
              />
            </div>
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.panelTitle}>Tooltip and terms</h3>
              <p className={styles.panelText}>
                Add a short help note and an optional terms link beside the
                protection description.
              </p>
            </div>
            <Checkbox
              checked={options.offerDescriptionEnabled}
              helper="Show the protection description inside the cart widget."
              label="Offer description"
              name="offerDescriptionEnabled"
              onChange={(checked) =>
                updateOption("offerDescriptionEnabled", checked)
              }
            />
            <Checkbox
              checked={options.tooltipEnabled}
              helper="Show a compact help marker beside the widget description."
              label="Tooltip"
              name="tooltipEnabled"
              onChange={(checked) => updateOption("tooltipEnabled", checked)}
            />
            <TextAreaField
              helper="Shown when customers hover or focus the help marker."
              label="Description style"
              name="tooltipDescriptionPreview"
              onChange={(value) => updateOption("tooltipDescription", value)}
              value={options.tooltipDescription}
            />
            <div className={styles.fieldGrid}>
              <TextField
                helper="Visible text for the terms link."
                label="T&Cs link"
                name="termsLabelPreview"
                onChange={(value) => updateOption("termsLabel", value)}
                value={options.termsLabel}
              />
              <TextField
                helper="Optional terms URL."
                label="T&Cs URL"
                name="termsUrlPreview"
                onChange={(value) => updateOption("termsUrl", value)}
                type="url"
                value={options.termsUrl}
              />
            </div>
            <div className={styles.actionRow}>
              <button
                className={styles.secondaryButton}
                disabled={!canSave}
                name="_action"
                type="submit"
                value="sync"
              >
                Sync product
              </button>
            </div>
          </section>
        </fetcher.Form>

        <aside className={styles.widgetPreviewRail}>
          <div className={styles.widgetPreviewCard}>
            <p className={styles.previewTitle}>Widget Preview</p>
            <div className={styles.checkoutPreviewButton}>
              <span>Checkout</span>
              {options.showChevron && <span aria-hidden="true">›</span>}
            </div>
            <div
              className={`${styles.protectionPreviewMini} ${
                options.showIcon ? "" : styles.protectionPreviewMiniNoIcon
              }`}
            >
              {options.showIcon && (
                <span
                  className={styles.protectionShieldSmall}
                  aria-hidden="true"
                >
                  <ShieldIcon />
                </span>
              )}
              <div>
                <strong>{widgetHeading || "Shipping protection"}</strong>
                {options.offerDescriptionEnabled && (
                  <span>
                    {widgetDescription ||
                      "Protect your order from loss, damage, or theft."}
                    {options.tooltipEnabled && (
                      <b className={styles.previewTooltip}>?</b>
                    )}
                  </span>
                )}
                {options.termsUrl && (
                  <small className={styles.previewTerms}>
                    {options.termsLabel || "Learn more"}
                  </small>
                )}
              </div>
              <b>{moneyLabel(preview.priceCents)}</b>
            </div>
            <div className={styles.previewActionRow}>
              <span
                className={`${styles.previewOptIn} ${
                  options.layoutMode === "BUTTON"
                    ? styles.previewOptInButton
                    : ""
                }`}
                style={
                  options.layoutMode === "BUTTON"
                    ? {
                        background: options.backgroundColor,
                        borderColor: options.outlineColor,
                        borderRadius: `${options.cornerRadius}px`,
                        color: options.priceColor,
                        fontSize: `${options.buttonFontSize}px`,
                        fontWeight: options.buttonFontWeight,
                      }
                    : undefined
                }
              >
                {options.layoutMode === "BUTTON"
                  ? formatButtonText(
                      options.buttonText,
                      preview.priceCents,
                      centsFromDollars(previewSubtotal),
                    )
                  : defaultSelected
                    ? "Protected"
                    : optInLabel || "Add protection"}
              </span>
              {options.layoutMode === "TOGGLE" && (
                <span
                  className={`${styles.togglePreview} ${
                    defaultSelected ? styles.togglePreviewOn : ""
                  }`}
                  aria-hidden="true"
                >
                  <span />
                </span>
              )}
            </div>
            <button className={styles.previewCheckoutTotal} type="button">
              Checkout - {moneyLabel(centsFromDollars(previewSubtotal))}
            </button>
          </div>

          <div className={styles.widgetPreviewCard}>
            <TextField
              helper="Preview only. This does not save."
              label="Preview cart subtotal"
              min="0"
              name="previewSubtotal"
              onChange={setPreviewSubtotal}
              prefix="$"
              step="0.01"
              type="number"
              value={previewSubtotal}
            />
            <div className={styles.statusRow}>
              <span className={styles.rowLabel}>Protection price</span>
              <strong className={styles.rowValue}>
                {preview.priceCents > 0
                  ? moneyLabel(preview.priceCents)
                  : "Not offered"}
              </strong>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.rowLabel}>Prices needed</span>
              <strong className={styles.rowValue}>
                {preview.variantCount}
              </strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TextAreaField({
  helper,
  label,
  name,
  onChange,
  value,
}: {
  helper: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className={`${styles.field} ${styles.wideField}`}>
      <span className={styles.fieldLabel}>{label}</span>
      <textarea
        className={`${styles.textInput} ${styles.textAreaInput}`}
        name={name}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
          onChange(event.currentTarget.value)
        }
        rows={3}
        value={value}
      />
      <span className={styles.fieldHelp}>{helper}</span>
    </label>
  );
}

function TextField({
  defaultValue,
  helper,
  label,
  min,
  name,
  onChange,
  prefix,
  step,
  suffix,
  type = "text",
  value,
}: {
  defaultValue?: string;
  helper: string;
  label: string;
  min?: string;
  name: string;
  onChange?: (value: string) => void;
  prefix?: string;
  step?: string;
  suffix?: string;
  type?: string;
  value?: string;
}) {
  const inputProps =
    value === undefined
      ? { defaultValue }
      : {
          value,
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            onChange?.(event.currentTarget.value),
        };

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.inputWrap}>
        {prefix && <span className={styles.inputAffix}>{prefix}</span>}
        <input
          className={styles.textInput}
          min={min}
          name={name}
          step={step}
          type={type}
          {...inputProps}
        />
        {suffix && <span className={styles.inputAffix}>{suffix}</span>}
      </span>
      <span className={styles.fieldHelp}>{helper}</span>
    </label>
  );
}

function SelectField({
  children,
  helper,
  label,
  name,
  onChange,
  value,
}: {
  children: ReactNode;
  helper: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <select
        className={styles.textInput}
        name={name}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      >
        {children}
      </select>
      <span className={styles.fieldHelp}>{helper}</span>
    </label>
  );
}

function Checkbox({
  checked,
  compact = false,
  helper,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  compact?: boolean;
  helper: string;
  label: string;
  name: string;
  onChange?: (checked: boolean) => void;
}) {
  const [localChecked, setLocalChecked] = useState(checked);
  const actualChecked = onChange ? checked : localChecked;
  const id = `protection-${name}`;

  return (
    <>
      <input name={name} type="hidden" value="false" />
      <div
        className={`${styles.checkCard} ${compact ? styles.checkCardCompact : ""} ${
          actualChecked ? "" : styles.checkCardDisabled
        }`}
      >
        <input
          checked={actualChecked}
          className={styles.checkbox}
          id={id}
          name={name}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setLocalChecked(next);
            onChange?.(next);
          }}
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

function ChoiceCard({
  checked,
  description,
  disabled = false,
  label,
  name,
  onChange,
  value,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  name: string;
  onChange?: () => void;
  value: string;
}) {
  const id = `${name}-${value}`;

  return (
    <div
      className={`${styles.choiceCard} ${
        checked ? styles.choiceCardSelected : ""
      } ${disabled ? styles.choiceCardDisabled : ""}`}
    >
      <input
        checked={checked}
        disabled={disabled}
        id={id}
        name={name}
        onChange={onChange}
        readOnly={!onChange}
        type="radio"
        value={value}
      />
      <label className={styles.choiceCardText} htmlFor={id}>
        <strong>{label}</strong>
        <small>{description}</small>
      </label>
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statusPill}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3 5.5 5.7v5.5c0 4.2 2.7 8 6.5 9.3 3.8-1.3 6.5-5.1 6.5-9.3V5.7L12 3Z" />
      <path d="m8.8 12 2.1 2.1 4.4-5" />
    </svg>
  );
}

function buildPreview(
  pricingMode: ShippingProtectionPricingMode,
  tiers: ShippingProtectionTier[],
  formula: ShippingProtectionFormula,
  cartSubtotalCents: number,
) {
  const config = {
    enabled: true,
    pricingMode,
    tiers,
    formula,
  };

  return {
    priceCents: computeShippingProtectionPriceCents(config, cartSubtotalCents),
    variantCount: requiredProtectionVariantAmounts(config).length,
  };
}

function fixedTierFromAmount(value: string): ShippingProtectionTier[] {
  return [
    {
      minCents: 0,
      maxCents: null,
      amountCents: Math.max(1, centsFromDollars(value)),
    },
  ];
}

function firstTierAmount(tiers: ShippingProtectionTier[]) {
  return tiers.find((tier) => tier.amountCents > 0)?.amountCents ?? 100;
}

function formulaFromPercentage(
  percentageValue: string,
  incrementValue: string,
  minValue: string,
  maxValue: string,
): ShippingProtectionFormula {
  const percent = Math.max(0.01, Number(percentageValue) || 0);
  const amountCents = Math.max(1, centsFromDollars(incrementValue));
  const everyCents = Math.max(1, Math.round((amountCents * 100) / percent));

  return {
    amountCents,
    everyCents,
    minChargeCents: Math.max(0, centsFromDollars(minValue)),
    maxChargeCents: Math.max(0, centsFromDollars(maxValue)),
  };
}

function percentFromFormula(formula: ShippingProtectionFormula) {
  if (formula.everyCents <= 0) return "10";
  return trimDecimal((formula.amountCents / formula.everyCents) * 100);
}

function formatButtonText(
  template: string,
  priceCents: number,
  subtotalCents: number,
) {
  const total = Math.max(0, subtotalCents + priceCents);
  const text = template || "Checkout {{priceandtotal}}";

  return text
    .replace(/\{\{priceandtotal\}\}/gi, moneyLabel(total))
    .replace(/\{\{price\}\}/gi, moneyLabel(priceCents));
}

function integerFromInput(value: string, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function trimDecimal(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function centsFromDollars(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function themeEditorUrl(shopDomain: string) {
  const handle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps`;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
