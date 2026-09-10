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

## Local testing

- Install the Stripe CLI (`brew install stripe/stripe-cli/stripe`), then
  `stripe listen --forward-to localhost:3000/api/stripe/webhook` and put the
  printed `whsec_…` into `.env.local` (restart `next dev` after env changes).
- Test card `4242 4242 4242 4242`; failed-payment card `4000 0000 0000 0341`.
- Create a promo code on `/admin/coupons` (e.g. `SAVE20`, 20% off, once) and
  try it on `/pricing`.
- `stripe trigger invoice.payment_failed` shows the past-due banner;
  `stripe trigger invoice.payment_succeeded` clears it.
