# FreeShip Rules

FreeShip Rules is an embedded Shopify app for no-stacking, rule-based free shipping. The admin app runs on Railway with PostgreSQL; checkout logic runs inside a Shopify Discount Function at `cart.delivery-options.discounts.generate.run`.

The default rule template matches the primary use case:

- Subtotal at least `$400`
- Total cart weight under `30 lb`
- Quantity up to `6` items
- Discount codes blocked when detectable by the Function target
- Shopify discount combining disabled for order, product, and shipping discounts
- Free shipping applied to the cheapest eligible non-expedited delivery option

## Architecture

- Admin/backend: React Router Shopify app template, Node.js, TypeScript, App Bridge, Polaris web components
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
SCOPES=read_discounts,write_discounts
DATABASE_URL=
SHOPIFY_APP_NAME=FreeShip Rules
SHOPIFY_BILLING_TEST=true
MONTHLY_PRICE=10
TRIAL_DAYS=7
ACCESS_TOKEN_ENCRYPTION_KEY=
```

Required scopes:

- `read_discounts`
- `write_discounts`

The app config subscribes to:

- `app/uninstalled`
- `app/scopes_update`
- `app_subscriptions/update`
- GDPR compliance topics

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

After install, open `/app/install-check`. The route queries `shopifyFunctions`, creates or updates the automatic app discount, writes the Function configuration metafield, and records the Shopify discount ID in `RuleSet.configJson`.

## Billing

Billing is created through `appSubscriptionCreate`:

- Plan name: `FreeShip Rules Monthly`
- Price: `MONTHLY_PRICE`, default `10`
- Trial: `TRIAL_DAYS`, default `7`
- Test mode: `SHOPIFY_BILLING_TEST=true`

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
- Allowed redirection URL: `https://your-railway-domain/auth/callback`
- Webhook endpoint base URL is covered by the app config paths

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

It adds an app embed that fetches `/cart.js` and displays:

- Amount remaining
- Qualified message
- Discount-code warning when a storefront URL exposes a code signal
- Weight and quantity limit messages

The theme embed settings should mirror the admin settings. The checkout Function remains the source of truth.
Use `[amount]` as the placeholder in the "away" message setting, for example `You are [amount] away from free shipping`.

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
