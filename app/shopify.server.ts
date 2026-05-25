import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { shopifyApi, type Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "react-router";
import prisma from "./db.server";

const appUrl = process.env.SHOPIFY_APP_URL || "";
const appOrigin = appUrl ? new URL(appUrl).origin : "";
const sessionCookieName = "freeship_rules_session";
const scopes = process.env.SCOPES?.split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
const sessionStorage = new PrismaSessionStorage(prisma);

const oauthShopify = shopifyApi({
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
  sessionStorage,
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
    APP_SCOPES_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/scopes_update",
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
  return oauthShopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: request,
  });
}

export async function completeOAuth(request: Request) {
  return oauthShopify.auth.callback({
    rawRequest: request,
  });
}

async function authenticateEmbeddedAdmin(request: Request) {
  const sessionId = verifySignedValue(readCookie(request, sessionCookieName));
  const session = sessionId ? await sessionStorage.loadSession(sessionId) : undefined;

  if (!session || !session.isActive(scopes)) {
    const loginUrl = new URL("/auth/login", appOrigin || request.url);
    const shop = inferShopFromRequest(request) || session?.shop;
    const host = new URL(request.url).searchParams.get("host");

    if (shop) loginUrl.searchParams.set("shop", shop);
    if (host) loginUrl.searchParams.set("host", host);

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
      const client = new oauthShopify.clients.Graphql({
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

export function embeddedSessionCookie(sessionId: string) {
  const secure = appOrigin.startsWith("https://");
  const sameSite = secure ? "SameSite=None; Secure" : "SameSite=Lax";

  return [
    `${sessionCookieName}=${signValue(sessionId)}`,
    "Path=/",
    "HttpOnly",
    sameSite,
    "Max-Age=2592000",
  ].join("; ");
}

export function embeddedAppUrl(request: Request, shop: string) {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");
  const decodedHost = host ? decodeShopifyHost(host) : null;
  const adminHost =
    decodedHost && decodedHost.includes("/store/")
      ? decodedHost
      : `admin.shopify.com/store/${shop.replace(".myshopify.com", "")}`;

  return `https://${adminHost}/apps/${process.env.SHOPIFY_API_KEY || ""}`;
}

export function inferShopFromRequest(request: Request) {
  const url = new URL(request.url);
  const candidates = [
    url.searchParams.get("shop"),
    url.searchParams.get("shopDomain"),
    url.searchParams.get("store"),
    shopFromEncodedHost(url.searchParams.get("host")),
    shopFromAdminUrl(request.headers.get("referer")),
    process.env.DEFAULT_SHOP_DOMAIN,
    process.env.SHOPIFY_DEV_STORE_DOMAIN,
  ];

  for (const candidate of candidates) {
    const shop = normalizeShop(candidate);
    if (shop) return shop;
  }

  return "";
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;

  const cookies = header.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function signValue(value: string) {
  const encoded = Buffer.from(value, "utf8").toString("base64url");
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET || "")
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

function verifySignedValue(value: string | null) {
  if (!value) return null;

  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;

  const expected = createHmac("sha256", process.env.SHOPIFY_API_SECRET || "")
    .update(encoded)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return Buffer.from(encoded, "base64url").toString("utf8");
}

function shopFromEncodedHost(host: string | null) {
  const decodedHost = decodeShopifyHost(host);
  return decodedHost ? shopFromAdminUrl(`https://${decodedHost}`) : null;
}

function decodeShopifyHost(host: string | null) {
  if (!host) return null;

  try {
    const normalized = host.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function shopFromAdminUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    const storeHandle = url.pathname.match(/\/store\/([^/?#]+)/)?.[1];
    return storeHandle ? `${storeHandle}.myshopify.com` : null;
  } catch {
    return null;
  }
}

export function normalizeShop(value: string | null | undefined) {
  if (!value) return null;

  const cleaned = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (!cleaned) return null;
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned)) return cleaned;
  if (/^[a-z0-9][a-z0-9-]*$/.test(cleaned)) return `${cleaned}.myshopify.com`;

  return null;
}

export default shopify;
export const apiVersion = ApiVersion.October25;
export function addDocumentResponseHeaders(_request: Request, headers: Headers) {
  headers.set(
    "Content-Security-Policy",
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
  );
}
export const authenticate = {
  ...shopify.authenticate,
  admin: authenticateEmbeddedAdmin,
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };
