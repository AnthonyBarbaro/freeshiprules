import type { Prisma, ShippingProtection } from "@prisma/client";
import db from "../db.server";
import { adminGraphql, userErrorMessage } from "./admin-graphql.server";
import {
  assertProtectionVariantLimit,
  centsToDecimal,
  defaultShippingProtectionConfig,
  moneyLabel,
  normalizeShippingProtectionInput,
  protectionAmountKey,
  requiredProtectionVariantAmounts,
  type ShippingProtectionConfig,
  type ShippingProtectionInput,
  type ShippingProtectionVariantMap,
} from "./shipping-protection-config";

const PROTECTION_PRODUCT_TAG = "freeship-rules-shipping-protection";
const PROTECTION_PRODUCT_TYPE = "Shipping Protection";
const PROTECTION_VENDOR = "FreeShip Rules";
const PROTECTION_MEDIA_ALT = "Shipping protection shield by FreeShip Rules";

type AdminClient = Parameters<typeof adminGraphql>[0];

type ProductVariantNode = {
  id: string;
  legacyResourceId: string;
  title: string;
  price: string;
  selectedOptions: Array<{ name: string; value: string }>;
};
type ProductMediaNode = {
  id: string;
  alt?: string | null;
  mediaContentType: string;
  status: string;
};

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  media: { nodes: ProductMediaNode[] };
  variants: { nodes: ProductVariantNode[] };
};

type ProductPayload = {
  product: ProductNode | null;
  userErrors: Array<{ field?: string[] | null; message: string }>;
};

type ProductMutationResponse = {
  productCreate?: ProductPayload;
  productUpdate?: ProductPayload;
  productVariantsBulkCreate?: {
    productVariants: ProductVariantNode[];
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
  productVariantsBulkUpdate?: {
    productVariants: ProductVariantNode[];
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
  productCreateMedia?: {
    media: ProductMediaNode[] | null;
    mediaUserErrors: Array<{ field?: string[] | null; message: string }>;
  };
  publishablePublish?: {
    publishable: { id: string } | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

export type StorefrontShippingProtectionConfig = ShippingProtectionConfig & {
  productId: string | null;
  variantMap: ShippingProtectionVariantMap;
  setupRequired: boolean;
};

export async function ensureDefaultShippingProtection(shopId: string) {
  const existing = await db.shippingProtection.findUnique({
    where: { shopId },
  });

  if (existing) return existing;

  const defaults = defaultShippingProtectionConfig();
  return db.shippingProtection.create({
    data: {
      shopId,
      ...settingsData(defaults),
    },
  });
}

export async function getShippingProtectionForShopDomain(shopDomain: string) {
  const shop = await db.shop.findUnique({
    where: { shopDomain },
    include: { shippingProtection: true },
  });

  if (!shop) return null;

  const shippingProtection =
    shop.shippingProtection ?? (await ensureDefaultShippingProtection(shop.id));

  return { shop, shippingProtection };
}

export async function saveShippingProtectionSettings(
  shopDomain: string,
  input: ShippingProtectionInput,
) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop is not installed.");

  const existing = await ensureDefaultShippingProtection(shop.id);
  const normalized = normalizeShippingProtectionInput(input);

  return db.shippingProtection.update({
    where: { id: existing.id },
    data: settingsData(normalized),
  });
}

export function shippingProtectionConfigFromRecord(
  shippingProtection: ShippingProtection,
): ShippingProtectionConfig {
  return normalizeShippingProtectionInput({
    enabled: shippingProtection.enabled,
    pricingMode: shippingProtection.pricingMode,
    productTitle: shippingProtection.productTitle,
    widgetHeading: shippingProtection.widgetHeading,
    widgetDescription: shippingProtection.widgetDescription,
    optInLabel: shippingProtection.optInLabel,
    defaultSelected: shippingProtection.defaultSelected,
    tiersJson: shippingProtection.tiersJson,
    formulaJson: shippingProtection.formulaJson,
  });
}

export function storefrontShippingProtectionConfigFromRecord(
  shippingProtection: ShippingProtection,
): StorefrontShippingProtectionConfig {
  const config = shippingProtectionConfigFromRecord(shippingProtection);
  const variantMap = shippingProtectionVariantMapFromRecord(shippingProtection);

  return {
    ...config,
    enabled: config.enabled && Object.keys(variantMap).length > 0,
    productId: shippingProtection.productId,
    variantMap,
    setupRequired: config.enabled && Object.keys(variantMap).length === 0,
  };
}

export function shippingProtectionVariantMapFromRecord(
  shippingProtection: ShippingProtection,
): ShippingProtectionVariantMap {
  if (!isRecord(shippingProtection.variantMapJson)) return {};

  return Object.entries(shippingProtection.variantMapJson).reduce(
    (map, [key, value]) => {
      if (!isRecord(value)) return map;
      const variantId = typeof value.variantId === "string" ? value.variantId : "";
      const legacyVariantId =
        typeof value.legacyVariantId === "string"
          ? value.legacyVariantId
          : String(value.legacyVariantId ?? "");
      const title = typeof value.title === "string" ? value.title : moneyLabel(Number(key));
      const priceCents = Number(value.priceCents ?? key);

      if (variantId && legacyVariantId && Number.isFinite(priceCents)) {
        map[key] = {
          variantId,
          legacyVariantId,
          title,
          priceCents,
        };
      }

      return map;
    },
    {} as ShippingProtectionVariantMap,
  );
}

export async function ensureShippingProtectionProduct(
  admin: AdminClient,
  shopDomain: string,
  shippingProtection?: ShippingProtection,
) {
  const record =
    shippingProtection ??
    (await getShippingProtectionForShopDomain(shopDomain))?.shippingProtection;
  if (!record) throw new Error("Shop is not installed.");

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error("Shop is not installed.");

  const config = shippingProtectionConfigFromRecord(record);
  const amounts = requiredProtectionVariantAmounts(config);
  assertProtectionVariantLimit(amounts);

  let product =
    (record.productId && (await getProtectionProduct(admin, record.productId))) ||
    (await findExistingProtectionProduct(admin));

  if (!product) {
    product = await createProtectionProduct(admin, config);
  } else {
    await updateProtectionProduct(admin, product.id, config);
  }

  const existingMap = variantsByAmount(product.variants.nodes, amounts);
  const missingAmounts = amounts.filter(
    (amount) => !existingMap[protectionAmountKey(amount)],
  );

  if (missingAmounts.length > 0) {
    await createProtectionVariants(admin, product.id, missingAmounts);
  }

  const latestProduct = await getProtectionProduct(admin, product.id);
  if (!latestProduct) throw new Error("Shipping protection product was removed.");

  const variantMap = variantsByAmount(latestProduct.variants.nodes, amounts);
  await updateProtectionVariantPrices(admin, latestProduct.id, variantMap);
  await tryEnsureProtectionProductMedia(admin, latestProduct);
  await tryPublishProtectionProduct(admin, latestProduct.id);

  const updatedSettings = await db.shippingProtection.update({
    where: { id: record.id },
    data: {
      productId: latestProduct.id,
      variantMapJson: variantMap as Prisma.InputJsonObject,
      syncError: null,
      syncedAt: new Date(),
    },
  });

  await db.eventLog.create({
    data: {
      shopId: shop.id,
      type: "shipping_protection_synced",
      message: "Shipping protection product and prices synced to Shopify.",
      metadataJson: {
        productId: latestProduct.id,
        variantCount: Object.keys(variantMap).length,
      },
    },
  });

  return {
    product: latestProduct,
    settings: updatedSettings,
    variantMap,
  };
}

export async function markShippingProtectionSyncError(
  shippingProtectionId: string,
  error: string,
) {
  return db.shippingProtection.update({
    where: { id: shippingProtectionId },
    data: {
      syncError: error,
      syncedAt: new Date(),
    },
  });
}

function settingsData(config: ShippingProtectionConfig) {
  return {
    enabled: config.enabled,
    pricingMode: config.pricingMode,
    productTitle: config.productTitle,
    widgetHeading: config.widgetHeading,
    widgetDescription: config.widgetDescription,
    optInLabel: config.optInLabel,
    defaultSelected: config.defaultSelected,
    tiersJson: config.tiers as Prisma.InputJsonArray,
    formulaJson: config.formula as Prisma.InputJsonObject,
  };
}

async function getProtectionProduct(admin: AdminClient, id: string) {
  const data = await adminGraphql<{ node: ProductNode | null }>(
    admin,
    `#graphql
      query ProtectionProduct($id: ID!) {
        node(id: $id) {
          ... on Product {
            id
            title
            handle
            status
            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType
                status
              }
            }
            variants(first: 250) {
              nodes {
                id
                legacyResourceId
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
    { id },
  );

  return data.node;
}

async function findExistingProtectionProduct(admin: AdminClient) {
  const data = await adminGraphql<{
    products: { nodes: ProductNode[] };
  }>(
    admin,
    `#graphql
      query ExistingProtectionProduct($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            status
            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType
                status
              }
            }
            variants(first: 250) {
              nodes {
                id
                legacyResourceId
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
    { query: `tag:${PROTECTION_PRODUCT_TAG}` },
  );

  return data.products.nodes[0] ?? null;
}

async function createProtectionProduct(
  admin: AdminClient,
  config: ShippingProtectionConfig,
) {
  const data = await adminGraphql<ProductMutationResponse>(
    admin,
    `#graphql
      mutation ProtectionProductCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          userErrors {
            field
            message
          }
          product {
            id
            title
            handle
            status
            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType
                status
              }
            }
            variants(first: 250) {
              nodes {
                id
                legacyResourceId
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
    {
      product: productInput(config),
    },
  );

  const payload = data.productCreate!;
  const error = userErrorMessage(payload.userErrors);
  if (error) throw new Error(error);
  if (!payload.product) throw new Error("Shopify did not create the product.");

  return payload.product;
}

async function updateProtectionProduct(
  admin: AdminClient,
  productId: string,
  config: ShippingProtectionConfig,
) {
  const data = await adminGraphql<ProductMutationResponse>(
    admin,
    `#graphql
      mutation ProtectionProductUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          userErrors {
            field
            message
          }
          product {
            id
            title
            handle
            status
            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType
                status
              }
            }
            variants(first: 250) {
              nodes {
                id
                legacyResourceId
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }`,
    {
      product: {
        id: productId,
        ...productInput(config),
      },
    },
  );

  const payload = data.productUpdate!;
  const error = userErrorMessage(payload.userErrors);
  if (error) throw new Error(error);
  return payload.product;
}

async function createProtectionVariants(
  admin: AdminClient,
  productId: string,
  amounts: number[],
) {
  const data = await adminGraphql<ProductMutationResponse>(
    admin,
    `#graphql
      mutation ProtectionVariantsCreate(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkCreate(
          productId: $productId
          variants: $variants
          strategy: REMOVE_STANDALONE_VARIANT
        ) {
          userErrors {
            field
            message
          }
          productVariants {
            id
            legacyResourceId
            title
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }`,
    {
      productId,
      variants: amounts.map((amount) => variantInput(amount)),
    },
  );

  const payload = data.productVariantsBulkCreate!;
  const error = userErrorMessage(payload.userErrors);
  if (error) throw new Error(error);

  return payload.productVariants;
}

async function updateProtectionVariantPrices(
  admin: AdminClient,
  productId: string,
  variantMap: ShippingProtectionVariantMap,
) {
  const variants = Object.values(variantMap).map((variant) => ({
    id: variant.variantId,
    price: centsToDecimal(variant.priceCents),
    taxable: false,
    inventoryItem: {
      tracked: false,
      requiresShipping: false,
    },
  }));

  if (variants.length === 0) return [];

  const data = await adminGraphql<ProductMutationResponse>(
    admin,
    `#graphql
      mutation ProtectionVariantsUpdate(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors {
            field
            message
          }
          productVariants {
            id
            legacyResourceId
            title
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }`,
    { productId, variants },
  );

  const payload = data.productVariantsBulkUpdate!;
  const error = userErrorMessage(payload.userErrors);
  if (error) throw new Error(error);

  return payload.productVariants;
}

async function tryEnsureProtectionProductMedia(
  admin: AdminClient,
  product: ProductNode,
) {
  const mediaUrl = protectionMediaUrl();
  if (!mediaUrl || productHasProtectionMedia(product)) return;

  try {
    const data = await adminGraphql<ProductMutationResponse>(
      admin,
      `#graphql
        mutation ProtectionProductMediaCreate(
          $productId: ID!
          $media: [CreateMediaInput!]!
        ) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              id
              alt
              mediaContentType
              status
            }
            mediaUserErrors {
              field
              message
            }
          }
        }`,
      {
        productId: product.id,
        media: [
          {
            alt: PROTECTION_MEDIA_ALT,
            mediaContentType: "IMAGE",
            originalSource: mediaUrl,
          },
        ],
      },
    );
    const error = userErrorMessage(data.productCreateMedia?.mediaUserErrors);
    if (error) {
      console.warn(`Shipping protection media skipped: ${error}`);
    }
  } catch (error) {
    console.warn(
      `Shipping protection media skipped: ${
        error instanceof Error ? error.message : "Unknown media error"
      }`,
    );
  }
}

async function tryPublishProtectionProduct(admin: AdminClient, productId: string) {
  try {
    const data = await adminGraphql<{
      publications: { nodes: Array<{ id: string; name: string }> };
    }>(
      admin,
      `#graphql
        query StorefrontPublications {
          publications(first: 25) {
            nodes {
              id
              name
            }
          }
        }`,
    );
    const publication =
      data.publications.nodes.find((node) =>
        node.name.toLowerCase().includes("online store"),
      ) ?? data.publications.nodes[0];

    if (!publication) return;

    const payload = await adminGraphql<ProductMutationResponse>(
      admin,
      `#graphql
        mutation PublishProtectionProduct($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            userErrors {
              field
              message
            }
            publishable {
              ... on Product {
                id
              }
            }
          }
        }`,
      { id: productId, input: [{ publicationId: publication.id }] },
    );
    const error = userErrorMessage(payload.publishablePublish?.userErrors);
    if (error) console.warn(`Shipping protection publish skipped: ${error}`);
  } catch (error) {
    console.warn(
      `Shipping protection publish skipped: ${
        error instanceof Error ? error.message : "Unknown publication error"
      }`,
    );
  }
}

function productHasProtectionMedia(product: ProductNode) {
  return product.media.nodes.some((media) => media.alt === PROTECTION_MEDIA_ALT);
}

function protectionMediaUrl() {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) return null;

  try {
    const url = new URL("/shipping-protection.png?v=1", appUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function productInput(config: ShippingProtectionConfig) {
  return {
    title: config.productTitle,
    descriptionHtml: `<p>${escapeHtml(config.widgetDescription)}</p>`,
    productType: PROTECTION_PRODUCT_TYPE,
    vendor: PROTECTION_VENDOR,
    status: "ACTIVE",
    tags: [PROTECTION_PRODUCT_TAG],
  };
}

function variantInput(amountCents: number) {
  return {
    optionValues: [{ optionName: "Title", name: moneyLabel(amountCents) }],
    price: centsToDecimal(amountCents),
    taxable: false,
    inventoryItem: {
      tracked: false,
      requiresShipping: false,
    },
  };
}

function variantsByAmount(
  variants: ProductVariantNode[],
  amounts: number[],
): ShippingProtectionVariantMap {
  const allowed = new Set(amounts.map(protectionAmountKey));

  return variants.reduce((map, variant) => {
    const amount = amountFromVariant(variant);
    const key = protectionAmountKey(amount);
    if (!allowed.has(key) || amount <= 0) return map;

    map[key] = {
      variantId: variant.id,
      legacyVariantId: String(variant.legacyResourceId),
      title: moneyLabel(amount),
      priceCents: amount,
    };

    return map;
  }, {} as ShippingProtectionVariantMap);
}

function amountFromVariant(variant: ProductVariantNode) {
  const value =
    variant.selectedOptions.find((option) => option.name === "Title")?.value ??
    variant.selectedOptions[0]?.value ??
    variant.title;
  const match = String(value).match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) return 0;

  return Math.round(Number(match[1]) * 100);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
