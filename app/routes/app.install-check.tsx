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
  return { status, syncError };
};

export default function InstallCheck() {
  const { status, syncError } = useLoaderData<typeof loader>();

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
            <s-text>Found: {status.functionFound ? "yes" : "no"}</s-text>
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
