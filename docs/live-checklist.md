# Live checklist — what has to happen on Vercel / Stripe

Companion to `BACKLOG.md` §0. Everything here is **production-side config**, not
code: the branch `feat/freemium-allowances` is self-contained and needs **no
database migration**, so landing it is code-only.

Written 2026-09-17. Tick as you go.

---

## A. Upstash (rate limiting) — blocking for real spend caps

Without this every limit runs on a per-instance memory counter: the effective
cap is `limit × instances` and `GLOBAL_AI_DAILY_MAX` (the org-wide backstop that
bounds the Anthropic bill) degrades the same way. See `docs/rate-limiting.md`.

- [ ] **Delete the stale Vercel KV variables.** The old Upstash database was
      *archived due to inactivity*, so `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
      `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL` and `REDIS_URL` all point at
      `glad-tuna-141166.upstash.io`, which no longer resolves (NXDOMAIN).
      Nothing in the codebase reads any of them. They also **block** connecting
      a new resource (`Failed to connect: ... existing environment variable
      with name REDIS_URL`).

      ```sh
      for n in REDIS_URL KV_URL KV_REST_API_URL KV_REST_API_TOKEN KV_REST_API_READ_ONLY_TOKEN; do
        for e in production preview development; do vercel env rm $n $e --yes; done
      done
      ```
- [ ] **Connect the new resource** (`upstash-kv-teal-paddle`, provisioned
      2026-09-17) to `wondish_02` on **Production, Preview AND Development**:
      `vercel integration resource connect upstash-kv-teal-paddle wondish_02`.
      Preview matters — it runs `NODE_ENV=production`, so without the vars
      preview deploys silently fall back to per-instance counters.
- [ ] **Confirm it injected `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.**
      `lib/redis.ts` uses `Redis.fromEnv()`, which reads only those two names.
      If the integration writes `KV_*` instead, add the two as aliases.
- [ ] **Verify on the deployed site**, after this branch ships:
      `curl https://www.wondish.io/api/health` → `rateLimit.shared: true`.
      That field is the only proof the caps are real; a config check cannot see
      "set but broken" credentials.
- [ ] **Point an uptime monitor at `/api/health`** (~5 min). It performs a real
      SET/GET/DEL, so it both keeps the database from being archived again *and*
      pages you the moment Redis stops answering. This single check covers both
      failure modes that bit us.

## B. Deploy

- [ ] Merge `feat/freemium-allowances` → `main` and push. No migration needed.
- [ ] Clerk `pk_live` promotion (BACKLOG §0 B) — unrelated to this work but
      still open, and a dev instance means "login every time" churn.
- [ ] Note: `PREMIUM_GATES` is now **parked** — every call site is commented
      out, so setting it does nothing. Do not rely on it to "turn billing on".

## C. Stripe — ONLY if beta users can actually pay

A coupon-only beta skips this whole section.

- [ ] **The current account is a Stripe *sandbox*** (`acct_1UG2h0KfYpTpjBNo`,
      "Painless Food Corporation sandbox"). It can never charge real money
      whatever `charges_enabled` reports. Live keys come from the parent
      account, and every step below must be done there, in live mode.
- [ ] Activate the parent account: legal entity, address, tax ID,
      representative ID, payout bank account, statement descriptor.
- [ ] `set -a; source .env.local; set +a; npx tsx scripts/stripe-sync-prices.ts`
      with the **live** key — both prices must print `OK` or `CREATED`.
- [ ] Attach the `lookup_key`s to the live prices: `premium_monthly_20` (Wondish
      Plus, $20/mo) and `premium_6mo_100` (Wondish Chef, $100/6mo). The app
      resolves prices by lookup key only and ignores product names.
- [ ] Live **webhook endpoint per host** → `https://<host>/api/stripe/webhook`,
      pinned to API version **2024-04-10**, with the event list in
      `docs/billing/stripe-setup.md`. Copy each signing secret.
- [ ] **Customer Portal**: "Update payment method" + "Invoice history" ON;
      "Cancel subscription" + "Switch plans" **OFF** — the app owns those via
      `PATCH /api/billing/subscription`, and a portal action it never sees would
      leave the DB row lying.
- [ ] Promotion codes — per account AND per mode, so nothing carries over.
      Recreate at `/admin/promo-codes`.
- [ ] Branding, public details, receipt/renewal/failure emails, Smart Retries
      (cancel after final retry), payment methods + **Apple Pay domain
      verification** for the production domain.
- [ ] Swap the three Stripe variables in Vercel (live secret, live publishable,
      the live endpoint's signing secret) and **redeploy** —
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is inlined at build time, so an env
      change alone does nothing.
- [ ] Smoke test with a real card on the monthly plan, confirm the webhook
      delivered 2xx and `/membership` shows the subscription, then refund.

## D. Production data left dirty by testing (2026-09-17)

Local dev talks to the **shared production Postgres**, so these are real rows:

- [ ] `qa.desktop.20260911@wondish.io` — PREMIUM on a live **test-mode** Stripe
      subscription (`sub_1UGaGgKfYpTpjBNoezJojsql`). Cancel it and reset the row
      to FREE, or leave it as a fixture.
- [ ] `qa.variant.20260911@wondish.io` — has a generated week and a spent weekly
      allowance. Harmless; the allowance expires on its own.

## E. Decisions still open

- **Re-arm the hard boot failure?** `RATE_LIMIT_ENFORCE_BACKEND=1` makes a
  production process with no Upstash refuse to boot. Off by default because it
  turns one unset variable into an outage and was never verified against a real
  `next build && next start`. Verify first, then arm it.
- **Raise `GLOBAL_AI_DAILY_MAX`** (2000/day ≈ $40/day) as paying users arrive.
  Per-user caps decide who gets served; this decides the total bill.
- **Retire the `beta` tier** once the simulation runs are done — three deletions,
  see `lib/ai-budget.ts`.
- **Free `planInit` 2/day → 1/day?** It is the largest line in the free column
  ($0.16 of $0.36/day). Kept at 2 so one failed onboarding attempt cannot lock a
  brand-new account out for the day.
