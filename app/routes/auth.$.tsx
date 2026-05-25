import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  completeOAuth,
  embeddedAppUrl,
  embeddedSessionCookie,
  registerWebhooks,
  sessionStorage,
} from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, headers } = await completeOAuth(request);

  await sessionStorage.storeSession(session);
  try {
    await registerWebhooks({ session });
  } catch (error) {
    console.error("Failed to register shop webhooks", error);
  }

  headers.append("Set-Cookie", embeddedSessionCookie(session.id));

  throw redirect(embeddedAppUrl(request, session.shop), { headers });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
