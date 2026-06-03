# FreeShip Rules

FreeShip Rules is an embedded Shopify app for rule-based free shipping. No-stacking is enforced through Shopify discount combination rules for supported discount classes, plus Function-level blocking when Shopify exposes `triggeringDiscountCode`. The admin app runs on Railway with PostgreSQL; checkout logic runs inside a Shopify Discount Function at `cart.delivery-options.discounts.generate.run`.

The default rule template matches the primary use case:

- Subtotal at least `$400`
- Total cart weight under `30 lb`
- Quantity up to `6` items
- Discount codes blocked when detectable by the Function target
- Shopify discount combining disabled for order, product, and shipping discounts
- Free shipping applied to the cheapest eligible non-expedited delivery option

## Architecture

- Admin/backend: React Router Shopify app template, Node.js, TypeScript, embedded Shopify OAuth, App Bridge, Polaris web components
- Database: Prisma + PostgreSQL
- Billing: Shopify recurring app subscription, `$10/month`, `7` day trial
- Checkout logic: Shopify Function extension, no checkout network calls
- Function config: app discount metafield at `$app:freeship-rules / configuration`
- Optional storefront UI: theme app embed progress bar

The Function reads only Shopify-provided input and discount metafield JSON. Railway is never called from checkout.

## Important Shopify Limits

Shopify Functions input queries are static. In the current delivery discount run target, the Function can read cart subtotal, lines, line weights, delivery groups/options, the discount metafield, discount classes, and `triggeringDiscountCode`.

Two merchant-facing settings are stored now but have platform caveats:

- Arbitrary entered discount codes: this target exposes `triggeringDiscountCode`, not a full list of every unrelated discount code on the cart. Stacking is primarily prevented with Shopify `combinesWith` flags on the app discount.
- Dynamic product/customer tag and collection rules: Shopify exposes `hasAnyTag`/collection checks through static GraphQL arguments, so per-merchant dynamic tag lists cannot be enforced directly from metafield JSON. This version stores those settings for future product-metafield sync or static generated query strategies, but the checkout Function enforces the global quantity/weight/subtotal rules.

For public apps, Shopify Functions can be used by stores on any plan when the app is distributed through the Shopify App Store. Custom apps that contain Functions require Shopify Plus.

## Local Development

Use Node `22.12+`; Shopify CLI 4 requires it.

1. Install dependencies:

```bash
nvm use
NODE_OPTIONS=--dns-result-order=ipv4first npm install
```

2. Create a PostgreSQL database and set environment variables:

```bash
cp .env.example .env
```

3. Link the app to your Shopify Partner app:

```bash
npm run config:link
```

4. Generate Prisma client and run migrations:

```bash
npm run setup
```

5. Start Shopify development:

```bash
npm run dev
```

Useful checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Shopify App Setup

Required environment variables:

```bash
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=
SCOPES=read_discounts,write_discounts,read_products,write_products,read_publications,write_publications,write_app_proxy,read_orders
DATABASE_URL=
SHOPIFY_APP_NAME=FreeShip Rules
SHOPIFY_BILLING_TEST=true
SHOPIFY_BILLING_BYPASS=false
MONTHLY_PRICE=10
TRIAL_DAYS=7
ACCESS_TOKEN_ENCRYPTION_KEY=
DEFAULT_SHOP_DOMAIN=
```

Required scopes:

- `read_discounts`
- `write_discounts`
- `read_products`
- `write_products`
- `read_publications`
- `write_publications`
- `write_app_proxy`
- `read_orders`

The app config subscribes to:

- GDPR compliance topics

The embedded admin uses Shopify-managed installation with session-token based token exchange. Shopify handles installation and scope updates from `shopify.app.toml`; the React Router Shopify package exchanges App Bridge session tokens for offline Admin API sessions. Uninstall, scopes update, and billing webhooks are registered after install as shop-specific webhooks.

## Create And Deploy The Function

The Function extension lives at:

```text
extensions/freeship-rules-discount
```

It targets:

```text
cart.delivery-options.discounts.generate.run
```

Deploy app config and extensions:

```bash
npm run deploy
```

After install, open `/app/install-check`. The route creates or updates the automatic app discount with the deployed Function handle, writes the Function configuration metafield, and records the Shopify discount ID in `RuleSet.configJson`.

Checkout rule test mode is enabled by default. While test mode is enabled, the Function only applies free shipping when either the offer name or internal rule name is exactly `freeship` (case-insensitive). Use any other name to keep checkout blocked while you configure the rule.

## Billing

Billing is created through `appSubscriptionCreate`:

- Plan name: `FreeShip Rules Monthly`
- Price: `MONTHLY_PRICE`, default `10`
- Trial: `TRIAL_DAYS`, default `7`
- Test mode: `SHOPIFY_BILLING_TEST=true`, which sends `test: true` to Shopify billing so you can approve the billing flow without a real charge.
- Local bypass: `SHOPIFY_BILLING_BYPASS=true`, which unlocks settings without creating a Shopify subscription. Use this only for internal testing and set it back to `false` before selling the app.

If billing is inactive, the settings save route returns `402` and the UI points the merchant to `/app/billing`.

## Railway Deployment

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Add a Railway PostgreSQL service.
4. Set all variables from `.env.example`. Use Railway's `DATABASE_URL`.
5. Deploy with the included `Dockerfile` and `railway.json`.
6. After Railway gives you a production domain, set:

```bash
SHOPIFY_APP_URL=https://your-railway-domain
```

7. In the Shopify Partner Dashboard, update:

- App URL: `https://your-railway-domain`
- Embedded app: `On`
- Use legacy install flow: `Off`
- Allowed redirection URL: `https://your-railway-domain/auth/callback`
- Scopes: `read_discounts,write_discounts,read_products,write_products,read_publications,write_publications,write_app_proxy,read_orders`

8. Run:

```bash
npm run deploy
```

Install or reinstall the app on a test store, approve billing, then open `/app/install-check`.

## Checkout Testing

Use a development store with products that have weights.

Expected examples:

- `$450`, `20 lb`, quantity `4`, no code: free shipping on the eligible ground/cheapest option.
- `$450`, `20 lb`, quantity `4`, code that triggers the Function: no Function discount.
- `$450`, `35 lb`, quantity `4`: no Function discount.
- `$450`, `20 lb`, quantity `8`: no Function discount.
- `$300`, `20 lb`, quantity `4`: no Function discount.

Expedited titles containing `Next Day`, `Overnight`, `Express`, or `Air` are excluded unless `allowExpedited` is enabled.

## Theme Progress Bar

The optional theme app extension lives at:

```text
extensions/freeship-progress-bar
```

It adds a customizable app embed and an inline app block that fetch `/cart.js` and display:

- Amount remaining
- Qualified message
- Discount-code warning when a storefront URL exposes a code signal
- Weight and quantity limit messages

After deploying extensions, merchants can add it in Shopify Admin in either place:

```text
Online Store > Themes > Customize > App embeds > Free shipping progress
Online Store > Themes > Customize > cart template > Add section or block > Apps > Free shipping bar
```

Use the app embed for a global bar. Use the app block when you want to place the bar directly on the cart page, cart drawer, header, or another theme section that accepts app blocks.

If the progress bar does not appear in the theme editor, deploy the extension to the same Shopify app that the store installed:

```bash
npm run deploy
```

The `client_id` in `shopify.app.toml` must match the app's `SHOPIFY_API_KEY` in Railway. Railway only deploys the web app; Shopify extensions are released through Shopify CLI.

The theme editor only controls placement and widget size. The free-shipping goal, active limits, and storefront messages come from the app settings saved in FreeShip Rules. Use `[amount]` in the "before qualifying" message, `[weight]` in the weight message, and `[quantity]` in the quantity message.

The app embed defaults to a compact box on the cart page. Merchants can also add the `Free shipping bar` app block wherever their theme allows app blocks. Storefront settings are fetched through the Shopify App Proxy at `/apps/freeship-rules/progress-config`, so the app config includes:

```toml
[app_proxy]
prefix = "apps"
subpath = "freeship-rules"
```

The theme embed settings should mirror the admin rule settings. The checkout Function remains the source of truth.

## Uninstall And Reinstall

The uninstall webhook deletes Shopify sessions and marks the shop as uninstalled locally. Reinstalling upserts the shop, clears `uninstalledAt`, syncs billing state, and recreates default rules if needed.

## Public App Notes

- Multi-tenant data is keyed by `shopDomain`.
- The app does not expose access tokens to client code.
- A separate encrypted copy of the offline token can be stored on `Shop`; Shopify sessions are stored through the official Prisma session storage adapter.
- Merchant-provided title matching strings are trimmed, length-limited, and control characters are removed.
- Regex matching is disabled by default and guarded in the Function.
- Before App Store submission, confirm whether your billing model is Shopify managed pricing or API-created subscriptions. Shopify's newer App Pricing event model may replace subscription webhooks for some apps.

## References

- Shopify React Router app template: https://shopify.dev/docs/apps/build/build?framework=reactRouter
- Discount Function target: https://shopify.dev/docs/api/functions/latest/discount
- `discountAutomaticAppCreate`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountAutomaticAppCreate
- `appSubscriptionCreate`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate
- Theme app extensions: https://shopify.dev/docs/apps/online-store/theme-app-extensions/extensions-framework
