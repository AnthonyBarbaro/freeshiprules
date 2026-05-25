import type { CSSProperties, ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getRuleSetForShopDomain,
  functionConfigFromRuleSet,
} from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";

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
  const stackingBlocks = [
    rule.config.blockDiscountCodes && "codes",
    rule.config.blockOrderDiscounts && "order",
    rule.config.blockProductDiscounts && "product",
    rule.config.blockShippingDiscounts && "shipping",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <s-page heading="Rule editor">
      <s-button
        slot="primary-action"
        variant="primary"
        {...(saving || !billingActive ? { disabled: true } : {})}
        onClick={() => {
          document
            .querySelector<HTMLFormElement>("#rules-form")
            ?.requestSubmit();
        }}
      >
        {saving ? "Saving" : "Save rule"}
      </s-button>

      {fetcher.data?.ok && (
        <s-banner tone="success">
          <s-paragraph>Rules saved.</s-paragraph>
        </s-banner>
      )}

      {fetcher.data?.error && (
        <s-banner tone="critical">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      {!billingActive && (
        <s-banner tone="warning">
          <s-paragraph>
            Billing is {billingStatus}. Approve the plan before saving changes.
          </s-paragraph>
          <s-button href="/app/billing">Open billing</s-button>
        </s-banner>
      )}

      <div style={workspaceStyle}>
        <fetcher.Form id="rules-form" method="post" action="/api/rules">
          <div style={editorStackStyle}>
            <section style={heroPanelStyle}>
              <div>
                <p style={eyebrowStyle}>Active template</p>
                <h2 style={titleStyle}>No-stacking free shipping</h2>
                <p style={bodyTextStyle}>
                  Free shipping when the order meets subtotal, weight, quantity,
                  discount, and shipping-method rules.
                </p>
              </div>
              <div style={templateControlStyle}>
                <label style={labelStyle}>
                  Rule template
                  <select defaultValue="NO_STACKING" style={inputStyle}>
                    <option value="NO_STACKING">No stacking free shipping</option>
                    <option value="WHOLESALE" disabled>
                      Wholesale threshold
                    </option>
                    <option value="VIP" disabled>
                      Customer tag based
                    </option>
                  </select>
                </label>
              </div>
            </section>

            <DetailsSection
              defaultOpen
              title="Essentials"
              description="Name the offer and control whether checkout should use it."
            >
              <div style={switchGridStyle}>
                <Checkbox
                  name="enabled"
                  label="Enable rule"
                  helper="Turn this off to pause free shipping without deleting settings."
                  defaultChecked={rule.config.enabled}
                />
                <Checkbox
                  name="testMode"
                  label="Test mode"
                  helper="Keep the configuration saved while you validate behavior."
                  defaultChecked={rule.config.testMode}
                />
              </div>
              <div style={gridStyle}>
                <Field label="Internal rule name" name="name" defaultValue={rule.name} />
                <Field
                  label="Checkout offer name"
                  name="offerName"
                  defaultValue={rule.config.offerName}
                />
                <Field
                  label="Merchant-facing message"
                  name="message"
                  defaultValue={rule.config.message}
                />
                <Field
                  label="Currency"
                  name="currencyCode"
                  defaultValue={rule.config.currencyCode}
                />
              </div>
            </DetailsSection>

            <DetailsSection
              defaultOpen
              title="Eligibility thresholds"
              description="The core qualification rules evaluated by the Shopify Function."
            >
              <div style={gridStyle}>
                <Field
                  label="Minimum subtotal"
                  name="minSubtotal"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={rule.minSubtotal}
                />
                <Field
                  label="Maximum total weight"
                  name="maxWeight"
                  type="number"
                  step="0.1"
                  min="0"
                  defaultValue={rule.maxWeightLb}
                />
                <SelectField label="Weight unit" name="weightUnit" defaultValue="lb">
                  <option value="lb">Pounds</option>
                  <option value="kg">Kilograms</option>
                </SelectField>
                <Field
                  label="Maximum item quantity"
                  name="maxQuantity"
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={String(rule.maxQuantity)}
                />
              </div>
            </DetailsSection>

            <DetailsSection
              title="Product, market, and customer filters"
              description="Enterprise filters for country, state, product tags, collections, and customer tags."
            >
              <div style={gridStyle}>
                <SelectField
                  label="Count items"
                  name="countMode"
                  defaultValue={rule.config.countMode}
                >
                  <option value="ALL">All items</option>
                  <option value="MATCHING_PRODUCT_TAGS">
                    Products matching selected tags
                  </option>
                </SelectField>
                <Field
                  label="Selected product tags"
                  name="eligibleProductTags"
                  defaultValue={rule.config.eligibleProductTags.join(", ")}
                />
                <Field
                  label="Excluded product tags"
                  name="excludedProductTags"
                  defaultValue={rule.config.excludedProductTags.join(", ")}
                />
                <Field
                  label="Excluded collections"
                  name="excludedCollectionIds"
                  defaultValue={rule.config.excludedCollectionIds.join(", ")}
                />
                <Field
                  label="Eligible countries"
                  name="eligibleCountries"
                  defaultValue={rule.config.eligibleCountries.join(", ")}
                />
                <Field
                  label="Eligible states"
                  name="eligibleStates"
                  defaultValue={rule.config.eligibleStates.join(", ")}
                />
                <Field
                  label="Customer tag include"
                  name="customerTagInclude"
                  defaultValue={rule.config.customerTagInclude.join(", ")}
                />
                <Field
                  label="Customer tag exclude"
                  name="customerTagExclude"
                  defaultValue={rule.config.customerTagExclude.join(", ")}
                />
              </div>
            </DetailsSection>

            <DetailsSection
              defaultOpen
              title="Discount stacking"
              description="Default enterprise posture: do not combine this shipping offer with other offers."
            >
              <div style={switchGridStyle}>
                <Checkbox
                  name="blockDiscountCodes"
                  label="Block discount codes"
                  helper="Return no shipping discount when a code is present."
                  defaultChecked={rule.config.blockDiscountCodes}
                />
                <Checkbox
                  name="blockOrderDiscounts"
                  label="Block order discounts"
                  helper="Do not combine with order-level discounts."
                  defaultChecked={rule.config.blockOrderDiscounts}
                />
                <Checkbox
                  name="blockProductDiscounts"
                  label="Block product discounts"
                  helper="Do not combine with product discounts."
                  defaultChecked={rule.config.blockProductDiscounts}
                />
                <Checkbox
                  name="blockShippingDiscounts"
                  label="Block shipping discounts"
                  helper="Do not combine with other shipping offers."
                  defaultChecked={rule.config.blockShippingDiscounts}
                />
              </div>
            </DetailsSection>

            <DetailsSection
              title="Shipping method targeting"
              description="Choose which delivery options can receive the 100% shipping discount."
            >
              <div style={gridStyle}>
                <SelectField
                  label="Apply mode"
                  name="applyMode"
                  defaultValue={rule.config.applyMode}
                >
                  <option value="CHEAPEST_ELIGIBLE">
                    Cheapest eligible shipping option
                  </option>
                  <option value="MATCHING_TITLE">Matching title only</option>
                  <option value="ALL_ELIGIBLE">All eligible options</option>
                </SelectField>
                <SelectField
                  label="Title match"
                  name="shippingTitleMatchType"
                  defaultValue={rule.config.shippingTitleMatchType}
                >
                  <option value="NONE">No title match</option>
                  <option value="CONTAINS">Contains</option>
                  <option value="EXACT">Exact match</option>
                  <option value="STARTS_WITH">Starts with</option>
                  <option value="REGEX">Regex</option>
                </SelectField>
                <Field
                  label="Title match value"
                  name="shippingTitleMatchValue"
                  defaultValue={rule.config.shippingTitleMatchValue}
                />
                <Field
                  label="Exclude titles containing"
                  name="excludedTitleTerms"
                  defaultValue={rule.config.excludedTitleTerms.join(", ")}
                />
              </div>
              <div style={switchGridStyle}>
                <Checkbox
                  name="allowExpedited"
                  label="Allow expedited methods"
                  helper="Default excludes overnight, express, air, and next-day titles."
                  defaultChecked={rule.config.allowExpedited}
                />
                <Checkbox
                  name="regexEnabled"
                  label="Enable regex matching"
                  helper="Keep off unless your team owns the expressions."
                  defaultChecked={rule.config.regexEnabled}
                />
              </div>
            </DetailsSection>

            <DetailsSection
              title="Storefront progress bar"
              description="Optional theme app extension messaging for cart and drawer experiences."
            >
              <div style={switchGridStyle}>
                <Checkbox
                  name="progressBarEnabled"
                  label="Enable storefront progress bar"
                  helper="The checkout Function remains the source of truth."
                  defaultChecked={rule.config.progressBarEnabled}
                />
              </div>
            </DetailsSection>
          </div>
        </fetcher.Form>

        <aside style={asideStyle}>
          <section style={summaryPanelStyle}>
            <div style={summaryHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Current policy</p>
                <h3 style={panelTitleStyle}>
                  {rule.config.enabled ? "Enabled" : "Paused"}
                </h3>
              </div>
              <span
                style={{
                  ...statusPillStyle,
                  ...(rule.config.enabled ? statusGoodStyle : statusMutedStyle),
                }}
              >
                {rule.config.enabled ? "Live" : "Off"}
              </span>
            </div>

            <Metric label="Subtotal" value={`$${rule.minSubtotal}`} />
            <Metric label="Weight cap" value={`${rule.maxWeightLb} lb`} />
            <Metric label="Quantity cap" value={`${rule.maxQuantity} items`} />
            <Metric
              label="Shipping target"
              value={labelForApplyMode(rule.config.applyMode)}
            />
            <Metric
              label="Stacking blocks"
              value={stackingBlocks || "None"}
            />
            <Metric
              label="Expedited methods"
              value={rule.config.allowExpedited ? "Allowed" : "Excluded"}
            />

            <div style={summaryFooterStyle}>
              <s-button href="/app/install-check">Verify install</s-button>
            </div>
          </section>
        </aside>
      </div>
    </s-page>
  );
}

function DetailsSection({
  children,
  defaultOpen = false,
  description,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  description: string;
  title: string;
}) {
  return (
    <details style={detailsStyle} open={defaultOpen}>
      <summary style={summaryStyle}>
        <span>
          <span style={summaryTitleStyle}>{title}</span>
          <span style={summaryDescriptionStyle}>{description}</span>
        </span>
        <span style={chevronStyle}>v</span>
      </summary>
      <div style={detailsBodyStyle}>{children}</div>
    </details>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step,
  min,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  step?: string;
  min?: string;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <input
        name={name}
        defaultValue={defaultValue}
        type={type}
        step={step}
        min={min}
        style={inputStyle}
      />
    </label>
  );
}

function SelectField({
  children,
  defaultValue,
  label,
  name,
}: {
  children: ReactNode;
  defaultValue: string;
  label: string;
  name: string;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <select name={name} defaultValue={defaultValue} style={inputStyle}>
        {children}
      </select>
    </label>
  );
}

function Checkbox({
  label,
  name,
  defaultChecked,
  helper,
}: {
  label: string;
  name: string;
  defaultChecked: boolean;
  helper?: string;
}) {
  return (
    <label style={checkboxStyle}>
      <input type="hidden" name={name} value="false" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        style={checkboxInputStyle}
      />
      <span>
        <span style={checkboxLabelStyle}>{label}</span>
        {helper && <span style={helperTextStyle}>{helper}</span>}
      </span>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricStyle}>
      <span style={metricLabelStyle}>{label}</span>
      <strong style={metricValueStyle}>{value}</strong>
    </div>
  );
}

function labelForApplyMode(mode: string) {
  if (mode === "ALL_ELIGIBLE") return "All eligible";
  if (mode === "MATCHING_TITLE") return "Title match";
  return "Cheapest eligible";
}

const workspaceStyle = {
  display: "grid",
  gap: "20px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  alignItems: "start",
} satisfies CSSProperties;

const editorStackStyle = {
  display: "grid",
  gap: "12px",
} satisfies CSSProperties;

const heroPanelStyle = {
  display: "grid",
  gap: "18px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  alignItems: "end",
  background: "#ffffff",
  border: "1px solid #d9d9d9",
  borderRadius: "8px",
  padding: "18px",
} satisfies CSSProperties;

const templateControlStyle = {
  minWidth: 0,
} satisfies CSSProperties;

const detailsStyle = {
  background: "#ffffff",
  border: "1px solid #d9d9d9",
  borderRadius: "8px",
  overflow: "hidden",
} satisfies CSSProperties;

const summaryStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  cursor: "pointer",
  listStyle: "none",
  padding: "16px 18px",
} satisfies CSSProperties;

const summaryTitleStyle = {
  display: "block",
  color: "#202223",
  fontSize: "14px",
  fontWeight: 700,
} satisfies CSSProperties;

const summaryDescriptionStyle = {
  display: "block",
  color: "#616161",
  fontSize: "12px",
  lineHeight: "18px",
  marginTop: "2px",
} satisfies CSSProperties;

const chevronStyle = {
  color: "#616161",
  fontSize: "20px",
  lineHeight: 1,
} satisfies CSSProperties;

const detailsBodyStyle = {
  display: "grid",
  gap: "16px",
  borderTop: "1px solid #ebebeb",
  padding: "18px",
} satisfies CSSProperties;

const gridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  alignItems: "end",
} satisfies CSSProperties;

const switchGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
} satisfies CSSProperties;

const asideStyle = {
  position: "sticky",
  top: "16px",
} satisfies CSSProperties;

const summaryPanelStyle = {
  display: "grid",
  gap: "14px",
  background: "#ffffff",
  border: "1px solid #d9d9d9",
  borderRadius: "8px",
  padding: "18px",
} satisfies CSSProperties;

const summaryHeaderStyle = {
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: "16px",
  paddingBottom: "8px",
  borderBottom: "1px solid #ebebeb",
} satisfies CSSProperties;

const summaryFooterStyle = {
  paddingTop: "8px",
  borderTop: "1px solid #ebebeb",
} satisfies CSSProperties;

const eyebrowStyle = {
  margin: 0,
  color: "#616161",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
} satisfies CSSProperties;

const titleStyle = {
  margin: "4px 0 6px",
  color: "#202223",
  fontSize: "20px",
  lineHeight: "28px",
} satisfies CSSProperties;

const panelTitleStyle = {
  margin: "4px 0 0",
  color: "#202223",
  fontSize: "18px",
  lineHeight: "24px",
} satisfies CSSProperties;

const bodyTextStyle = {
  margin: 0,
  color: "#616161",
  fontSize: "13px",
  lineHeight: "20px",
} satisfies CSSProperties;

const labelStyle = {
  display: "grid",
  gap: "6px",
  color: "#303030",
  fontSize: "13px",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  minHeight: "38px",
  width: "100%",
  border: "1px solid #8a8a8a",
  borderRadius: "6px",
  padding: "7px 10px",
  font: "inherit",
  background: "white",
  boxSizing: "border-box",
} satisfies CSSProperties;

const checkboxStyle = {
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  gap: "10px",
  alignItems: "start",
  minHeight: "44px",
  padding: "10px 12px",
  border: "1px solid #ebebeb",
  borderRadius: "6px",
  color: "#303030",
  background: "#fafafa",
} satisfies CSSProperties;

const checkboxInputStyle = {
  marginTop: "2px",
} satisfies CSSProperties;

const checkboxLabelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: 700,
} satisfies CSSProperties;

const helperTextStyle = {
  display: "block",
  marginTop: "3px",
  color: "#616161",
  fontSize: "12px",
  lineHeight: "17px",
} satisfies CSSProperties;

const metricStyle = {
  display: "grid",
  gap: "4px",
  padding: "8px 0",
} satisfies CSSProperties;

const metricLabelStyle = {
  color: "#616161",
  fontSize: "12px",
} satisfies CSSProperties;

const metricValueStyle = {
  color: "#202223",
  fontSize: "14px",
  lineHeight: "20px",
} satisfies CSSProperties;

const statusPillStyle = {
  borderRadius: "999px",
  padding: "3px 8px",
  fontSize: "12px",
  fontWeight: 700,
} satisfies CSSProperties;

const statusGoodStyle = {
  color: "#0c5132",
  background: "#cdfee1",
} satisfies CSSProperties;

const statusMutedStyle = {
  color: "#616161",
  background: "#ebebeb",
} satisfies CSSProperties;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
