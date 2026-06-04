import type { CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  analyticsSummaryForShopDomain,
  syncRecentOrderAnalyticsFromShopify,
} from "../services/analytics.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import {
  billingDisplayStatus,
  billingIsActive,
} from "../services/shop.server";

const RANGE_OPTIONS = [7, 30, 90];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const days = readRange(url.searchParams.get("days"));
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });
  const billingActive = billingIsActive(shop.billingStatus);

  return {
    billingActive,
    billingStatus: billingDisplayStatus(shop.billingStatus),
    days,
    summary: billingActive
      ? await analyticsSummaryForShopDomain(session.shop, days)
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const days = readRange(String(formData.get("days") ?? "30"));
  const { session } = await authenticate.admin(request);
  const result = await syncRecentOrderAnalyticsFromShopify({
    accessToken: session.accessToken,
    days,
    shopDomain: session.shop,
  });

  return Response.json({ ok: true, ...result });
};

export default function Analytics() {
  const { billingActive, billingStatus, days, summary } =
    useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<{
    ok?: boolean;
    scanned?: number;
    synced?: number;
  }>();
  const syncing = syncFetcher.state !== "idle";

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
            <p style={eyebrowStyle}>Reporting</p>
            <h2 style={titleStyle}>{days}-day business pulse</h2>
          </div>
          <div style={heroActionsStyle}>
            {syncFetcher.data?.ok && (
              <span style={syncStatusStyle}>
                Synced {syncFetcher.data.synced} of {syncFetcher.data.scanned}
              </span>
            )}
            <div style={rangeControlStyle} aria-label="Report range">
              {RANGE_OPTIONS.map((option) => (
                <Link
                  key={option}
                  style={{
                    ...rangeLinkStyle,
                    ...(option === days ? rangeLinkActiveStyle : {}),
                  }}
                  to={`/app/analytics?days=${option}`}
                >
                  {option}d
                </Link>
              ))}
            </div>
            <syncFetcher.Form method="post">
              <input name="days" type="hidden" value={days} />
              <s-button disabled={syncing} type="submit">
                {syncing ? "Syncing" : "Sync orders"}
              </s-button>
            </syncFetcher.Form>
            <s-button href="/app/install-check">Install check</s-button>
          </div>
        </section>

        <div style={metricGridStyle}>
          <MetricCard
            detail="gross less order discounts"
            label="Net sales"
            value={money(summary.netSalesCents, summary.currencyCode)}
          />
          <MetricCard
            detail={`${summary.itemQuantity} units sold`}
            label="Orders"
            value={compactNumber(summary.orderCount)}
          />
          <MetricCard
            detail={`${summary.averageUnitsPerOrder} units per order`}
            label="Average order"
            value={money(summary.averageOrderCents, summary.currencyCode)}
          />
          <MetricCard
            detail={`${summary.discountRate}% of gross sales`}
            label="Discounts"
            value={money(summary.discountCents, summary.currencyCode)}
          />
          <MetricCard
            detail={`${summary.freeShippingRate}% of orders`}
            label="Free shipping"
            value={compactNumber(summary.freeShippingOrders)}
          />
          <MetricCard
            detail="merchant-funded shipping"
            label="Shipping saved"
            value={money(summary.shippingSavingsCents, summary.currencyCode)}
          />
          <MetricCard
            detail={`${summary.protectionRate}% attach rate`}
            label="Protection"
            value={money(summary.protectionRevenueCents, summary.currencyCode)}
          />
          <MetricCard
            detail={`${summary.uniqueCustomerCount} known customers`}
            label="Repeat signal"
            value={compactNumber(summary.repeatCustomerOrders)}
          />
        </div>

        <div style={wideGridStyle}>
          <section style={panelStyle}>
            <PanelHeader eyebrow="Trend" title="Daily sales and order volume" />
            <TrendChart
              currencyCode={summary.currencyCode}
              rows={summary.dailySales}
            />
          </section>

          <section style={panelStyle}>
            <PanelHeader eyebrow="Mix" title="Order economics" />
            <div style={stackStyle}>
              <InsightRow
                label="Gross sales"
                value={money(summary.grossSalesCents, summary.currencyCode)}
              />
              <InsightRow
                label="Discounts"
                value={money(summary.discountCents, summary.currencyCode)}
              />
              <InsightRow
                label="Taxes"
                value={money(summary.taxCents, summary.currencyCode)}
              />
              <InsightRow
                label="Paid shipping collected"
                value={money(summary.paidShippingCents, summary.currencyCode)}
              />
              <InsightRow
                label="Shipping savings issued"
                value={money(
                  summary.shippingSavingsCents,
                  summary.currencyCode,
                )}
              />
              <InsightRow
                label="Protection revenue"
                value={money(
                  summary.protectionRevenueCents,
                  summary.currencyCode,
                )}
              />
            </div>
          </section>
        </div>

        <div style={reportGridStyle}>
          <RankedPanel
            amountLabel="Sales"
            currencyCode={summary.currencyCode}
            empty="No product data yet"
            rows={summary.topProducts}
            title="Top products"
          />
          <RankedPanel
            amountLabel="Shipping"
            currencyCode={summary.currencyCode}
            empty="No shipping methods yet"
            rows={summary.topShippingMethods}
            title="Shipping methods"
          />
          <RankedPanel
            amountLabel="Discounts"
            currencyCode={summary.currencyCode}
            empty="No discount codes yet"
            rows={summary.topDiscountCodes}
            title="Discount codes"
          />
          <RankedPanel
            amountLabel="Sales"
            currencyCode={summary.currencyCode}
            empty="No location data yet"
            rows={summary.topLocations}
            title="Locations"
          />
          <RankedPanel
            amountLabel="Sales"
            currencyCode={summary.currencyCode}
            empty="No channel data yet"
            rows={summary.sourceChannels}
            title="Sales channels"
          />
        </div>

        <section style={panelStyle}>
          <PanelHeader eyebrow="Orders" title="Recent order detail" />
          {summary.recentOrders.length > 0 ? (
            <div style={tableStyle}>
              <div style={tableHeaderStyle}>
                <span>Order</span>
                <span>Date</span>
                <span>Total</span>
                <span>Items</span>
                <span>Discount</span>
                <span>Shipping</span>
                <span>Protection</span>
                <span>Location</span>
              </div>
              {summary.recentOrders.map((order) => (
                <div
                  key={`${order.orderName}-${order.orderCreatedAt}`}
                  style={rowStyle}
                >
                  <div>
                    <strong>{order.orderName}</strong>
                    <span style={mutedBlockStyle}>{order.sourceName}</span>
                  </div>
                  <span>{formatDate(order.orderCreatedAt)}</span>
                  <strong>{money(order.totalCents, summary.currencyCode)}</strong>
                  <span>{order.itemQuantity}</span>
                  <span>
                    {order.discountCents > 0
                      ? money(order.discountCents, summary.currencyCode)
                      : "-"}
                  </span>
                  <span>
                    {order.freeShippingApplied
                      ? money(order.shippingSavingsCents, summary.currencyCode)
                      : order.shippingMethod}
                  </span>
                  <span>
                    {order.protectionRevenueCents > 0
                      ? money(
                          order.protectionRevenueCents,
                          summary.currencyCode,
                        )
                      : "-"}
                  </span>
                  <span>{order.location}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyStateStyle}>
              <h3 style={panelTitleStyle}>No orders tracked yet</h3>
              <p style={bodyTextStyle}>
                New orders will appear after the orders/create webhook receives
                storefront activity.
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

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={panelHeaderStyle}>
      <div>
        <p style={eyebrowStyle}>{eyebrow}</p>
        <h3 style={panelTitleStyle}>{title}</h3>
      </div>
    </div>
  );
}

function TrendChart({
  currencyCode,
  rows,
}: {
  currencyCode: string;
  rows: Array<{
    date: string;
    orderCount: number;
    revenueCents: number;
  }>;
}) {
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenueCents));
  const visibleRows = rows.slice(-30);

  return (
    <div style={trendWrapStyle}>
      <div style={trendBarsStyle}>
        {visibleRows.map((row) => {
          const height = Math.max(4, (row.revenueCents / maxRevenue) * 100);
          return (
            <div key={row.date} style={trendBarColumnStyle}>
              <div
                style={{
                  ...trendBarStyle,
                  height: `${height}%`,
                }}
                title={`${formatShortDate(row.date)}: ${money(
                  row.revenueCents,
                  currencyCode,
                )}`}
              />
            </div>
          );
        })}
      </div>
      <div style={trendFooterStyle}>
        <span>{formatShortDate(visibleRows[0]?.date)}</span>
        <span>
          {compactNumber(
            visibleRows.reduce((sum, row) => sum + row.orderCount, 0),
          )}{" "}
          orders
        </span>
        <span>{formatShortDate(visibleRows.at(-1)?.date)}</span>
      </div>
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={insightRowStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RankedPanel({
  amountLabel,
  currencyCode,
  empty,
  rows,
  title,
}: {
  amountLabel: string;
  currencyCode: string;
  empty: string;
  rows: Array<{
    amountCents: number;
    count: number;
    label: string;
    orderCount: number;
    sku?: string | null;
  }>;
  title: string;
}) {
  return (
    <section style={panelStyle}>
      <PanelHeader eyebrow="Report" title={title} />
      {rows.length > 0 ? (
        <div style={rankedListStyle}>
          {rows.map((row) => (
            <div key={`${title}-${row.label}`} style={rankedRowStyle}>
              <div style={rankedLabelStyle}>
                <strong>{row.label}</strong>
                <span style={mutedBlockStyle}>
                  {row.sku ? `${row.sku} / ` : ""}
                  {row.count} {row.count === 1 ? "item" : "items"} /{" "}
                  {row.orderCount} {row.orderCount === 1 ? "order" : "orders"}
                </span>
              </div>
              <div style={rankedAmountStyle}>
                <span>{amountLabel}</span>
                <strong>{money(row.amountCents, currencyCode)}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={compactEmptyStyle}>{empty}</div>
      )}
    </section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function readRange(value: string | null) {
  const days = Number(value);
  return RANGE_OPTIONS.includes(days) ? days : 30;
}

function money(cents: number, currencyCode: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function formatShortDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
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
  flexWrap: "wrap",
  gap: 12,
  justifyContent: "space-between",
  padding: "18px 20px",
} satisfies CSSProperties;

const heroActionsStyle = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
} satisfies CSSProperties;

const syncStatusStyle = {
  color: "#006d5b",
  fontSize: 13,
  fontWeight: 700,
} satisfies CSSProperties;

const rangeControlStyle = {
  background: "#f3f5f7",
  border: "1px solid #d8dee4",
  borderRadius: 8,
  display: "flex",
  padding: 3,
} satisfies CSSProperties;

const rangeLinkStyle = {
  borderRadius: 6,
  color: "#25313b",
  fontSize: 13,
  fontWeight: 700,
  padding: "6px 10px",
  textDecoration: "none",
} satisfies CSSProperties;

const rangeLinkActiveStyle = {
  background: "#ffffff",
  boxShadow: "0 1px 4px rgba(6, 16, 24, 0.12)",
  color: "#006d5b",
} satisfies CSSProperties;

const metricGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const metricCardStyle = {
  background: "#ffffff",
  border: "1px solid #d8dee4",
  borderRadius: 8,
  display: "grid",
  gap: "8px",
  minHeight: 116,
  padding: "16px",
} satisfies CSSProperties;

const metricLabelStyle = {
  color: "#4b5563",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0,
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

const wideGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const reportGridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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

const trendWrapStyle = {
  display: "grid",
  gap: 10,
} satisfies CSSProperties;

const trendBarsStyle = {
  alignItems: "end",
  background: "#f7f9fa",
  border: "1px solid #edf0f2",
  borderRadius: 8,
  display: "grid",
  gap: 4,
  gridAutoColumns: "1fr",
  gridAutoFlow: "column",
  height: 220,
  padding: "14px",
} satisfies CSSProperties;

const trendBarColumnStyle = {
  alignItems: "end",
  display: "flex",
  height: "100%",
  minWidth: 6,
} satisfies CSSProperties;

const trendBarStyle = {
  background: "linear-gradient(180deg, #008060, #53a6a2)",
  borderRadius: "6px 6px 2px 2px",
  minHeight: 4,
  width: "100%",
} satisfies CSSProperties;

const trendFooterStyle = {
  color: "#4b5563",
  display: "flex",
  fontSize: 12,
  justifyContent: "space-between",
} satisfies CSSProperties;

const stackStyle = {
  display: "grid",
  gap: 10,
} satisfies CSSProperties;

const insightRowStyle = {
  alignItems: "center",
  borderBottom: "1px solid #edf0f2",
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
} satisfies CSSProperties;

const rankedListStyle = {
  display: "grid",
  gap: 10,
} satisfies CSSProperties;

const rankedRowStyle = {
  alignItems: "center",
  borderBottom: "1px solid #edf0f2",
  display: "grid",
  gap: 12,
  gridTemplateColumns: "minmax(0, 1fr) auto",
  padding: "8px 0",
} satisfies CSSProperties;

const rankedLabelStyle = {
  display: "grid",
  gap: 3,
  minWidth: 0,
} satisfies CSSProperties;

const rankedAmountStyle = {
  display: "grid",
  gap: 3,
  justifyItems: "end",
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const tableStyle = {
  display: "grid",
  overflowX: "auto",
} satisfies CSSProperties;

const tableHeaderStyle = {
  color: "#4b5563",
  display: "grid",
  fontSize: 12,
  fontWeight: 800,
  gridTemplateColumns: "1fr 0.7fr 0.8fr 0.5fr 0.8fr 0.9fr 0.8fr 1.2fr",
  minWidth: 980,
  padding: "8px 0",
  textTransform: "uppercase",
} satisfies CSSProperties;

const rowStyle = {
  alignItems: "center",
  borderTop: "1px solid #edf0f2",
  display: "grid",
  gap: "10px",
  gridTemplateColumns: "1fr 0.7fr 0.8fr 0.5fr 0.8fr 0.9fr 0.8fr 1.2fr",
  minHeight: 56,
  minWidth: 980,
} satisfies CSSProperties;

const mutedBlockStyle = {
  color: "#66707a",
  display: "block",
  fontSize: 12,
  marginTop: 2,
} satisfies CSSProperties;

const compactEmptyStyle = {
  color: "#66707a",
  minHeight: 80,
  paddingTop: 12,
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
