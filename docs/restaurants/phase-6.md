# Phase 6 — Restaurant Self-Serve Portal + Paid Placement + Dish Discount

*The restaurant-side monetization and scale layer — restaurants manage their own menus, pay to rank higher, and set the recommended-dish discount.*

## Goal

Move restaurants off staff-assisted onboarding and onto **self-service**: a restaurant owner logs in, manages their own menu (with the required structured ingredient lists), sets their **Wondish-recommended dish + discount**, and can **pay for higher placement**. This is what lets the pilot scale beyond hand-onboarded Miracle Mile restaurants and turns the platform into a revenue engine.

## What gets built

### 1. Restaurant-owner accounts + portal (net-new authorization)
- **`RestaurantStaff`** (new join): `{ accountId → Account, restaurantId → Restaurant, role (OWNER|MANAGER) }`. A new **`RESTAURANT` Role** in the existing RBAC (`Role`/`AccountRole`) so restaurant users are distinct from consumers/admins.
- **`requireRestaurantOwner(restaurantId)`** (new helper, mirrors `requireAdmin()`'s shape in `lib/admin.ts`) — **row-level ownership scoping**: an owner may only read/write *their* restaurant's rows. This is genuinely new authz (the existing `provider/*` routes are admin-only, not row-scoped self-service).
- **`app/(restaurant)/…`** — a self-serve portal (web; owners are desktop-first for menu management): menu CRUD (create/edit/publish dishes **with structured ingredient lists — the Phase-1 publish gate still applies**), set the recommended dish + discount, view attribution/analytics (sign-ups driven, QR scans, dishes-that-fit stats from Phases 1-5), and manage placement/billing.
- **`POST/PATCH /api/restaurant/…`** — owner-scoped endpoints (via `requireRestaurantOwner`) that reuse the Phase-1 dish/ingredient validation.

### 2. Paid placement (net-new ranking + billing)
- **`PaidPlacement`** (new): `{ restaurantId, tier/bid, status, startsAt, endsAt, ... }` — the sponsorship a restaurant buys.
- **`sponsorBoost`** term in `lib/restaurant-ranking.ts` (the zero-weight seam from Phase 4) becomes active — a paid restaurant gets a ranking boost, **clearly labeled "Sponsored"** in the UI, and **capped so it never overrides a hard dietary mismatch** (a sponsored restaurant with nothing the user can eat must not top the list — safety/trust guardrail).
- **Billing** reuses the Stripe patterns (`lib/stripe.ts`, checkout/webhook) but on a **separate B2B rail** (restaurants aren't consumer `Subscription`s) — a restaurant billing customer + product. *(Exact pricing model is an open question.)*

### 3. Recommended-dish discount + reconciliation (net-new)
- The `RestaurantDish.isRecommended` flag (Phase 1) + a **`recommendedDiscountPercent`** the owner sets. How the diner redeems it at the table and **how it's reconciled with the restaurant** is the core open question — the plan builds the **data + attribution** (which diner was shown/redeemed which dish discount at which restaurant) behind the same `DiscountDelivery` interface introduced in Phase 3, so the settlement mechanism is pluggable.

## Data model & API summary
- **New models:** `RestaurantStaff`, `PaidPlacement`; new `RESTAURANT` role; `RestaurantDish.recommendedDiscountPercent`. Extends `SignupDiscount`/`DiscountDelivery` (Phase 3) to dish-level discounts.
- **New endpoints:** owner-scoped `/api/restaurant/*` (menu, recommended dish, analytics), placement purchase/manage, `requireRestaurantOwner` helper.
- **Changed:** `lib/restaurant-ranking.ts` activates `sponsorBoost` (capped, labeled); Stripe B2B billing path.

## Screens / surfaces
- **Web:** the restaurant-owner portal (`app/(restaurant)/*`) — menu manager, recommended-dish + discount, placement/billing, analytics. Reuses `components/ui/*` + admin CRUD conventions. *(Invoke `ui-ux-pro-max` before building.)*
- **Consumer surfaces:** "Sponsored" labels on recommended/placed restaurants (iOS + web); the recommended-dish discount shown on the dish (Phase-2 detail).

## Reuse of existing systems
- **Authz:** `requireAdmin` *code shape* → `requireRestaurantOwner` (new row-scoping).
- **Billing:** Stripe patterns (`lib/stripe.ts`), separate B2B customer.
- **Ranking:** Phase-4 `sponsorBoost` seam.
- **Dish validation:** Phase-1 structured-ingredient publish gate (unchanged — owners can't publish a dish without ingredients).
- **Design system:** portal + labels reuse existing components.

## Dependencies
- **Phases 1-2** (data + menu), **Phase 4** (ranking, for `sponsorBoost`), **Phase 3** (`DiscountDelivery`, for the dish discount). Follows the pilot — you onboard the first restaurants by hand (Phase 1 admin), then open self-service once the loop is proven.

## Open questions (business-model — please answer)
1. **Paid placement pricing/ranking model:** flat monthly tier, auction/bid, or per-impression? How large is the `sponsorBoost` weight, and is placement a *labeled boost* within organic results or a *reserved slot*? (Trust guardrail assumed: never surfaces a restaurant with no fitting dishes above genuine matches.)
2. **Recommended-dish discount (~3%) reconciliation:** is Wondish in the money flow (tracks redemption and settles with the restaurant), or is the discount restaurant-honored with Wondish only tracking attribution? Determines whether a payments/settlement system is in scope.
3. **Who can self-serve:** open sign-up for any restaurant, or invite/verify-gated? Verification of restaurant ownership?

## What "done" looks like
- A restaurant owner logs into the portal, edits and publishes their menu (ingredient lists enforced), sets a recommended dish + discount, buys a placement tier, and sees attribution analytics — all scoped to only their restaurant.
- A sponsored restaurant shows a "Sponsored" label and ranks higher **only when it has fitting dishes** (guardrail test passes).
- The recommended-dish discount is attributed and (per the chosen model) reconciled.
- **USER:** more and better-maintained restaurants, honestly labeled sponsorship, a visible dish discount. **RESTAURANT:** full self-service, a paid growth lever, and the dish-level discount to convert Wondish diners — the complete restaurant-side value proposition.
