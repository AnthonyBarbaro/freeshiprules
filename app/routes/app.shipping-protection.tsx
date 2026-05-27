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
  const [pricingMode, setPricingMode] =
    useState<ShippingProtectionPricingMode>(config.pricingMode);
  const [tiers, setTiers] = useState(config.tiers);
  const [formula, setFormula] = useState(config.formula);
  const [previewSubtotal, setPreviewSubtotal] = useState("45.00");
  const preview = useMemo(
    () =>
      buildPreview(
        pricingMode,
        tiers,
        formula,
        centsFromDollars(previewSubtotal),
      ),
    [formula, previewSubtotal, pricingMode, tiers],
  );
  const status = protectionStatus(enabled, settings.productId, variantCount);

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Shipping Protection</p>
          <h2 className={styles.pageTitle}>Cart protection offer</h2>
          <p className={styles.pageText}>
            Add an optional protection line to the cart and charge the matching
            price for the customer cart value.
          </p>
        </div>
        <div className={styles.actionRow}>
          <a
            className={styles.secondaryButton}
            href={themeEditorUrl(shopDomain)}
            target="_top"
          >
            Open theme editor
          </a>
          <button
            className={styles.primaryButton}
            disabled={!canSave}
            form="shipping-protection-form"
            name="_action"
            type="submit"
            value="save"
          >
            {saving ? "Saving" : "Save settings"}
          </button>
        </div>
      </header>

      {fetcher.data?.ok && (
        <div className={styles.successNotice}>
          Shipping protection settings saved.
        </div>
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

      <div className={styles.settingsLayout}>
        <fetcher.Form
          action="/api/shipping-protection"
          className={styles.settingsForm}
          id="shipping-protection-form"
          method="post"
        >
          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>1</span>
              <div>
                <h3 className={styles.panelTitle}>Turn protection on</h3>
                <p className={styles.panelText}>
                  Create a Shopify product that the cart widget can add or
                  remove.
                </p>
              </div>
            </div>

            <Checkbox
              checked={enabled}
              helper="When enabled, saving also syncs the Shopify protection product and price variants."
              label="Enable shipping protection"
              name="enabled"
              onChange={setEnabled}
            />
            <Checkbox
              checked={config.defaultSelected}
              helper="Leave this off unless preselecting order protection is allowed for your store."
              label="Preselect protection in the cart"
              name="defaultSelected"
            />
            <TextField
              defaultValue={config.productTitle}
              helper="Shopify product name used for the protection line item."
              label="Product name"
              name="productTitle"
            />
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>2</span>
              <div>
                <h3 className={styles.panelTitle}>Set the price</h3>
                <p className={styles.panelText}>
                  Use exact ranges or calculate protection as the cart grows.
                </p>
              </div>
            </div>

            <SelectField
              helper="Tier pricing gives you exact price bands. Formula pricing creates one price per step up to the maximum charge."
              label="Pricing style"
              name="pricingMode"
              onChange={(value) =>
                setPricingMode(value as ShippingProtectionPricingMode)
              }
              value={pricingMode}
            >
              <option value="TIERED">Price tiers</option>
              <option value="FORMULA">Formula</option>
            </SelectField>

            <div hidden={pricingMode !== "TIERED"}>
              <TierEditor tiers={tiers} onChange={setTiers} />
            </div>

            <div hidden={pricingMode !== "FORMULA"}>
              <FormulaEditor formula={formula} onChange={setFormula} />
            </div>

            {preview.variantCount > MAX_PROTECTION_VARIANTS && (
              <div className={styles.criticalNotice}>
                This setup needs {preview.variantCount} protection prices. Lower
                the maximum charge or increase the per-step amount.
              </div>
            )}
          </section>

          <section className={styles.simpleCard}>
            <div className={styles.cardHeading}>
              <span className={styles.stepBadge}>3</span>
              <div>
                <h3 className={styles.panelTitle}>Cart widget text</h3>
                <p className={styles.panelText}>
                  These messages appear beside the checkbox in the cart.
                </p>
              </div>
            </div>

            <div className={styles.fieldGrid}>
              <TextField
                defaultValue={config.widgetHeading}
                helper="Short heading for the widget."
                label="Widget heading"
                name="widgetHeading"
              />
              <TextField
                defaultValue={config.optInLabel}
                helper="Text shown beside the opt-in checkbox."
                label="Checkbox label"
                name="optInLabel"
              />
              <TextField
                defaultValue={config.widgetDescription}
                helper="One short sentence under the heading."
                label="Description"
                name="widgetDescription"
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

        <aside className={styles.sidePanel}>
          <div>
            <p className={styles.eyebrow}>Current setup</p>
            <h3 className={styles.panelTitle}>{status}</h3>
            <p className={styles.panelText}>
              The storefront widget needs the theme block or app embed enabled.
            </p>
          </div>
          <div className={styles.statusList}>
            <StatusRow
              label="Feature"
              value={enabled ? "Enabled" : "Disabled"}
            />
            <StatusRow
              label="Shopify product"
              value={settings.productId ? "Created" : "Not created"}
            />
            <StatusRow
              label="Price variants"
              value={`${variantCount}/${preview.variantCount}`}
            />
            <StatusRow
              label="Pricing"
              value={pricingMode === "FORMULA" ? "Formula" : "Tiers"}
            />
            <StatusRow
              label="Last sync"
              value={settings.syncedAt ? shortDate(settings.syncedAt) : "Never"}
            />
          </div>
          <div className={styles.previewBox}>
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
              <strong className={styles.rowValue}>{preview.variantCount}</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TierEditor({
  onChange,
  tiers,
}: {
  onChange: (tiers: ShippingProtectionTier[]) => void;
  tiers: ShippingProtectionTier[];
}) {
  const updateTier = (
    index: number,
    key: keyof ShippingProtectionTier,
    value: string,
  ) => {
    onChange(
      tiers.map((tier, tierIndex) =>
        tierIndex === index
          ? {
              ...tier,
              [key]:
                key === "maxCents" && value.trim() === ""
                  ? null
                  : centsFromDollars(value),
            }
          : tier,
      ),
    );
  };

  return (
    <div className={styles.tierEditor}>
      {tiers.map((tier, index) => (
        <div className={styles.tierRow} key={index}>
          <TextField
            helper="From"
            label="Cart from"
            min="0"
            name="tierMin"
            onChange={(value) => updateTier(index, "minCents", value)}
            prefix="$"
            step="0.01"
            type="number"
            value={centsToDecimal(tier.minCents)}
          />
          <TextField
            helper="Leave blank for no upper limit."
            label="Cart below"
            min="0"
            name="tierMax"
            onChange={(value) => updateTier(index, "maxCents", value)}
            prefix="$"
            step="0.01"
            type="number"
            value={tier.maxCents === null ? "" : centsToDecimal(tier.maxCents)}
          />
          <TextField
            helper="Protection charge"
            label="Charge"
            min="0"
            name="tierAmount"
            onChange={(value) => updateTier(index, "amountCents", value)}
            prefix="$"
            step="0.01"
            type="number"
            value={centsToDecimal(tier.amountCents)}
          />
          <button
            className={styles.iconTextButton}
            disabled={tiers.length <= 1}
            onClick={() => onChange(tiers.filter((_, i) => i !== index))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className={styles.secondaryButton}
        onClick={() =>
          onChange([
            ...tiers,
            {
              minCents: tiers[tiers.length - 1]?.maxCents ?? 0,
              maxCents: null,
              amountCents: 100,
            },
          ])
        }
        type="button"
      >
        Add price range
      </button>
    </div>
  );
}

function FormulaEditor({
  formula,
  onChange,
}: {
  formula: ShippingProtectionFormula;
  onChange: (formula: ShippingProtectionFormula) => void;
}) {
  const updateFormula = (key: keyof ShippingProtectionFormula, value: string) => {
    onChange({ ...formula, [key]: centsFromDollars(value) });
  };

  return (
    <div className={styles.fieldGrid}>
      <TextField
        helper="Charge this amount for each subtotal step."
        label="Charge"
        min="0.01"
        name="formulaAmount"
        onChange={(value) => updateFormula("amountCents", value)}
        prefix="$"
        step="0.01"
        type="number"
        value={centsToDecimal(formula.amountCents)}
      />
      <TextField
        helper="For example, 10 means every $10 of cart subtotal."
        label="Every"
        min="0.01"
        name="formulaEvery"
        onChange={(value) => updateFormula("everyCents", value)}
        prefix="$"
        step="0.01"
        type="number"
        value={centsToDecimal(formula.everyCents)}
      />
      <TextField
        helper="Minimum protection charge."
        label="Minimum charge"
        min="0"
        name="formulaMinCharge"
        onChange={(value) => updateFormula("minChargeCents", value)}
        prefix="$"
        step="0.01"
        type="number"
        value={centsToDecimal(formula.minChargeCents)}
      />
      <TextField
        helper={`Maximum charge. Keep the number of prices at ${MAX_PROTECTION_VARIANTS} or fewer.`}
        label="Maximum charge"
        min="0"
        name="formulaMaxCharge"
        onChange={(value) => updateFormula("maxChargeCents", value)}
        prefix="$"
        step="0.01"
        type="number"
        value={centsToDecimal(formula.maxChargeCents)}
      />
    </div>
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
  helper,
  label,
  name,
  onChange,
}: {
  checked: boolean;
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
        className={`${styles.checkCard} ${
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

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statusRow}>
      <span className={styles.rowLabel}>{label}</span>
      <strong className={styles.rowValue}>{value}</strong>
    </div>
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
    priceCents: computeShippingProtectionPriceCents(
      config,
      cartSubtotalCents,
    ),
    variantCount: requiredProtectionVariantAmounts(config).length,
  };
}

function centsFromDollars(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

function protectionStatus(
  enabled: boolean,
  productId: string | null,
  variantCount: number,
) {
  if (!enabled) return "Disabled";
  if (!productId || variantCount === 0) return "Needs setup";
  return "Ready";
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
