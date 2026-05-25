import type { CSSProperties } from "react";
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
      config,
    },
  };
};

export default function Settings() {
  const { billingActive, billingStatus, rule } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const saving = fetcher.state !== "idle";

  return (
    <s-page heading="Settings">
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
        Save
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

      <fetcher.Form id="rules-form" method="post" action="/api/rules">
        <s-section heading="General">
          <div style={gridStyle}>
            <Checkbox
              name="enabled"
              label="Enable app"
              defaultChecked={rule.config.enabled}
            />
            <Checkbox
              name="testMode"
              label="Test mode"
              defaultChecked={rule.config.testMode}
            />
            <Field label="Rule name" name="name" defaultValue={rule.name} />
            <Field
              label="Offer name"
              name="offerName"
              defaultValue={rule.config.offerName}
            />
            <Field
              label="Free shipping message"
              name="message"
              defaultValue={rule.config.message}
            />
            <Field
              label="Currency"
              name="currencyCode"
              defaultValue={rule.config.currencyCode}
            />
          </div>
        </s-section>

        <s-section heading="Eligibility rules">
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
            <label style={labelStyle}>
              Weight unit
              <select name="weightUnit" defaultValue="lb" style={inputStyle}>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </label>
            <Field
              label="Maximum item quantity"
              name="maxQuantity"
              type="number"
              step="1"
              min="0"
              defaultValue={String(rule.maxQuantity)}
            />
            <label style={labelStyle}>
              Count items
              <select
                name="countMode"
                defaultValue={rule.config.countMode}
                style={inputStyle}
              >
                <option value="ALL">All items</option>
                <option value="MATCHING_PRODUCT_TAGS">
                  Products matching selected tags
                </option>
              </select>
            </label>
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
        </s-section>

        <s-section heading="Discount stacking">
          <div style={checkboxGridStyle}>
            <Checkbox
              name="blockDiscountCodes"
              label="Block free shipping when any discount code is entered"
              defaultChecked={rule.config.blockDiscountCodes}
            />
            <Checkbox
              name="blockOrderDiscounts"
              label="Block order discounts"
              defaultChecked={rule.config.blockOrderDiscounts}
            />
            <Checkbox
              name="blockProductDiscounts"
              label="Block product discounts"
              defaultChecked={rule.config.blockProductDiscounts}
            />
            <Checkbox
              name="blockShippingDiscounts"
              label="Block shipping discounts"
              defaultChecked={rule.config.blockShippingDiscounts}
            />
          </div>
        </s-section>

        <s-section heading="Shipping method targeting">
          <div style={gridStyle}>
            <label style={labelStyle}>
              Apply mode
              <select
                name="applyMode"
                defaultValue={rule.config.applyMode}
                style={inputStyle}
              >
                <option value="CHEAPEST_ELIGIBLE">
                  Cheapest eligible shipping option
                </option>
                <option value="MATCHING_TITLE">Matching title only</option>
                <option value="ALL_ELIGIBLE">All eligible options</option>
              </select>
            </label>
            <label style={labelStyle}>
              Title match
              <select
                name="shippingTitleMatchType"
                defaultValue={rule.config.shippingTitleMatchType}
                style={inputStyle}
              >
                <option value="CONTAINS">Contains</option>
                <option value="EXACT">Exact match</option>
                <option value="STARTS_WITH">Starts with</option>
                <option value="NONE">No title match</option>
                <option value="REGEX">Regex</option>
              </select>
            </label>
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
            <Checkbox
              name="allowExpedited"
              label="Allow expedited or overnight methods"
              defaultChecked={rule.config.allowExpedited}
            />
            <Checkbox
              name="regexEnabled"
              label="Enable regex matching"
              defaultChecked={rule.config.regexEnabled}
            />
          </div>
        </s-section>

        <s-section heading="Cart progress bar">
          <div style={checkboxGridStyle}>
            <Checkbox
              name="progressBarEnabled"
              label="Enable optional storefront progress bar"
              defaultChecked={rule.config.progressBarEnabled}
            />
          </div>
        </s-section>
      </fetcher.Form>
    </s-page>
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

function Checkbox({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked: boolean;
}) {
  return (
    <label style={checkboxStyle}>
      <input type="hidden" name={name} value="false" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
      />
      {label}
    </label>
  );
}

const gridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  alignItems: "end",
} satisfies CSSProperties;

const checkboxGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
} satisfies CSSProperties;

const labelStyle = {
  display: "grid",
  gap: "6px",
  color: "#303030",
  fontSize: "13px",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  minHeight: "36px",
  border: "1px solid #8a8a8a",
  borderRadius: "6px",
  padding: "6px 10px",
  font: "inherit",
  background: "white",
} satisfies CSSProperties;

const checkboxStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  minHeight: "36px",
  color: "#303030",
} satisfies CSSProperties;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
