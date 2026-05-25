import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { completeOAuth, registerWebhooks, sessionStorage } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, headers } = await completeOAuth(request);

  await sessionStorage.storeSession(session);
  await registerWebhooks({ session });

  throw redirect("/app", { headers });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
