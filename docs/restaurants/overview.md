# Restaurants — Exploration & Phase Overview

*Planning document. Grounded in the existing Wondish codebase (web + Clara iOS). No application code — deliverables are the plans in this folder for review/approval before any build.*

> **AMENDED 2026-07-22 (see the iOS roadmap's amendment blocks in `docs/superpowers/plans/2026-07-20-ios-roadmap.md`):** the **6-tab / custom-bar mechanism in this folder is retired** (D-IA §7.5 here, `phase-2.md` "custom 6-item bottom bar", `roadmap.md` custom-bar clause). The shipped Clara shell keeps the **stock 5-tab bar** `[Restaurants* · Fridge · Clara · Stats · Account]` with Restaurants first + default (Clara `c9a73d2`); Scan+Fridge later merge into one **Cook** tab. Also superseded: "5-tab shell with placeholder screens" below — Clara `a466a68` ships all five tabs as **design mocks with demo data**, including `RestaurantsView`/`RestaurantDetailView`. Restaurants is **free during the Miracle Mile pilot**; the `PaywallContext.restaurants` seam + freemium constant land in Clara Phase 2. The task-by-task iOS wiring plan is `docs/superpowers/plans/2026-07-22-ios-restaurants-tab.md` (gated on this folder's Phase-1 backend).

---

## 0. Repo layout (reality check)

The CONTEXT described `/web` and `/ios` directories. The actual layout is:

- **Web app + shared backend:** the repo root `/Users/becks/Desktop/NewView/wondish_02` (Next.js 14 App Router, Prisma/Postgres, Clerk auth, Stripe, Anthropic). There is no `/web` subdir — `app/`, `components/`, `lib/`, `prisma/` live at root. **This is where restaurant data and APIs go** ("website mostly stores data").
- **iOS app (Clara):** a *separate git repo* at `/Users/becks/Desktop/NewView/Clara` (SwiftUI, XcodeGen, iOS 17, iPhone-only). Currently a 5-tab shell with placeholder screens; its real feature phases (2–6) are planned but not yet built.

Everything below is grounded in those two repos.

---

## 1. The filter / "way of eating" system  *(the core the whole feature hangs on)*

**There is no single "diet type" field.** A user's way-of-eating is *composed* from six independent many-to-many dimensions on `Patient` (`prisma/schema.prisma:105-312`):

| Dimension | Contributes to the "banned" set via |
|---|---|
| Food **allergies** | the allergy's own name **+** its `FoodAllergyBannedIngredient` children |
| Foods **to avoid** | the food's own name |
| **Health conditions** | `HealthConditionBannedIngredient` children only |
| **Food preferences** (e.g. Vegan) | `FoodPreferenceBannedIngredient` children only |
| **Motivations** / goals | `MotivationBannedIngredient` children only |
| **Dish preferences** (Tinder like/dislike) | affinity signal, not a restriction |

Each `*BannedIngredient` row is free text `{ parentId, name }`. Matching is done by **ingredient name string, lowercased — never by an ingredient id**; the banned vocabulary is *not* foreign-keyed to `Ingredient`. **Implication for restaurants: a restaurant dish only needs to expose a list of ingredient name strings to be matched** — it does not need `Ingredient` rows.

### The matching logic — and its most important problem
The canonical matcher lives inside `buildMealPlanMenus` (`lib/meal-plan.ts:162-311`) and is **two-tier**:
- **Tier A — non-allergy bans:** exact, case-insensitive name equality (`meal-plan.ts:172-174`).
- **Tier B — allergy bans:** **word-boundary regex** with singular/plural stemming (`meal-plan.ts:175-179`) — so `"peanut"` bans `"peanut butter"` but `"egg"` does **not** ban `"eggplant"`. This is the safety-critical matcher.

**The problem:** this logic is **copy-pasted across five call sites** (`lib/meal-plan.ts`, `app/api/dish-checker/route.ts`, `app/api/meal-plan/alternatives/route.ts`, `app/api/meal-plan/[menuId]/swap/route.ts`, `app/api/taste/dishes/route.ts`) and **only `meal-plan.ts` has Tier B**. The other four apply exact matching to allergies too — so `"peanut"` allergy blocks a literal `"peanut"` ingredient everywhere, but only the meal-plan generator blocks `"peanut butter"`. This is a latent allergy-safety divergence.

**No code returns *why* a dish failed.** Every path only *filters* (silently drops failing dishes). The restaurant UI needs "grayed out **because it contains peanut (allergy)**" — a pass/fail-**with-reason** evaluator that does not exist today.

**Reusable as-is:** `macroDeviation()` (`lib/macros.ts:189`), `resolveMacroProfile()` + `getMacroPercentages()` (`lib/caloric-engine.ts`). **Highest-leverage foundation work:** extract one shared primitive — `derivePatientBans(patient)` + `buildDietMatchers({allergyNames, exactBannedNames})` + a **new** `evaluateDishAgainstProfile(ingredientNames, patient) → { passed, violations: [{ ingredient, source }] }` — refactor all five call sites onto it (closing the divergence), and reuse it for every restaurant surface. *(Note: Clara/iOS Phase 3 already plans `lib/patient-context.ts` with `buildFoodMapText(patient)` + `PATIENT_FOOD_MAP_INCLUDE` — the **text** food-map for the LLM. The restaurant matcher is the **structured/deterministic** sibling and shares the same Prisma include shape.)*

---

## 2. Data models

**Reusable dish/ingredient/cuisine substrate:**
- `Recipe` (`schema.prisma:316-346`) — name, description, image, emoji, whole-dish macros, tags, `family/subFamily`, and FKs to `DishType`, `MealType`, `Ethnic`. **Lacks: price, an owner/vendor FK, availability, a "recommended dish" flag.**
- `RecipeIngredient` (`:359-368`) — the ingredient-list join (`quantity`, `unit`). `Ingredient` (`:348-357`) — global name-unique catalog.
- **`Ethnic` (`:384-388`) — this IS the cuisine dimension** (`Recipe.ethnicId`, nullable, one-per-recipe). Taxonomy already seeded: American (dominant), Italian, Mediterranean, French, Mexican, Indian, Greek, Caribbean, etc. **Backbone of cuisine-rotation and per-cuisine leaderboards.**
- RBAC quartet `Role/Permission/AccountRole/RolePermission` (`:41-70`) — available for restaurant-staff logins.

**Do NOT reuse:** `Menu` (`:399-412`) is the **patient meal-plan** model (a name collision) — a restaurant menu is a different concept.

**No vendor/restaurant entity exists.** `Company` (`:533-537`) is a thin employer grouping (id + name). The `provider/*` routes are **admin-only ops views** (`requireAdmin()`), not a self-service vendor tenancy. A `Restaurant` is genuinely net-new.

**Net-new models the feature needs:** `Restaurant` (identity, address, lat/lng, neighborhood, `ethnicId`, hours), restaurant dishes (a dedicated `RestaurantDish` **or** a `Recipe` extension — see open decision), `RestaurantRating`, `PaidPlacement`, QR/referral tracking, and per-patient cuisine-rotation state.

---

## 3. Backend / API conventions & the discount reality

- **Route shape** (`app/api/*/route.ts`): Clerk `auth()` → JSON `401`; `rateLimit(name, identifier, limit, windowSec)` (`lib/rate-limit.ts`); ownership scoping via `prisma.account.findUnique({ where: { clerkId } })` → patient. `middleware.ts` returns **JSON 401 for unauthenticated `/api/*`** (so the iOS Bearer client works) and redirects page routes to `/login`.
- **Admin/authz:** `requireAdmin()` (`lib/admin.ts`) checks `account.roles.some(r => r.role.name === "SUPER")`; `adminErrorResponse()` maps to 401/403/500. Admin CRUD routes (`admin/companies`, `admin/recipes`, `admin/coupons`, `admin/zip-codes`, …) are the pattern staff-onboarding will follow. **`provider/*` is also admin-gated** — so a restaurant-owner self-service portal is **net-new authorization** (row-level ownership + a new `RESTAURANT` role), though it can reuse the `requireAdmin`/`adminErrorResponse` code shape.
- **Discounts:** the `Coupon`/`CouponRedemption`/`CouponType` system (`:548-575`) **grants access** (free `PREMIUM` or `ADMIN` role) — it is **not a percentage/point-of-sale discount** mechanism. The QR sign-up discount (~2-3%) and per-dish restaurant discount (~3%) are **net-new**. `CouponRedemption`'s per-account tracking is a reusable pattern for **QR/referral attribution**.
- **Billing:** Stripe (`app/api/stripe/*`, `lib/stripe.ts`) handles *consumer subscriptions*. There is **no marketplace payout / restaurant reconciliation** — net-new.
- **Onboarding:** `getOrCreateAccount()` (`lib/auth.ts`) creates an `Account` + FREE subscription on first authenticated hit; sign-up is Clerk. **No referral tracking exists** — a QR code carrying a restaurant referral + discount is net-new plumbing on top of sign-up.

---

## 4. Dashboard & design systems (where surfaces slot in)

**Web dashboard** (`app/(dashboard)/overview/page.tsx`): a fixed-height, non-scrolling **CSS `gridTemplateAreas` bento**; each card is a `rounded-2xl bg-white` shell with a canonical `boxShadow` and a header bar (accent pill + uppercase action link). Cards live-sync via **window CustomEvents carrying the server echo** (`meal-log:updated`). **A "Going Out Tonight" card is a new named grid area + one shell div** — no new layout system.

**Web design system** (`components/ui/*`): `Badge` (6 variants — the verdict-chip primitive on web), `Button`, `Modal`, `Input`, `Select`, `Toast`, `DatePicker`. **No `Card` primitive** (shell is an inline convention). `DishCard` is the menu-item tile base but **does not render ingredients** and shows only calories+protein. **Web has no pass/fail verdict UI today** (only the dish-checker chat) — the verdict primitive exists only on iOS. Sidebar nav is **i18n-keyed (en/es/ru)** — a "Restaurants" entry needs a key in all three locales.

**iOS (Clara) design system:** `WColor/WFont/WSpacing/WRadius`, `WButtonStyle`, `WBadge`, `WCard`, `WTextField`, **`VerdictBadge` (enum `Verdict{fits,caution,doesntFit}` — the pass/fail primitive)**, `BrandWordmark`. The shell is a **5-tab `TabView`** (`scan`/`fridge`/`chat`/`stats`/`account`, Scan default). **5 tabs is the HIG comfortable max** — a 6th collapses into a "More" overflow that buries it. → *see open decision D-IA.*

**iOS infrastructure a Restaurants feature inherits** (from planned Phases 2/3/6): `WondishAPIClient` (Bearer + 401 re-mint + typed `APIError`), `SessionStore`/`MeDTO`, `EntitlementStore` + `UsageMeter` + `PaywallView` (to gate/monetize), `VerdictBadge` + `Verdict(apiValue:)`, `buildFoodMapText` (dietary scoring input, already extracted), `AddToLogService` + the full meal-log DTO/sync stack (log a restaurant dish → today's ring), and `ImageEncoder` + `CameraPicker` (scan a physical menu). **Restaurants iOS work should sequence *after* Clara Phase 2 (the auth/networking gate).**

---

## 5. Clara, cuisine, ratings, location

- **Clara** = `app/api/dish-checker/route.ts`: `claude-sonnet-5`, streaming, `rateLimit(20/60s)`, history sanitization. Its dietary "food map" is built **inline** (extraction planned in iOS Phase 3 → `lib/patient-context.ts`). A "which restaurant/dish tonight?" Clara skill reuses this + the restaurant data.
- **Cuisine:** `Ethnic` is a solid backbone; **no cuisine-rotation state** and **no per-cuisine ranking** exist.
- **Ratings:** only `PatientDishPreference.liked` (swipe) and `JournalMeal.rating` (per-logged-meal). **No restaurant/dish rating, no aggregates, no "top-rated" — all net-new.** No paid-placement/boost field anywhere.
- **Location:** **effectively nothing** — no lat/lng, no geocoding, no distance, no maps dependency, no PostGIS. `ZipCode` is a flat allowlist; `Account.countryId` is coarse. **"Restaurants near me" starts from zero.** *(But a Miracle Mile pilot of a handful of restaurants in one district can launch on a fixed "pilot zone" tag, deferring true geo.)*
- **Recommender:** `pickByMotivation()` (`lib/meal-plan.ts:51-101`) is a reusable scoring core (macro-fit + affinity + novelty); adding a `sponsorBoost` or `distancePenalty` term is a natural extension point for restaurant ranking.

---

## 6. The one insight that drives the phasing

The feature's entire user-facing value — "show me what I can eat here" — reduces to running a **restaurant dish's ingredient names through the user's way-of-eating and returning pass/fail-with-reason.** That matcher doesn't exist as a reusable unit yet (it's copy-pasted and inconsistent). So **Phase 1 is backend foundation: extract the shared matcher, add the restaurant data model, and let staff onboard the pilot restaurants** — no consumer UI. Everything visible builds on that.

Almost everything *about a restaurant as a place* — identity, geo, ratings, paid ranking, QR/referral, dish pricing, discounts, self-serve portal — is net-new. The **dish/ingredient/cuisine substrate and the design systems are heavily reusable.**

---

## 7. Proposed phases (dependency- and value-ordered)

Sequenced so the **Miracle Mile pilot** arrives as fast as possible without over-scoping Phase 1. Each phase's detailed plan is its own doc; each is explicit about **USER** and **RESTAURANT** value.

| # | Phase | Delivers for USERS | Delivers for RESTAURANTS | Pilot? |
|---|---|---|---|---|
| **1** | **Match engine + restaurant data model + staff onboarding** (`phase-1.md`) | — (foundation) | Their menu can be entered (staff-assisted) and scored | **Pilot-critical** |
| **2** | **Restaurant page — menu with pass/fail** (web + iOS) (`phase-2.md`) | Open a restaurant, see exactly what fits (highlighted) vs not (grayed + why); log a dish | A live Wondish page for their menu | **Pilot-critical** |
| **3** | **QR sign-up + discount** (`phase-3.md`) | Scan a table QR → account + sign-up discount → land on that restaurant's page | Drives attributed sign-ups; the reason to place the QR + have staff promote | **Pilot-critical** |
| **4** | **"Going Out Tonight" recommendation surface** (`phase-4.md`) | Proactive "where to eat tonight" ranked by diet-match | Exposure to matched diners | Pilot fast-follow |
| **5** | **Cuisine rotation + ratings** (`phase-5.md`) | Steer to a new cuisine each outing; top-rated per cuisine | Organic top-rated placement; visit ratings | v1 |
| **6** | **Restaurant self-serve portal + paid placement + dish discount reconciliation** (`phase-6.md`) | (indirect: more/better restaurants) | Self-manage menu; pay to rank higher; set the recommended-dish discount | v1 → post-launch |
| **7** | **Location/geo (near me) + Clara restaurant skill** (`phase-7.md`) | "Restaurants near me" by distance; ask Clara where to eat | Location-based discovery | Post-pilot / scale |

**Pilot bar (recommended):** Phases **1–3** are the minimum viable two-sided loop (restaurant has a page; diner scans a QR, signs up with a discount, sees what they can eat). Phase **4** is a strong retention fast-follow. Phases 5–7 are v1 → post-launch.

---

## 8. Open questions

### Business-model decisions (please answer — listed, not decided, per your instruction)
1. **QR sign-up discount:** exact percentage (~2-3%?), who funds it (Wondish vs restaurant), and how it's delivered (first-visit bill credit? in-app coupon shown to staff? Wondish-subscription discount?).
2. **Per-dish restaurant discount (~3%):** on the specific Wondish-recommended dish — how is it applied at the table and **how is it reconciled** with the restaurant (self-honored by staff vs Wondish-tracked-and-settled)?
3. **Paid placement:** how is it priced (flat tier? auction/bid? per-impression/opt?) and how does the paid boost combine with organic diet-match + rating in the ranking (a weight? a capped slot? clearly labeled "Sponsored"?).
4. **Discount/payout rail:** is Wondish ever in the money flow (collecting/settling), or are all discounts restaurant-honored and Wondish only tracks attribution? (Determines whether a payments/reconciliation system is in scope at all.)

*(These are surfaced again at the point of use in the relevant phase docs — 1-2 in Phase 3, 3-4 in Phase 6.)*

### Two product decisions that reshaped the plan — RESOLVED
- **D-IA — iOS information architecture → RESOLVED: Restaurants is the FIRST + default tab; 6 tabs overall.** The bar becomes `[Restaurants*] [Scan] [Fridge] [Clara] [Stats] [Account]` (Scan and Fridge stay standalone — no merge). Because a stock iOS `TabView` collapses a 6th tab into a "More" overflow list, Phase 2 replaces the stock tab bar with a **custom 6-item bottom bar** so all six stay visible and Restaurants owns the primary slot. *(Trade-off noted: 6 visible tabs is denser than Apple's 5-tab guidance; the custom bar uses compact icons/short labels. Adjustable on review.)*
- **D-INGREDIENTS — dish→ingredient data source → RESOLVED: require a structured ingredient list per dish.** Every restaurant dish must carry a structured `RestaurantDishIngredient` list, entered at onboarding, before it can publish or be matched. **No AI ingredient inference sits in the matching/verdict path** — the allergy verdict is only ever computed from a human-owned ingredient list. *(AI may later pre-fill a draft list purely as an onboarding-speed convenience, but the published list is always human-confirmed and is the sole source of truth — see Phase 1. This is the safest option and deliberately trades slower onboarding for verdict trustworthiness.)*
