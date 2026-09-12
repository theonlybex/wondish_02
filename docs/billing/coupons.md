# Coupons (beta premium access)

Two kinds of code exist. Both are created at `/admin/coupons` by a SUPER user.

| Kind | What it grants | Where it lives | Use for |
|---|---|---|---|
| **Premium coupon** (DB, type `PREMIUM`) | Premium on the account's `COUPON`-source `Subscription` row until **Access until** | Postgres `Coupon` | Beta testers, gifts, partners |
| **Admin coupon** (DB, type `ADMIN`) | The SUPER role, permanently | Postgres `Coupon` | Team members only |
| Stripe promo code | A discount on paid checkout | Stripe | Marketing discounts |

## Fields on a premium coupon

- **Code** — 4–24 chars, `A-Z 0-9 _ -`. Testers type it in the avatar menu → "Redeem coupon".
- **Max uses** — how many distinct accounts can redeem. `-1` = unlimited. One account can redeem a given code once.
- **Redeem by** (optional) — after this day the code is refused with the generic "Invalid or unavailable code".
- **Access until** (required) — Premium switches off at the end of this day (UTC, plus a 24 h grace built into `hasActivePremium`). Applies to everyone who used the code.

## Behaviour to know

- Deactivating a code stops **new** redemptions only. Access already granted runs to its Access-until date.
- A tester who redeems a second code keeps the **later** end date; access is never shortened. The same code cannot be redeemed twice by one account, even after its access ended: hand out a new code.
- A code whose Access-until date has passed is refused like an invalid code, even if still active.
- A renewing Stripe/Apple subscriber is refused ("You already have Premium — no code needed") and the code's use count is untouched. A subscriber who already cancelled at period end may redeem.
- A tester who holds a coupon can still subscribe: the billing page shows "Subscribe to keep Premium after <date>", and the pricing page stays reachable. After they pay, the **paid** subscription is what the billing page and the app show; the coupon grant sits behind it until its end date.
- **Extending the beta:** use "Extend access" on the code. It moves the code's date and lifts every redeemer's grant that ends earlier (including grants that already ended). It never shortens anyone.
- **Cutting one tester off early** is not in the UI: set that account's `COUPON` subscription row `stripeCurrentPeriodEnd` to now in the database.
- Deleting an account does not free up the code's slot (`usedCount` stays).
- In the last 7 days of a grant the dashboard shows a "Your Premium access ends on <date>" banner (only when gates are on). There is no email. After the date the user sees the Premium gate on the next page load; nothing is deleted.
- Ten wrong codes in an hour lock the redeem box for the rest of the hour.
- iOS: the subscription card says "Managed on the web" for a coupon grant and, for now, "Renews <date>" instead of "Access until <date>" (cosmetic, tracked as an iOS follow-up).

## Turning gates on for the beta

Premium features are gated only when `PREMIUM_GATES=on` is set in the environment (Vercel → Project → Environment Variables). Without it every account already has every feature and coupons change nothing visible. Set it in the environment the beta runs in, redeploy, and confirm a fresh account sees the Premium gate before handing out codes.

## Redemption endpoint

`POST /api/coupon/redeem { code }` → `{ success, type, accessUntil }`. Rate limit 10/hour per user. iOS has no redeem UI; testers redeem on the web and the app picks it up via `/api/me`.

## Admin endpoints

- `GET /api/admin/coupons` — every code with `usedCount`, both dates and the last 100 redeemers (email + date).
- `POST /api/admin/coupons { code, type, maxUses, expiresAt?, accessUntil?, note? }` — validation in `lib/coupon-admin.ts`.
- `PATCH /api/admin/coupons { id, isActive }` — toggle new redemptions.
- `PATCH /api/admin/coupons { id, accessUntil }` — "Extend access"; returns `extendedGrants`, the number of accounts lifted.
