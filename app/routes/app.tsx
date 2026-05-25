import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { prepareInstalledShop } from "../services/app-installation.server";
import styles from "../styles/app-shell.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = await prepareInstalledShop({
    admin,
    session,
    syncDiscount: false,
  });

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopDomain: session.shop,
    billingStatus: shop.billingStatus,
  };
};

export default function App() {
  const { apiKey, billingStatus, shopDomain } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navItems = [
    { label: "Dashboard", to: "/app" },
    { label: "Settings", to: "/app/settings" },
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
                Rule-based free shipping that does not stack with offers.
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

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
