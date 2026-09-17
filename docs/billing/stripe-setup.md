# Stripe setup (per environment)

Billing v2 (2026-09-10): two prices ($20 / month, $100 / 6 months), promo codes
entered in-app, instant activation on return, in-app plan switch / cancel /
resume. Stripe is the source of truth for money; the app names prices by
`lookup_key` (`lib/billing/plans.ts`) and verifies amounts before checkout.

1. **Prices** — run `set -a; source .env.local; set +a; npx tsx scripts/stripe-sync-prices.ts`
   with that environment's secret key. Both prices must print `OK` (or `CREATED`
   on first run). A `MISMATCH` means checkout will refuse that plan until the
   dashboard price and the catalog agree.
2. **Webhook endpoint** → `https://<host>/api/stripe/webhook`, **API version
   2024-04-10** (Developers → Webhooks → endpoint → "API version"; must match
   `lib/stripe.ts`). Events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`,
   `invoice.payment_failed`. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
   (Handlers re-retrieve every subscription through the SDK, so a newer endpoint
   version won't corrupt data — but pin it anyway.)
3. **Customer Portal** (Settings → Billing → Customer portal): enable "Update
   payment method" and "Invoice history"; **disable** "Cancel subscription" and
   "Switch plans" — the app owns those (PATCH `/api/billing/subscription`) so the
   DB row never lags a portal action we don't see. Set business name + support
   email.
4. **Emails** (Settings → Emails): enable "Successful payments" receipts,
   "Upcoming renewals" (≥ 7 days — this is the 6-month plan's reminder), and
   "Failed payments".
5. **Subscriptions → Billing settings**: Smart Retries on; after the final retry
   "Cancel subscription" (fires `customer.subscription.deleted` → row drops to
   FREE). The app shows a past-due banner in the meantime.
6. **Payment methods**: card + Link + Apple Pay + Google Pay (Apple Pay needs
   domain verification under Settings → Payment methods).
7. Optional: **Stripe Tax** → "Automatic tax" if selling into taxed
   jurisdictions; then add `automatic_tax: { enabled: true }` to
   `createPlanCheckoutSession` in `lib/stripe.ts`.
8. **Env**: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`,
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (webhook idempotency),
   and `PREMIUM_GATES=on` when ready to charge (anything else = free mode).

## Going live — what has to happen before anyone can pay real money

State on 2026-09-16 (checked against `acct_1UG2h0KfYpTpjBNo` with its test key): both prices
exist with their lookup keys attached, and the app runs against the new keys. **No webhook
endpoints, no promotion codes, no Customer Portal config and no branding yet.** The account is
a **sandbox**, so live mode cannot charge anyone regardless of `charges_enabled` — see
"Sandbox vs live" below. Coupons for the beta do not depend on any of this.

In order:

1. **Activate the Stripe account** (dashboard → "Activate payments" / Settings → Business):
   legal entity or sole-proprietor details, address, tax ID, the representative's identity,
   bank account for payouts, statement descriptor (what appears on card statements, e.g.
   `WONDISH`), support email and phone. Stripe reviews; `charges_enabled` flips to true when done.
2. **Public business details** (Settings → Public details): business name, support email,
   website. These print on receipts and the Customer Portal.
3. **Branding** (Settings → Branding): logo, icon, brand colour — used by Checkout, the portal
   and emails.
4. **Live prices**: switch the dashboard to live mode, then run step 1 above with the **live**
   secret key (`sk_live_…`) so `premium_monthly_20` and `premium_6mo_100` exist in live mode.
5. **Live webhook**: create the live-mode endpoint at `https://<production host>/api/stripe/webhook`,
   pinned to API version **2024-04-10**, with the event list from step 2 above. Copy its signing
   secret. (The existing test endpoint at `wondish02.vercel.app` is on a newer version — fix that
   too while there.)
6. **Live promo codes**: promo codes are per mode. Recreate `SAVE20` (or whatever you want) at
   `/admin/coupons` once production runs on live keys.
7. **Customer Portal, emails, retries, payment methods, tax**: steps 3–7 above, in live mode
   (settings are per mode as well). Apple Pay needs the production domain verified.
8. **Vercel production env**: `STRIPE_SECRET_KEY` (live), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   (live), `STRIPE_WEBHOOK_SECRET` (the live endpoint's), `NEXT_PUBLIC_APP_URL`,
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Redeploy.
9. **Legal pages**: Terms and Privacy linked from the pricing page and Checkout (Stripe asks for
   a refund/cancellation policy URL for card-network compliance). The app has a terms record
   (`TermsAndConditions`); make sure the public URL is set in Settings → Public details.
10. **Smoke test with a real card** on the smallest plan, then cancel/refund it from the dashboard.
    Confirm the webhook delivered (Developers → Webhooks → endpoint → recent deliveries all 2xx)
    and the account's billing page shows the subscription.
11. Only then `PREMIUM_GATES=on` in production (already decided "on" for the beta environment).

## Moving to a new Stripe account

Done once on 2026-09-16 (old account → `acct_1UG2h0KfYpTpjBNo`, "Painless Food
Corporation sandbox"). Nothing in the code holds a Stripe object id — prices
resolve by `lookup_key` at runtime — so this is a config + data job, not a code
change. What does NOT carry over between accounts: products and prices, webhook
endpoints and their signing secrets, promotion codes, Customer Portal config,
branding, public details, email settings, retry rules, Apple Pay domain
verification. All of it is per account AND per mode.

In order:

1. **Keys** — `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in
   `.env.local` and in each Vercel environment. Keep them in ONE file: as of
   2026-09-16 `.env` carries no Stripe keys, so `.env.local` is the only local
   source and a stale duplicate can't silently win. `NEXT_PUBLIC_*` is inlined
   at build time — redeploy, don't just restart.
2. **Catalog** — `set -a; source .env.local; set +a; npx tsx scripts/stripe-sync-prices.ts`.
   Both prices must print `OK` or `CREATED`.
3. **Webhook secret** — for local dev the CLI issues one:
   `stripe listen --print-secret --api-key "$STRIPE_SECRET_KEY"`. Use
   `--api-key`, not `stripe login`: a browser login binds the CLI to whichever
   account the session picks, and you will not notice you are forwarding from
   the old one. Deployed hosts each need their own dashboard endpoint (step 2 of
   the setup list above) with its own secret.
4. **Detach the DB** — `Subscription.stripeCustomerId` /
   `stripeSubscriptionId` / `stripePriceId` point at objects the new key cannot
   see. Stale customer ids are the ones that bite: `app/api/billing/checkout`
   reuses the stored id and Stripe rejects it as `resource_missing`, so those
   users cannot pay. Account deletion also breaks, because
   `cancelStripeAtPeriodEnd` is deliberately not best-effort and 502s the route.

   ```sql
   -- scope to STRIPE: COUPON rows use stripeCurrentPeriodEnd as the access-end
   -- date with no Stripe object behind them, and ADMIN/APPLE rows are unrelated.
   UPDATE "Subscription"
   SET "stripeCustomerId" = NULL, "stripeSubscriptionId" = NULL,
       "stripePriceId" = NULL, "stripeCurrentPeriodEnd" = NULL,
       "cancelAtPeriodEnd" = false, plan = 'FREE', status = 'ACTIVE'
   WHERE source = 'STRIPE';
   ```

   Check `SELECT COUNT("stripeSubscriptionId") FROM "Subscription"` first. If it
   is 0 there are no live subscriptions and the old account can simply be
   abandoned — that was the case on 2026-09-16 (16 rows reset, 0 subscriptions).
   If it is not 0, real cards are involved: ask Stripe support for a PAN data
   migration rather than doing anything yourself.
5. **Dashboard settings** — steps 3–7 of the setup list, in the new account.
6. **Old account** — do not delete it (tax, refunds). Disable its webhook
   endpoints so they stop retrying against your hosts, and deactivate its prices.

### Sandbox vs live

`acct_1UG2h0KfYpTpjBNo` is a Stripe **Sandbox**. Its key is `sk_test_…` and it
can never charge real money no matter what `charges_enabled` reports. The
`sk_live_…` comes from the parent account, and every step above has to be
repeated there before anyone can pay.

### Product naming

Two products, deliberately, because they are sold under different names — but
they are the SAME entitlement at two billing durations, not two tiers:

| Product | Price | lookup_key |
|---|---|---|
| Wondish Plus | $20 / 1 month | `premium_monthly_20` |
| Wondish Chef | $100 / 6 months | `premium_6mo_100` |

The `premium_*` lookup keys are internal identifiers; customers never see them.
The app resolves prices by lookup key alone and ignores products entirely, so
the product names are free to change.

## Local testing

- Install the Stripe CLI (`brew install stripe/stripe-cli/stripe`), then
  `stripe listen --forward-to localhost:3000/api/stripe/webhook` and put the
  printed `whsec_…` into `.env.local` (restart `next dev` after env changes).
- Test card `4242 4242 4242 4242`; failed-payment card `4000 0000 0000 0341`.
- Create a promo code on `/admin/coupons` (e.g. `SAVE20`, 20% off, once) and
  try it on `/pricing`.
- `stripe trigger invoice.payment_failed` shows the past-due banner;
  `stripe trigger invoice.payment_succeeded` clears it.
