import type { CSSProperties, ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import { functionConfigFromRuleSet } from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, ruleSet } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: true,
  });
  const config = functionConfigFromRuleSet(ruleSet);

  return {
    shopDomain: session.shop,
    billingStatus: shop.billingStatus,
    billingActive: billingIsActive(shop.billingStatus),
    rule: {
      enabled: ruleSet.enabled,
      name: ruleSet.name,
      minSubtotalEnabled: config.minSubtotalEnabled,
      minSubtotalCents: ruleSet.minSubtotalCents,
      maxWeightEnabled: config.maxWeightEnabled,
      maxWeightGrams: ruleSet.maxWeightGrams,
      maxQuantityEnabled: config.maxQuantityEnabled,
      maxQuantity: ruleSet.maxQuantity,
      blockDiscountCodes: ruleSet.blockDiscountCodes,
      blockOrderDiscounts: ruleSet.blockOrderDiscounts,
      blockProductDiscounts: ruleSet.blockProductDiscounts,
      blockShippingDiscounts: ruleSet.blockShippingDiscounts,
      updatedAt: ruleSet.updatedAt.toISOString(),
    },
  };
};

export default function Dashboard() {
  const { shopDomain, billingStatus, billingActive, rule } =
    useLoaderData<typeof loader>();
  const blockedDiscounts = rule
    ? [
        rule.blockDiscountCodes && "codes",
        rule.blockOrderDiscounts && "order",
        rule.blockProductDiscounts && "product",
        rule.blockShippingDiscounts && "shipping",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const subtotalLabel = rule
    ? rule.minSubtotalEnabled
      ? formatMoney(rule.minSubtotalCents)
      : "No minimum"
    : "-";
  const weightLabel = rule
    ? rule.maxWeightEnabled
      ? `${formatPounds(rule.maxWeightGrams)} lb`
      : "No limit"
    : "-";
  const quantityLabel = rule
    ? rule.maxQuantityEnabled
      ? `${rule.maxQuantity} items`
      : "No limit"
    : "-";

  return (
    <s-page heading="FreeShip Rules">
      <s-button slot="primary-action" variant="primary" href="/app/settings">
        Edit rules
      </s-button>

      <div style={dashboardStyle}>
        {!billingActive && (
          <section style={billingNoticeStyle}>
            <div>
              <h3 style={panelTitleStyle}>Shopify plan required</h3>
              <p style={bodyTextStyle}>
                Choose or approve a Shopify plan to unlock saving, syncing,
                analytics, and storefront widgets. The app remains available so
                setup can be reviewed without a redirect.
              </p>
            </div>
            <Link to="/app/billing">Open billing</Link>
          </section>
        )}

        <section style={overviewPanelStyle}>
          <div>
            <p style={eyebrowStyle}>Store</p>
            <h2 style={titleStyle}>{shopDomain}</h2>
            <p style={bodyTextStyle}>
              Rule-based free shipping is managed in Shopify and enforced at
              checkout by the Function.
            </p>
          </div>
          <span
            style={{
              ...statusPillStyle,
              ...(rule?.enabled ? statusGoodStyle : statusMutedStyle),
            }}
          >
            {rule?.enabled ? "Active" : "Paused"}
          </span>
        </section>

        <div style={metricGridStyle}>
          <MetricCard
            label="Billing"
            value={billingStatus}
            tone={billingActive ? "good" : "muted"}
          />
          <MetricCard
            label="Minimum subtotal"
            value={subtotalLabel}
          />
          <MetricCard
            label="Weight cap"
            value={weightLabel}
          />
          <MetricCard
            label="Quantity cap"
            value={quantityLabel}
          />
        </div>

        <div style={contentGridStyle}>
          <section style={panelStyle}>
            <div style={panelHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Active rule</p>
                <h3 style={panelTitleStyle}>{rule?.name || "No rule"}</h3>
              </div>
              <s-button href="/app/settings">Configure</s-button>
            </div>

            {rule ? (
              <div style={ruleSummaryStyle}>
                <SummaryRow label="Subtotal" value={subtotalLabel} />
                <SummaryRow label="Weight" value={weightLabel} />
                <SummaryRow label="Quantity" value={quantityLabel} />
                <SummaryRow
                  label="No stacking"
                  value={blockedDiscounts || "Not enforced"}
                />
                <SummaryRow label="Last updated" value={formatDate(rule.updatedAt)} />
              </div>
            ) : (
              <s-paragraph>No rule has been created yet.</s-paragraph>
            )}
          </section>

          <section style={panelStyle}>
            <p style={eyebrowStyle}>Operations</p>
            <h3 style={panelTitleStyle}>Setup checklist</h3>
            <div style={checklistStyle}>
              <ChecklistItem done={billingActive}>
                <Link to="/app/billing">Billing approved</Link>
              </ChecklistItem>
              <ChecklistItem done={Boolean(rule)}>
                <Link to="/app/settings">Rule configured</Link>
              </ChecklistItem>
              <ChecklistItem done={Boolean(rule?.enabled)}>
                <Link to="/app/install-check">Function discount verified</Link>
              </ChecklistItem>
            </div>
          </section>
        </div>
      </div>
    </s-page>
  );
}

function MetricCard({
  label,
  tone = "base",
  value,
}: {
  label: string;
  tone?: "base" | "good" | "muted";
  value: string;
}) {
  return (
    <section style={metricCardStyle}>
      <span style={metricLabelStyle}>{label}</span>
      <strong
        style={{
          ...metricValueStyle,
          ...(tone === "good" ? goodTextStyle : {}),
          ...(tone === "muted" ? mutedTextStyle : {}),
        }}
      >
        {value}
      </strong>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={summaryRowStyle}>
      <span style={summaryLabelStyle}>{label}</span>
      <strong style={summaryValueStyle}>{value}</strong>
    </div>
  );
}

function ChecklistItem({
  children,
  done,
}: {
  children: ReactNode;
  done: boolean;
}) {
  return (
    <div style={checklistItemStyle}>
      <span
        style={{
          ...checkDotStyle,
          ...(done ? statusGoodStyle : statusMutedStyle),
        }}
      >
        {done ? "OK" : "-"}
      </span>
      <span>{children}</span>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatPounds(grams: number) {
  return (grams / 453.59237).toFixed(1);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

const dashboardStyle = {
  display: "grid",
  gap: "16px",
} satisfies CSSProperties;

const overviewPanelStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: "20px",
  background: "#ffffff",
  border: "1px solid #d9d9d9",
  borderRadius: "8px",
  padding: "18px",
} satisfies CSSProperties;

const billingNoticeStyle = {
  alignItems: "center",
  background: "#fff7e6",
  border: "1px solid #edc56d",
  borderRadius: "8px",
  display: "flex",
  gap: "16px",
  justifyContent: "space-between",
  padding: "16px 18px",
} satisfies CSSProperties;

const metricGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const contentGridStyle = {
  display: "grid",
  gap: "16px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  background: "#ffffff",
  border: "1px solid #d9d9d9",
  borderRadius: "8px",
  padding: "18px",
} satisfies CSSProperties;

const panelHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: "16px",
  paddingBottom: "12px",
  borderBottom: "1px solid #ebebeb",
} satisfies CSSProperties;

const metricCardStyle = {
  display: "grid",
  gap: "8px",
  minHeight: "86px",
  background: "#ffffff",
  border: "1px solid #d9d9d9",
  borderRadius: "8px",
  padding: "16px",
} satisfies CSSProperties;

const ruleSummaryStyle = {
  display: "grid",
  gap: "0",
  marginTop: "8px",
} satisfies CSSProperties;

const summaryRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  padding: "11px 0",
  borderBottom: "1px solid #f1f1f1",
} satisfies CSSProperties;

const checklistStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "14px",
} satisfies CSSProperties;

const checklistItemStyle = {
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
  alignItems: "center",
  gap: "10px",
  minHeight: "32px",
} satisfies CSSProperties;

const checkDotStyle = {
  display: "inline-grid",
  placeItems: "center",
  width: "22px",
  height: "22px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 700,
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

const metricLabelStyle = {
  color: "#616161",
  fontSize: "12px",
} satisfies CSSProperties;

const metricValueStyle = {
  color: "#202223",
  fontSize: "18px",
  lineHeight: "24px",
} satisfies CSSProperties;

const summaryLabelStyle = {
  color: "#616161",
  fontSize: "13px",
} satisfies CSSProperties;

const summaryValueStyle = {
  color: "#202223",
  fontSize: "13px",
  textAlign: "right",
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

const goodTextStyle = {
  color: "#0c5132",
} satisfies CSSProperties;

const mutedTextStyle = {
  color: "#616161",
} satisfies CSSProperties;
