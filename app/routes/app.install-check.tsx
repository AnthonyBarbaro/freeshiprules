import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  ensureDeliveryDiscount,
  verifyFunctionAndDiscount,
} from "../services/discount.server";
import { getRuleSetForShopDomain } from "../services/rules.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const record = await getRuleSetForShopDomain(session.shop);
  if (!record) throw new Response("Shop not found", { status: 404 });

  let syncError: string | null = null;
  let ruleSet = record.ruleSet;
  try {
    const synced = await ensureDeliveryDiscount(
      admin,
      session.shop,
      record.ruleSet,
    );
    ruleSet = synced.ruleSet;
  } catch (error) {
    syncError = error instanceof Error ? error.message : "Sync failed";
  }

  const status = await verifyFunctionAndDiscount(admin, ruleSet);
  return {
    status,
    syncError,
    runtime: {
      appKey: maskAppKey(process.env.SHOPIFY_API_KEY),
      scopes: process.env.SCOPES ?? "",
    },
  };
};

export default function InstallCheck() {
  const { runtime, status, syncError } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Install check">
      {syncError ? (
        <s-banner tone="warning">
          <s-paragraph>{syncError}</s-paragraph>
        </s-banner>
      ) : (
        <s-banner tone="success">
          <s-paragraph>Function discount configuration is synced.</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Function">
        <s-stack direction="block" gap="base">
          <s-box>
            <s-text>Handle: {status.functionHandle}</s-text>
          </s-box>
          <s-box>
            <s-text>
              Admin lookup: {status.functionFound ? "found" : "not required"}
            </s-text>
          </s-box>
          {status.function && (
            <>
              <s-box>
                <s-text>Title: {status.function.title}</s-text>
              </s-box>
              <s-box>
                <s-text>ID: {status.function.id}</s-text>
              </s-box>
            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Diagnostic">
        <s-stack direction="block" gap="base">
          <s-box>
            <s-text>Runtime app key: {runtime.appKey}</s-text>
          </s-box>
          <s-box>
            <s-text>Scopes: {runtime.scopes || "Not set"}</s-text>
          </s-box>
          <s-box>
            <s-text>Functions returned: {status.functions.length}</s-text>
          </s-box>
          {status.functions.map((shopifyFunction) => (
            <s-box key={shopifyFunction.id}>
              <s-text>
                {shopifyFunction.title} / {shopifyFunction.apiType} /{" "}
                {shopifyFunction.id}
              </s-text>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Discount">
        <s-box>
          <s-text>
            Automatic discount ID: {status.automaticDiscountId || "Not created"}
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function maskAppKey(value?: string) {
  if (!value) return "Not set";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
