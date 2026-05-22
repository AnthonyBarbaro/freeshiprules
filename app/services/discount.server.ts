import type { RuleSet } from "@prisma/client";
import db from "../db.server";
import { adminGraphql, userErrorMessage } from "./admin-graphql.server";
import {
  FUNCTION_HANDLE,
  FUNCTION_METAFIELD_KEY,
  FUNCTION_METAFIELD_NAMESPACE,
  FUNCTION_TITLE,
} from "./rule-config";
import {
  functionConfigFromRuleSet,
  updateRuleSyncMetadata,
} from "./rules.server";

type AdminClient = Parameters<typeof adminGraphql>[0];

type ShopifyFunctionsResponse = {
  shopifyFunctions: {
    nodes: Array<{
      id: string;
      title: string;
      apiType: string;
    }>;
  };
};

type DiscountMutationResponse = {
  discountAutomaticAppCreate?: DiscountPayload;
  discountAutomaticAppUpdate?: DiscountPayload;
};

type DiscountPayload = {
  automaticAppDiscount: {
    discountId: string;
    title: string;
    status: string;
    appDiscountType: { functionId: string };
  } | null;
  userErrors: Array<{ field?: string[] | null; message: string }>;
};

export async function getDeliveryDiscountFunction(admin: AdminClient) {
  const data = await adminGraphql<ShopifyFunctionsResponse>(
    admin,
    `#graphql
      query ShopifyFunctions {
        shopifyFunctions(first: 25) {
          nodes {
            id
            title
            apiType
          }
        }
      }`,
  );

  return (
    data.shopifyFunctions.nodes.find(
      (node) =>
        node.apiType.toLowerCase() === "discounts" &&
        (node.title === FUNCTION_TITLE ||
          node.title.toLowerCase().includes("freeship")),
    ) ??
    data.shopifyFunctions.nodes.find(
      (node) => node.apiType.toLowerCase() === "discounts",
    )
  );
}

export async function ensureDeliveryDiscount(
  admin: AdminClient,
  shopDomain: string,
  ruleSet: RuleSet,
) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop is not installed.");

  const shopifyFunction = await getDeliveryDiscountFunction(admin);
  if (!shopifyFunction) {
    await updateRuleSyncMetadata(ruleSet.id, {
      discountSyncError:
        "No Shopify discount function is deployed for this app yet.",
      functionHandle: FUNCTION_HANDLE,
      syncedAt: new Date().toISOString(),
    });
    throw new Error(
      "No Shopify discount function was found. Deploy the app extension, then run install check again.",
    );
  }

  const config = functionConfigFromRuleSet(ruleSet);
  const existingDiscountId = readAutomaticDiscountId(ruleSet.configJson);
  const input = {
    title: config.offerName || ruleSet.name,
    functionId: shopifyFunction.id,
    discountClasses: ["SHIPPING"],
    startsAt: new Date().toISOString(),
    combinesWith: {
      orderDiscounts: !config.blockOrderDiscounts,
      productDiscounts: !config.blockProductDiscounts,
      shippingDiscounts: !config.blockShippingDiscounts,
    },
    metafields: [
      {
        namespace: FUNCTION_METAFIELD_NAMESPACE,
        key: FUNCTION_METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  };

  const payload = existingDiscountId
    ? await updateDiscount(admin, existingDiscountId, input)
    : await createDiscount(admin, input);

  const error = userErrorMessage(payload.userErrors);
  if (error) {
    await updateRuleSyncMetadata(ruleSet.id, {
      discountSyncError: error,
      functionId: shopifyFunction.id,
      syncedAt: new Date().toISOString(),
    });
    throw new Error(error);
  }

  if (!payload.automaticAppDiscount) {
    throw new Error("Shopify did not return the automatic discount.");
  }

  const updatedRule = await updateRuleSyncMetadata(ruleSet.id, {
    automaticDiscountId: payload.automaticAppDiscount.discountId,
    functionId: shopifyFunction.id,
    functionTitle: shopifyFunction.title,
    functionHandle: FUNCTION_HANDLE,
    discountStatus: payload.automaticAppDiscount.status,
    discountSyncError: null,
    syncedAt: new Date().toISOString(),
  });

  await db.eventLog.create({
    data: {
      shopId: shop.id,
      type: "discount_synced",
      message: "Shipping discount configuration synced to Shopify.",
      metadataJson: {
        automaticDiscountId: payload.automaticAppDiscount.discountId,
        functionId: shopifyFunction.id,
      },
    },
  });

  return { discount: payload.automaticAppDiscount, ruleSet: updatedRule };
}

export async function verifyFunctionAndDiscount(
  admin: AdminClient,
  ruleSet: RuleSet,
) {
  const shopifyFunction = await getDeliveryDiscountFunction(admin);
  return {
    functionFound: Boolean(shopifyFunction),
    function: shopifyFunction ?? null,
    automaticDiscountId: readAutomaticDiscountId(ruleSet.configJson),
    config: functionConfigFromRuleSet(ruleSet),
  };
}

async function createDiscount(
  admin: AdminClient,
  automaticAppDiscount: Record<string, unknown>,
) {
  const data = await adminGraphql<DiscountMutationResponse>(
    admin,
    `#graphql
      mutation DiscountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          userErrors {
            field
            message
          }
          automaticAppDiscount {
            discountId
            title
            status
            appDiscountType {
              functionId
            }
          }
        }
      }`,
    { automaticAppDiscount },
  );

  return data.discountAutomaticAppCreate!;
}

async function updateDiscount(
  admin: AdminClient,
  id: string,
  automaticAppDiscount: Record<string, unknown>,
) {
  const updateInput = { ...automaticAppDiscount };
  delete updateInput.startsAt;
  const data = await adminGraphql<DiscountMutationResponse>(
    admin,
    `#graphql
      mutation DiscountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
          userErrors {
            field
            message
          }
          automaticAppDiscount {
            discountId
            title
            status
            appDiscountType {
              functionId
            }
          }
        }
      }`,
    { id, automaticAppDiscount: updateInput },
  );

  return data.discountAutomaticAppUpdate!;
}

function readAutomaticDiscountId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).automaticDiscountId;
  return typeof id === "string" && id ? id : null;
}
