import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { shopifyApi, type Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { redirect } from "react-router";
import prisma from "./db.server";

const appUrl = process.env.SHOPIFY_APP_URL || "";
const scopes = process.env.SCOPES?.split(",").map((scope) => scope.trim()).filter(Boolean);
const appOrigin = appUrl ? new URL(appUrl).origin : "";

const legacyShopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes,
  hostName: appOrigin.replace(/^https?:\/\//, ""),
  hostScheme: "https",
  isEmbeddedApp: false,
  isCustomStoreApp: false,
  future: {
    unstable_managedPricingSupport: true,
  },
});

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes,
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app-uninstalled",
    },
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app-subscriptions-update",
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      shopify.registerWebhooks({ session });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

type GraphQLOptions = {
  apiVersion?: ApiVersion;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  tries?: number;
  variables?: Record<string, unknown>;
};

export async function beginOAuth(request: Request, shop: string) {
  return legacyShopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: request,
  });
}

export async function completeOAuth(request: Request) {
  return legacyShopify.auth.callback({
    rawRequest: request,
  });
}

async function authenticateTraditionalAdmin(request: Request) {
  const sessionId = await legacyShopify.session.getCurrentId({
    isOnline: false,
    rawRequest: request,
  });
  const session = sessionId
    ? await shopify.sessionStorage.loadSession(sessionId)
    : undefined;

  if (!session || !session.isActive(scopes)) {
    const loginUrl = new URL("/auth/login", appOrigin || request.url);
    const shop = shopFromRequest(request) || session?.shop;
    if (shop) loginUrl.searchParams.set("shop", shop);
    throw redirect(loginUrl.toString());
  }

  return {
    admin: createAdminContext(session),
    session,
  };
}

function createAdminContext(session: Session) {
  return {
    graphql: async (operation: string, options?: GraphQLOptions) => {
      const client = new legacyShopify.clients.Graphql({
        session,
        apiVersion: options?.apiVersion,
      });
      const response = await client.request(operation, {
        variables: options?.variables,
        retries: options?.tries ? options.tries - 1 : 0,
        headers: options?.headers,
        signal: options?.signal,
      });

      return new Response(JSON.stringify(response));
    },
  };
}

function shopFromRequest(request: Request) {
  const url = new URL(request.url);
  const candidate =
    url.searchParams.get("shop") ||
    url.searchParams.get("shopDomain") ||
    url.searchParams.get("store") ||
    process.env.DEFAULT_SHOP_DOMAIN ||
    process.env.SHOPIFY_DEV_STORE_DOMAIN;

  if (!candidate) return null;
  const cleaned = candidate
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned)) return cleaned;
  if (/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) return `${cleaned}.myshopify.com`;

  return null;
}

export default shopify;
export const apiVersion = ApiVersion.October25;
export function addDocumentResponseHeaders(_request: Request, headers: Headers) {
  headers.set("Content-Security-Policy", "frame-ancestors 'none';");
}
export const authenticate = {
  ...shopify.authenticate,
  admin: authenticateTraditionalAdmin,
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
