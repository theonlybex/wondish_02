# Phase 3 — QR Sign-up + Discount (the acquisition loop)

*Closes the pilot's user-acquisition side and gives restaurants their reason to place the QR code.*

## Goal

A diner sitting at a pilot restaurant's table scans a **QR code** → lands in a **sign-up flow that knows which restaurant/table they came from** → creates an account → **receives a sign-up discount** → is dropped directly onto that restaurant's Phase-2 menu page, already able to see what they can eat. This is the mechanic that turns "restaurant places our QR" into "attributed new Wondish users," and it's why staff promote the app.

## What gets built

### 1. QR code + referral entry (new)
- **`RestaurantQrCode`** (new model): `id`, `restaurantId → Restaurant`, `token` (unique, the value encoded in the QR), `label` (e.g. "Table 7"), `active`, `createdAt`, plus counters (`scans`, `signups`) for attribution. A restaurant can have one code or per-table codes.
- QR encodes a deep link: `https://wondish.io/r/<token>` (web) with a universal-link/App-Clip-friendly shape so iOS can intercept it into the app when installed (App Clip is a later enhancement; v1 is a universal link → web sign-up → app).
- **`GET /r/[token]`** (new public route, added to `middleware.ts` `isPublicRoute`) — resolves the token to a restaurant, records a scan, sets a short-lived referral cookie/param, and routes to sign-up (or, if already authed, straight to the restaurant page with the discount applied if still eligible).

### 2. Referral attribution through sign-up (net-new plumbing)
- No referral tracking exists today; `getOrCreateAccount()` (`lib/auth.ts`) just creates an `Account` + FREE subscription. Add a **referral carry-through**: the sign-up flow preserves `?ref=<token>` across the Clerk sign-up round-trip and, on first `getOrCreateAccount`, writes a **`RestaurantReferral`** record: `{ accountId, restaurantQrCodeId, restaurantId, signedUpAt, discountId? }`. This is the attribution spine (which restaurant earned which user) and the anchor for the discount and for restaurant-side reporting (Phase 6).
- Reuses the `CouponRedemption` per-account-tracking *shape* (`@@unique` guard against double-attribution) even though the discount mechanism itself is new.

### 3. Sign-up discount (net-new — the existing Coupon system does NOT do % discounts)
The `Coupon` model grants *access* (free PREMIUM/ADMIN role), not a percentage discount. The sign-up discount is a **new mechanism** whose exact form depends on the open questions below. The plan builds the **attribution + entitlement record** now and keeps the *delivery* mechanism behind a small interface so the business decision can be slotted in without reshaping the phase:
- **`SignupDiscount`** (new model): `{ accountId, restaurantId, source: "QR", percent, status (ISSUED|REDEEMED|EXPIRED), issuedAt, redeemedAt?, expiresAt? }`.
- A `DiscountDelivery` interface with a v1 implementation chosen per the open questions (e.g. "in-app coupon code shown to staff at the table" vs "Wondish-subscription credit"). The record exists regardless; only redemption/settlement differs.

### 4. Surfaces
- **iOS:** deep-link handling → if the app is installed, `/r/<token>` opens the Restaurants tab on that restaurant's detail page; a first-run **sign-up sheet** (Clerk, via Clara Phase-2 auth) carries the referral; on success a **"Your welcome discount" confirmation** (design-system sheet) and the discount visible in the Account tab.
- **Web:** `/r/[token]` → sign-up page with a restaurant-branded "you're signing up from **<Restaurant>** — here's your welcome offer" banner; post-signup redirect to `/restaurants/[slug]`.

### 5. Ops reporting — `/admin/referrals` (added 2026-08-13)
*Attribution that nobody can read is not attribution. This is where the pilot's headline signal — "QR scans → sign-up conversion" (roadmap.md, Milestone 1) — actually becomes visible.*

**Audience: Wondish ops only.** `requireAdmin`, same posture as `/admin/users`. Restaurant owners get nothing new in the portal — showing individual diner records to a third-party business is a separate decision with its own privacy question, and the pilot's signals are measured by Wondish, not by the restaurants. *(Revisit in Phase 6 if owner-facing reporting is wanted; minimise identity there.)*

**The screen is two halves, because a scan is anonymous.** Nobody has an account at scan time, so "scanned" cannot be a row in a per-customer table — it only exists as a count:

- **Aggregate strip (top):** scans, sign-ups, and conversion rate, recomputed against the active restaurant filter. Reads `RestaurantQrCode.scans` / `.signups`. This is the number the pilot is judged on.
- **Referral table (below):** one row per referred *account*, which by definition exists only after sign-up.

**Row contents:**
| Column | Source | Notes |
|---|---|---|
| Customer | `Account.firstName`/`lastName`, `email` | Links to `/admin/users` — ops already sees these there, so this exposes nothing new |
| Restaurant | `RestaurantReferral.restaurantId → Restaurant.name` | Links to `/admin/restaurants/[id]`. A column (not a heading) because the list is cross-restaurant |
| QR code | `RestaurantQrCode.label` | *Which* code earned it — "Table 7" vs "Front window" is how a restaurant learns where to put them |
| Status | derived (below) | |
| Signed up | `RestaurantReferral.signedUpAt` | |

**Status is a derived funnel state, not a stored column** — storing it would let it drift from the account it describes:
- `signed_up` — a `RestaurantReferral` exists, `Account.onboardingComplete` is false
- `profile_complete` — `onboardingComplete` is true

Both derive from data this phase already writes plus a field that exists today. The rule goes in a pure, unit-tested function (`lib/restaurant-referrals.ts`), following the same convention as `planDirectAssign` / `portalBackLink` / `resolveOnboardingRedirect`.

**Filters:** by restaurant, plus email search. Nothing else.

**QR-code management** lives separately, as a **"QR codes" tab on `/admin/restaurants/[id]`** next to Menu/Staff — that is where a code is minted, labelled, and deactivated, and it is required by §1 regardless of this reporting screen.

**Deliberately not built yet:** discount issued/redeemed state. It is blocked on the open questions below, so the column is specified here and added when the delivery rail is decided — the table gains a column, not a redesign.

> **Attribution slice as-built (2026-08-14).** Shipped: §1 (QR codes, `GET
> /r/[token]`, admin minting), §2 (referral carry-through + `RestaurantReferral`),
> §5 (`/admin/referrals`). **§3, the discount rail, is NOT built** — it stays
> blocked on the open business questions below, and lands as one more column
> plus a `SignupDiscount` model when they are answered.
>
> Two decisions a reader would otherwise have to reverse-engineer:
> 1. **The referral rides an httpOnly cookie, not a query param.** The register
>    page hard-codes Clerk's `forceRedirectUrl`, so any `redirect_url` we
>    attached would be discarded.
> 2. **Every sign-up now routes through `/r/claim`** (that same
>    `forceRedirectUrl`). With no cookie it forwards to
>    `/profile?onboarding=true`, the previous destination. Every failure path
>    falls through the same way — attribution is worth far less than a working
>    sign-up — and every exit clears the cookie, because this route has exactly
>    one entry point and a retained cookie could only ever be redeemed by the
>    *next* sign-up in that browser.
>
> Corrected during an adversarial review of the first cut (see commit
> `feb7b8b`): `resolveQrToken` now requires the restaurant to be `PUBLISHED`,
> not merely the code to be active — the destination menu 404s otherwise, which
> would have landed a brand-new account on a 404 the moment it signed up. And a
> scan by an **already-signed-in** diner attributes without incrementing
> `signups`: counting it would let staff testing tents and regulars dining out
> dominate the conversion number the pilot is judged on.
>
> **Known gaps, deliberately not fixed here:** `scans` is rate-limited per
> IP+code (added in the review wave, `70ea6af`), which stops deliberate
> inflation — but it is a cap, not a dedup, so link previews, crawlers and
> double-taps from distinct addresses still pad the denominator. And
> `/r/claim` sets no `maxDuration` around its Clerk call.

## Data model & API summary
- **New models:** `RestaurantQrCode`, `RestaurantReferral`, `SignupDiscount`.
- **New endpoints:** `GET /r/[token]` (public), admin endpoints to mint/label QR codes for a restaurant (reuse `requireAdmin`), `GET /api/admin/referrals` (ops list + aggregates, §5), an authed `GET /api/me/discounts` (list the user's issued discounts — extend the Clara `MeDTO` or a small new route).
- **Changed:** sign-up flow (`getOrCreateAccount` call path) writes `RestaurantReferral`; `middleware.ts` `isPublicRoute` gains `/r/(.*)`; dashboard sidebar admin block gains a Referrals entry (i18n key in `en`/`es`/`ru`).
- **New pure logic:** `lib/restaurant-referrals.ts` — referral funnel state, unit-tested.

## Screens / surfaces
- **iOS:** deep-link → restaurant page + sign-up sheet + discount confirmation + discount in Account tab.
- **Web:** `/r/[token]` referral landing + restaurant-branded sign-up + discount banner.
- **Admin (ops):** `/admin/referrals` — scans/sign-ups/conversion strip + cross-restaurant referral table (§5); "QR codes" tab on `/admin/restaurants/[id]` to mint and label codes.

## Reuse of existing systems
- **Auth/onboarding:** Clerk sign-up + `getOrCreateAccount` (extended with referral write).
- **Design system:** sign-up sheet, discount confirmation, banners reuse `components/ui/*` (web) and `WCard`/`WButtonStyle`/`WBadge` (iOS).
- **Coupon tracking pattern:** `CouponRedemption`'s per-account uniqueness shape informs `RestaurantReferral`/`SignupDiscount` (but the discount is a new mechanism).

## Dependencies
- **Phase 1** (Restaurant model) and **Phase 2** (a restaurant page to land on). Clara **Phase 2 auth** for the in-app sign-up sheet.

## Open questions (business-model — please answer; these gate the delivery mechanism, not the attribution)
1. **Sign-up discount %** (~2-3%?) and **what it applies to** — the diner's restaurant bill that night, or a discount on the Wondish subscription? These are very different rails.
2. **Who funds it** (Wondish acquisition cost vs restaurant-funded) and **how it's delivered/redeemed** at the table — a code shown to staff, a Wondish-tracked credit, or purely restaurant-honored?
3. **Attribution window / eligibility** — one discount per new account per restaurant? Expiry?

*(The models above are designed so any answer slots into `DiscountDelivery` without reworking attribution.)*

## What "done" looks like
- Scanning a pilot restaurant's table QR (app installed) opens that restaurant's menu and a sign-up sheet; completing sign-up creates an account attributed to the restaurant (`RestaurantReferral` row) and issues the welcome discount (`SignupDiscount` row), visible in Account.
- Same flow on web for users without the app.
- The restaurant's `RestaurantQrCode.signups` counter increments; a hand-check confirms attribution is correct and single-issue.
- **Ops can see it without a database query:** `/admin/referrals` shows that sign-up as a row — customer, restaurant, which QR code, funnel state — and the strip above it shows scans, sign-ups and conversion for the pilot, filterable to one restaurant.
- **USER:** scan → sign up → instant discount → immediately sees what they can eat there. **RESTAURANT:** a concrete, measurable reason to place the QR and have staff promote Wondish — attributed sign-ups they can see.
