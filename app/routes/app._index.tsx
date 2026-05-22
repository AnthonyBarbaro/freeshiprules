import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import { getRuleSetForShopDomain } from "../services/rules.server";
import { billingIsActive } from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: true,
  });
  const record = await getRuleSetForShopDomain(session.shop);

  if (!billingIsActive(shop.billingStatus)) {
    throw redirect("/app/billing");
  }

  return {
    shopDomain: session.shop,
    billingStatus: shop.billingStatus,
    billingActive: billingIsActive(shop.billingStatus),
    rule: record?.ruleSet
      ? {
          enabled: record.ruleSet.enabled,
          name: record.ruleSet.name,
          minSubtotalCents: record.ruleSet.minSubtotalCents,
          maxWeightGrams: record.ruleSet.maxWeightGrams,
          maxQuantity: record.ruleSet.maxQuantity,
          blockDiscountCodes: record.ruleSet.blockDiscountCodes,
          blockOrderDiscounts: record.ruleSet.blockOrderDiscounts,
          blockProductDiscounts: record.ruleSet.blockProductDiscounts,
          blockShippingDiscounts: record.ruleSet.blockShippingDiscounts,
          updatedAt: record.ruleSet.updatedAt.toISOString(),
        }
      : null,
  };
};

export default function Dashboard() {
  const { shopDomain, billingStatus, billingActive, rule } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="FreeShip Rules">
      <s-button slot="primary-action" href="/app/settings">
        Edit rules
      </s-button>

      <s-section heading="Status">
        <s-stack direction="block" gap="base">
          <s-box>
            <s-text>Store: {shopDomain}</s-text>
          </s-box>
          <s-box>
            <s-text>Billing: {billingStatus}</s-text>
          </s-box>
          {!billingActive && (
            <s-banner tone="warning">
              <s-paragraph>
                Billing must be approved before settings can be saved.
              </s-paragraph>
              <s-button href="/app/billing">Open billing</s-button>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Active rule">
        {rule ? (
          <s-stack direction="block" gap="base">
            <s-box>
              <s-text>
                {rule.enabled ? "Enabled" : "Disabled"}: {rule.name}
              </s-text>
            </s-box>
            <s-box>
              <s-text>
                Minimum subtotal: {formatMoney(rule.minSubtotalCents)}
              </s-text>
            </s-box>
            <s-box>
              <s-text>
                Maximum weight: {formatPounds(rule.maxWeightGrams)} lb
              </s-text>
            </s-box>
            <s-box>
              <s-text>Maximum quantity: {rule.maxQuantity}</s-text>
            </s-box>
            <s-box>
              <s-text>
                Stacking blocks:{" "}
                {[
                  rule.blockDiscountCodes && "discount codes",
                  rule.blockOrderDiscounts && "order",
                  rule.blockProductDiscounts && "product",
                  rule.blockShippingDiscounts && "shipping",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </s-text>
            </s-box>
          </s-stack>
        ) : (
          <s-paragraph>No rule has been created yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Setup">
        <s-unordered-list>
          <s-list-item>
            <Link to="/app/billing">Approve the monthly plan</Link>
          </s-list-item>
          <s-list-item>
            <Link to="/app/settings">Configure your free shipping rule</Link>
          </s-list-item>
          <s-list-item>
            <Link to="/app/install-check">Verify the Function discount</Link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
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
