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
  getRuleSetForShopDomain,
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

type AutomaticDiscountNodesResponse = {
  automaticDiscountNodes: {
    nodes: Array<{
      id: string;
      automaticDiscount: AutomaticAppDiscount | { __typename: string } | null;
    }>;
  };
};

type AutomaticAppDiscount = {
  __typename: "DiscountAutomaticApp";
  discountId: string;
  title: string;
  status: string;
  appDiscountType: {
    appKey: string;
    functionId: string;
    title: string;
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
  const functions = await listShopifyFunctions(admin);

  return findDeliveryDiscountFunction(functions);
}

export async function listShopifyFunctions(admin: AdminClient) {
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

  return data.shopifyFunctions.nodes;
}

function findDeliveryDiscountFunction(
  functions: ShopifyFunctionsResponse["shopifyFunctions"]["nodes"],
) {
  const titleMatches = functions.filter((node) =>
    titleLooksLikeFreeShipFunction(node.title),
  );

  return (
    titleMatches.find((node) => apiTypeLooksLikeDiscount(node.apiType)) ??
    titleMatches[0] ??
    functions.find((node) => apiTypeLooksLikeDiscount(node.apiType))
  );
}

export async function ensureDeliveryDiscount(
  admin: AdminClient,
  shopDomain: string,
  ruleSet: RuleSet,
) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop is not installed.");

  const config = functionConfigFromRuleSet(ruleSet);
  const existingDiscountId = readAutomaticDiscountId(ruleSet.configJson);
  const input = {
    title: config.offerName || ruleSet.name,
    functionHandle: FUNCTION_HANDLE,
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

  const payload = await upsertDiscount(admin, existingDiscountId, input);

  await assertDiscountPayload(ruleSet.id, payload);

  if (!payload.automaticAppDiscount) {
    throw new Error("Shopify did not return the automatic discount.");
  }

  const updatedRule = await updateRuleSyncMetadata(ruleSet.id, {
    automaticDiscountId: payload.automaticAppDiscount.discountId,
    functionId: payload.automaticAppDiscount.appDiscountType.functionId,
    functionTitle: FUNCTION_TITLE,
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
        functionHandle: FUNCTION_HANDLE,
        functionId: payload.automaticAppDiscount.appDiscountType.functionId,
      },
    },
  });

  return { discount: payload.automaticAppDiscount, ruleSet: updatedRule };
}

export async function suspendDeliveryDiscount(
  admin: AdminClient,
  shopDomain: string,
  ruleSet?: RuleSet,
) {
  const record = ruleSet
    ? { ruleSet }
    : await getRuleSetForShopDomain(shopDomain).then((value) =>
        value ? { ruleSet: value.ruleSet } : null,
      );

  if (!record) return { discount: null, ruleSet: null };

  const config = {
    ...functionConfigFromRuleSet(record.ruleSet),
    enabled: false,
  };
  const title = config.offerName || record.ruleSet.name;
  const discountId =
    readAutomaticDiscountId(record.ruleSet.configJson) ||
    (await findExistingAppDiscountId(admin, title));

  if (!discountId) return { discount: null, ruleSet: record.ruleSet };

  const payload = await updateDiscount(admin, discountId, {
    title,
    functionHandle: FUNCTION_HANDLE,
    discountClasses: ["SHIPPING"],
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
    metafields: [
      {
        namespace: FUNCTION_METAFIELD_NAMESPACE,
        key: FUNCTION_METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  });

  const error = userErrorMessage(payload.userErrors);
  if (isMissingDiscountError(error)) {
    const updatedRule = await updateRuleSyncMetadata(record.ruleSet.id, {
      automaticDiscountId: null,
      functionHandle: FUNCTION_HANDLE,
      discountStatus: "MISSING",
      discountSyncError: null,
      syncedAt: new Date().toISOString(),
    });

    return { discount: null, ruleSet: updatedRule };
  }
  if (error) throw new Error(error);

  const updatedRule = await updateRuleSyncMetadata(record.ruleSet.id, {
    automaticDiscountId: discountId,
    functionHandle: FUNCTION_HANDLE,
    discountStatus: payload.automaticAppDiscount?.status ?? "SUSPENDED",
    discountSyncError: null,
    syncedAt: new Date().toISOString(),
  });

  return { discount: payload.automaticAppDiscount, ruleSet: updatedRule };
}

export async function verifyFunctionAndDiscount(
  admin: AdminClient,
  ruleSet: RuleSet,
) {
  const functions = await listShopifyFunctions(admin);
  const shopifyFunction = findDeliveryDiscountFunction(functions);
  return {
    functionFound: Boolean(shopifyFunction),
    function: shopifyFunction ?? null,
    functionHandle: FUNCTION_HANDLE,
    functions,
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

async function upsertDiscount(
  admin: AdminClient,
  existingDiscountId: string | null,
  automaticAppDiscount: Record<string, unknown>,
) {
  const title = String(automaticAppDiscount.title ?? "");
  const discountId =
    existingDiscountId || (await findExistingAppDiscountId(admin, title));

  if (!discountId) return createDiscount(admin, automaticAppDiscount);

  const updatePayload = await updateDiscount(
    admin,
    discountId,
    automaticAppDiscount,
  );
  const error = userErrorMessage(updatePayload.userErrors);
  if (!isMissingDiscountError(error)) return updatePayload;

  const recoveredDiscountId = await findExistingAppDiscountId(admin, title);
  if (recoveredDiscountId && recoveredDiscountId !== discountId) {
    const recoveredPayload = await updateDiscount(
      admin,
      recoveredDiscountId,
      automaticAppDiscount,
    );
    const recoveredError = userErrorMessage(recoveredPayload.userErrors);
    if (!isMissingDiscountError(recoveredError)) return recoveredPayload;
  }

  return createDiscount(admin, automaticAppDiscount);
}

async function assertDiscountPayload(
  ruleSetId: string,
  payload: DiscountPayload,
) {
  const error = userErrorMessage(payload.userErrors);
  if (!error) return;

  await updateRuleSyncMetadata(ruleSetId, {
    discountSyncError: error,
    functionHandle: FUNCTION_HANDLE,
    syncedAt: new Date().toISOString(),
  });
  throw new Error(error);
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

function isMissingDiscountError(error: string | null) {
  return Boolean(error && /discount does not exist/i.test(error));
}

async function findExistingAppDiscountId(admin: AdminClient, title: string) {
  const data = await adminGraphql<AutomaticDiscountNodesResponse>(
    admin,
    `#graphql
      query AutomaticDiscountNodes($query: String) {
        automaticDiscountNodes(first: 50, query: $query) {
          nodes {
            id
            automaticDiscount {
              __typename
              ... on DiscountAutomaticApp {
                discountId
                title
                status
                appDiscountType {
                  appKey
                  functionId
                  title
                }
              }
            }
          }
        }
      }`,
    { query: "type:app" },
  );

  const appKey = process.env.SHOPIFY_API_KEY ?? "";
  const matchingDiscount = data.automaticDiscountNodes.nodes
    .map((node) => node.automaticDiscount)
    .find(
      (discount) =>
        isAutomaticAppDiscount(discount) &&
        discount.title === title &&
        (!appKey || discount.appDiscountType.appKey === appKey) &&
        titleLooksLikeFreeShipFunction(discount.appDiscountType.title),
    );

  if (isAutomaticAppDiscount(matchingDiscount)) {
    return matchingDiscount.discountId;
  }

  return null;
}

function readAutomaticDiscountId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).automaticDiscountId;
  return typeof id === "string" && id ? id : null;
}

function isAutomaticAppDiscount(
  discount: AutomaticAppDiscount | { __typename: string } | null | undefined,
): discount is AutomaticAppDiscount {
  return discount?.__typename === "DiscountAutomaticApp";
}

function apiTypeLooksLikeDiscount(apiType: string) {
  return apiType.toLowerCase().includes("discount");
}

function titleLooksLikeFreeShipFunction(title: string) {
  const normalizedTitle = title.toLowerCase().replace(/[\s_-]+/g, "");
  const normalizedExpectedTitle = FUNCTION_TITLE.toLowerCase().replace(
    /[\s_-]+/g,
    "",
  );

  return (
    normalizedTitle === normalizedExpectedTitle ||
    normalizedTitle.includes("freeship")
  );
}
