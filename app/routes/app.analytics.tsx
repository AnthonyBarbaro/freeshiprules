import type { CSSProperties } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { analyticsSummaryForShopDomain } from "../services/analytics.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import { billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });
  const billingActive = billingIsActive(shop.billingStatus);

  return {
    billingActive,
    billingStatus: shop.billingStatus,
    summary: billingActive
      ? await analyticsSummaryForShopDomain(session.shop)
      : null,
  };
};

export default function Analytics() {
  const { billingActive, billingStatus, summary } =
    useLoaderData<typeof loader>();

  if (!billingActive || !summary) {
    return (
      <s-page heading="Analytics">
        <section style={panelStyle}>
          <div style={emptyStateStyle}>
            <h3 style={panelTitleStyle}>Billing approval required</h3>
            <p style={bodyTextStyle}>
              Analytics unlock after billing is active. Current billing status:
              {" "}{billingStatus}.
            </p>
            <Link to="/app/billing">Open billing</Link>
          </div>
        </section>
      </s-page>
    );
  }

  return (
    <s-page heading="Analytics">
      <div style={pageGridStyle}>
        <section style={heroStyle}>
          <div>
            <p style={eyebrowStyle}>Last 30 days</p>
            <h2 style={titleStyle}>{summary.orderCount} orders tracked</h2>
          </div>
          <s-button href="/app/install-check">Install check</s-button>
        </section>

        <div style={metricGridStyle}>
          <MetricCard
            label="Free shipping orders"
            value={String(summary.freeShippingOrders)}
            detail={`${summary.freeShippingRate}% of tracked orders`}
          />
          <MetricCard
            label="Shipping savings"
            value={money(summary.shippingSavingsCents, summary.currencyCode)}
            detail="Shipping discounts recorded"
          />
          <MetricCard
            label="Protection orders"
            value={String(summary.protectedOrders)}
            detail={money(summary.protectionRevenueCents, summary.currencyCode)}
          />
          <MetricCard
            label="Average order"
            value={money(summary.averageOrderCents, summary.currencyCode)}
            detail="Tracked order total"
          />
        </div>

        <section style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <p style={eyebrowStyle}>Recent orders</p>
              <h3 style={panelTitleStyle}>Free shipping activity</h3>
            </div>
          </div>

          {summary.recentOrders.length > 0 ? (
            <div style={tableStyle}>
              <div style={tableHeaderStyle}>
                <span>Order</span>
                <span>Date</span>
                <span>Total</span>
                <span>Shipping saved</span>
                <span>Protection</span>
              </div>
              {summary.recentOrders.map((order) => (
                <div key={`${order.orderName}-${order.orderCreatedAt}`} style={rowStyle}>
                  <strong>{order.orderName}</strong>
                  <span>{formatDate(order.orderCreatedAt)}</span>
                  <span>{money(order.totalCents, summary.currencyCode)}</span>
                  <span>
                    {order.freeShippingApplied
                      ? money(order.shippingSavingsCents, summary.currencyCode)
                      : "-"}
                  </span>
                  <span>
                    {order.protectionRevenueCents > 0
                      ? money(order.protectionRevenueCents, summary.currencyCode)
                      : "-"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyStateStyle}>
              <h3 style={panelTitleStyle}>No orders tracked yet</h3>
              <p style={bodyTextStyle}>
                New orders will appear here after the orders/create webhook is
                registered and the store has placed orders.
              </p>
              <Link to="/app/install-check">Check installation</Link>
            </div>
          )}
        </section>
      </div>
    </s-page>
  );
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <section style={metricCardStyle}>
      <span style={metricLabelStyle}>{label}</span>
      <strong style={metricValueStyle}>{value}</strong>
      <span style={metricDetailStyle}>{detail}</span>
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function money(cents: number, currencyCode: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

const pageGridStyle = {
  display: "grid",
  gap: "16px",
} satisfies CSSProperties;

const heroStyle = {
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid #d8dee4",
  borderRadius: 8,
  display: "flex",
  justifyContent: "space-between",
  padding: "20px",
} satisfies CSSProperties;

const metricGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
} satisfies CSSProperties;

const metricCardStyle = {
  background: "#ffffff",
  border: "1px solid #d8dee4",
  borderRadius: 8,
  display: "grid",
  gap: "8px",
  minHeight: 112,
  padding: "16px",
} satisfies CSSProperties;

const metricLabelStyle = {
  color: "#4b5563",
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
} satisfies CSSProperties;

const metricValueStyle = {
  color: "#061018",
  fontSize: 30,
  lineHeight: 1,
} satisfies CSSProperties;

const metricDetailStyle = {
  color: "#4b5563",
  fontSize: 13,
} satisfies CSSProperties;

const panelStyle = {
  background: "#ffffff",
  border: "1px solid #d8dee4",
  borderRadius: 8,
  padding: "18px",
} satisfies CSSProperties;

const panelHeaderStyle = {
  alignItems: "center",
  borderBottom: "1px solid #e6e9ec",
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 12,
  paddingBottom: 12,
} satisfies CSSProperties;

const eyebrowStyle = {
  color: "#4b5563",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0,
  margin: 0,
  textTransform: "uppercase",
} satisfies CSSProperties;

const titleStyle = {
  fontSize: 24,
  lineHeight: 1.2,
  margin: "4px 0 0",
} satisfies CSSProperties;

const panelTitleStyle = {
  fontSize: 18,
  lineHeight: 1.25,
  margin: "4px 0 0",
} satisfies CSSProperties;

const tableStyle = {
  display: "grid",
} satisfies CSSProperties;

const tableHeaderStyle = {
  color: "#4b5563",
  display: "grid",
  fontSize: 12,
  fontWeight: 800,
  gridTemplateColumns: "1.1fr 0.9fr 0.8fr 0.9fr 0.8fr",
  padding: "8px 0",
  textTransform: "uppercase",
} satisfies CSSProperties;

const rowStyle = {
  alignItems: "center",
  borderTop: "1px solid #edf0f2",
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "1.1fr 0.9fr 0.8fr 0.9fr 0.8fr",
  minHeight: 48,
} satisfies CSSProperties;

const emptyStateStyle = {
  alignItems: "center",
  display: "grid",
  gap: "8px",
  justifyItems: "center",
  minHeight: 180,
  textAlign: "center",
} satisfies CSSProperties;

const bodyTextStyle = {
  color: "#4b5563",
  margin: 0,
  maxWidth: 520,
} satisfies CSSProperties;
