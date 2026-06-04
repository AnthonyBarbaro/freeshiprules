import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, normalizeShop } from "../shopify.server";
import { suspendDeliveryDiscount } from "../services/discount.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import { billingIsActive } from "../services/shop.server";
import styles from "../styles/app-shell.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const directLoginUrl = directShopLoginUrl(request);
  if (directLoginUrl) throw redirect(directLoginUrl);

  const { admin, session } = await authenticate.admin(request);
  const { shop, ruleSet } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });
  if (!billingIsActive(shop.billingStatus)) {
    await suspendDeliveryDiscount(admin, session.shop, ruleSet).catch(
      () => undefined,
    );
  }

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopDomain: session.shop,
    billingStatus: shop.billingStatus,
  };
};

function directShopLoginUrl(request: Request) {
  const url = new URL(request.url);
  const shop = normalizeShop(url.searchParams.get("shop"));
  if (!shop) return null;

  const hasEmbeddedContext =
    url.searchParams.has("host") ||
    url.searchParams.get("embedded") === "1" ||
    request.headers.has("Authorization");

  return hasEmbeddedContext
    ? null
    : `/auth/login?shop=${encodeURIComponent(shop)}`;
}

export default function App() {
  const { apiKey, billingStatus, shopDomain } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navItems = [
    { label: "Dashboard", to: "/app" },
    { label: "Analytics", to: "/app/analytics" },
    { label: "Settings", to: "/app/settings" },
    { label: "Shipping Protection", to: "/app/shipping-protection" },
    { label: "Billing", to: "/app/billing" },
    { label: "Install check", to: "/app/install-check" },
  ];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <div className={styles.brandMark} aria-hidden="true">
              FS
            </div>
            <div>
              <p className={styles.productName}>FreeShip Rules</p>
              <p className={styles.productSubcopy}>
                No-stacking is enforced through Shopify discount combination
                rules for supported discount classes, plus Function-level
                blocking when Shopify exposes triggeringDiscountCode.
              </p>
            </div>
          </div>

          <div className={styles.topbarMeta}>
            <span className={statusClassName(billingStatus)}>
              {billingStatus}
            </span>
            <span className={styles.shopDomain}>{shopDomain}</span>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="App sections">
          {navItems.map((item) => {
            const active =
              item.to === "/app"
                ? location.pathname === "/app"
                : location.pathname.startsWith(item.to);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                key={item.to}
                to={item.to}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

function statusClassName(status: string) {
  const tone =
    status === "ACTIVE"
      ? styles.statusActive
      : status === "PENDING"
        ? styles.statusPending
        : styles.statusInactive;

  return `${styles.statusBadge} ${tone}`;
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (shouldRenderShopifyBoundary(error)) {
    return boundary.error(error);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">
            FS
          </div>
          <div>
            <p className={styles.productName}>FreeShip Rules</p>
            <p className={styles.productSubcopy}>
              The app caught a recoverable loading issue.
            </p>
          </div>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.activePanel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.pageTitle}>Review can continue</h2>
              <p className={styles.pageText}>
                This page could not finish loading, but the app shell is still
                available. Use the links below to continue setup or return to a
                stable page.
              </p>
            </div>
          </div>
          <div className={styles.criticalNotice}>{routeErrorMessage(error)}</div>
          <div className={styles.actionRow}>
            <Link className={styles.primaryButton} to="/app">
              Dashboard
            </Link>
            <Link className={styles.secondaryButton} to="/app/billing">
              Billing
            </Link>
            <Link className={styles.secondaryButton} to="/app/install-check">
              Install check
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function shouldRenderShopifyBoundary(error: unknown) {
  if (!isRouteErrorResponse(error)) return false;
  if (error.status >= 400) return false;

  return typeof error.data === "string" && /<[^>]+>/.test(error.data);
}

function routeErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    const detail =
      typeof error.data === "string" && !/<[^>]+>/.test(error.data)
        ? ` ${error.data}`
        : "";

    return `The app received a ${error.status} response.${detail}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected app loading issue occurred.";
}
