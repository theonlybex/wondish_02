# Phase 1 — Match Engine + Restaurant Data Model + Staff Onboarding

*Backend foundation. No consumer UI. This is the substrate every later phase builds on.*

## Goal

Make it possible to (a) store a restaurant and its menu in Wondish, and (b) ask "which dishes on this menu fit *this* user, and why?" — by extracting the dietary-matching logic that today is copy-pasted and inconsistent into **one shared, reason-returning evaluator**, and adding the restaurant data model plus a staff-facing way to onboard the Miracle Mile pilot restaurants.

## Why this is Phase 1

The feature's entire user payoff reduces to *matching a restaurant dish's ingredients against a user's way-of-eating and returning pass/fail-with-reason.* That evaluator does not exist as a reusable unit — the logic lives in five divergent copies (`lib/meal-plan.ts`, `dish-checker`, `alternatives`, `swap`, `taste/dishes`), and **only the meal-plan generator has the word-boundary allergy safety** (`lib/meal-plan.ts:175-179`). Nothing anywhere returns *why* a dish failed. Building the restaurant page on top of a copy would fork the safety logic a sixth time. So Phase 1 extracts the matcher first, then models restaurants on top of it.

## What gets built

### 1. Shared diet-match engine (`lib/diet-match.ts` — new, pure, no Prisma import)
Extract the scattered logic into one tested module:
- `derivePatientBans(patientWithDiet) → { allergyNames: string[], exactBannedNames: string[] }` — the 5-source union currently duplicated (`lib/meal-plan.ts:162-166` is the canonical copy). Preserves the existing asymmetry (allergies + foods-to-avoid contribute their own name; conditions/preferences/motivations contribute only banned-ingredient children).
- `buildDietMatchers({ allergyNames, exactBannedNames }) → { allergyMatchers: RegExp[], exactBanned: Set<string> }` — lifts the word-boundary allergy regex + stemming from `lib/meal-plan.ts:175-179` (the escape + `(?<!s)s$` singular-stem + `\b…(?:s|es)?\b` matcher) and the exact lowercase set.
- **`evaluateDishAgainstProfile(ingredientNames: string[], matchers) → { passed: boolean, violations: Array<{ ingredient: string, term: string, source: "allergy" | "avoid" | "condition" | "preference" | "motivation" }> }`** — **new.** Runs each ingredient against the matchers and returns *every* violation with its source dimension, so the UI can say "grayed out because it contains **peanut** (allergy)." This reason-returning shape is what no existing code does.
- A documented shared Prisma `include` (`PATIENT_DIET_INCLUDE`) for the allergies/foodToAvoid/healthConditions/foodPreferences/motivations → `bannedIngredients` graph (identical at all five current call sites).

### 2. Refactor the five existing call sites onto the shared engine
`lib/meal-plan.ts`, `app/api/meal-plan/alternatives/route.ts`, `app/api/meal-plan/[menuId]/swap/route.ts`, `app/api/taste/dishes/route.ts` (and the ban-set half of `app/api/dish-checker/route.ts`) all call `derivePatientBans` + `buildDietMatchers`. **This closes the allergy-safety divergence** — the word-boundary matcher becomes the single behavior everywhere. This is a behavior change for alternatives/swap/taste (they gain word-boundary allergy blocking); it must ship behind the existing meal-plan test suite plus new tests, and is called out as a **cross-cutting change** (see coherence.md).

### 3. Restaurant data model (new Prisma models + migration)
```
Restaurant            id, name, slug (unique), description, imageUrl, logoUrl,
                      addressLine, city, state, postalCode, neighborhood (e.g. "Miracle Mile"),
                      latitude Float?, longitude Float?  (nullable now; geo populated in Phase 7),
                      ethnicId?  → Ethnic   (primary cuisine; reuses existing model),
                      status (DRAFT|PUBLISHED|ARCHIVED), hours Json?, phone?, website?,
                      createdAt, updatedAt
RestaurantDish        id, restaurantId → Restaurant, name, description?, price Decimal?,
                      currency, section (e.g. "Mains"), sortOrder,
                      dishTypeId? → DishType, mealTypeId? → MealType,  (reuse existing taxonomy)
                      calories?/protein?/carbs?/fat?/fiber?  (optional macros, whole-dish),
                      isRecommended Boolean @default(false)   (the Wondish-recommended dish; Phase 6 discount hangs off it),
                      available Boolean @default(true), status (DRAFT|PUBLISHED),
                      createdAt, updatedAt
RestaurantDishIngredient   dishId → RestaurantDish, name (String), quantity?, unit?,
                      @@id([dishId, name])     (structured, required — the matcher's input; per D-INGREDIENTS)
RestaurantStaff       (Phase 6 — owner logins; not built here)
```
Decisions baked in from `overview.md`:
- **Dedicated `RestaurantDish`, not a `Recipe` extension.** Keeps restaurant SKUs out of the consumer `Recipe` pool (meal-plan `Menu`, taste/Tinder, `isPublic`), which the data-model exploration flagged as the cleaner separation. `RestaurantDish` reuses the *taxonomy* FKs (`DishType`, `MealType`, `Ethnic` via the restaurant) but not the pool.
- **Structured, required ingredients** (`RestaurantDishIngredient`) — per the resolved D-INGREDIENTS decision. A dish cannot move to `PUBLISHED` with an empty ingredient list (validation gate). The matcher consumes `dish.ingredients.map(i => i.name)`.
- `latitude/longitude` exist now but stay nullable; **the pilot uses the `neighborhood` string ("Miracle Mile") as a coarse zone** — true geo/distance is Phase 7.

### 4. Menu-evaluation API (new)
- **`GET /api/restaurants/[slug]`** — returns the restaurant + its published dishes, **each annotated with the current user's verdict**: `{ passed, violations }` from `evaluateDishAgainstProfile`. Follows repo conventions (`auth()`; unauth → JSON 401 handled by middleware, but this route is readable by any signed-in user; a signed-out/no-profile caller gets dishes with a `null` verdict — "sign in / complete your profile to see what fits you"). Ownership scoping is *not* needed (restaurants are public data); the *patient diet* is the current user's.
- **`GET /api/restaurants`** — list published restaurants (filterable by `neighborhood`, `ethnicId`); used by the Phase-2 directory and Phase-4 recommendations. Returns a lightweight `matchSummary` per restaurant (count of dishes that pass for the current user) computed via the shared engine.
- Verdicts are computed **server-side** (the matcher + patient diet never reach the client); the response carries only the resolved `{ passed, violations }` per dish, mirroring the "server-echo-only" convention the dashboard already uses.

### 5. Staff onboarding (admin CRUD — reuse the existing pattern)
- **`POST/PATCH/DELETE /api/admin/restaurants` + `/[id]` + `/[id]/dishes`** — gated by the existing `requireAdmin()` (`lib/admin.ts`, `role.name === "SUPER"`) + `adminErrorResponse()`. Mirrors `app/api/admin/recipes/route.ts`. Lets Wondish ops create the pilot restaurants, enter each dish **with its required structured ingredient list**, set the recommended dish, and publish.
- A minimal **admin web screen** at `app/(dashboard)/admin/restaurants/` (reuses admin CRUD page conventions — table + modal forms, `components/ui/*`) so ops can onboard menus without touching the DB. *(Invoke the `ui-ux-pro-max` skill before building this screen, per repo rule — even though it's an internal admin surface.)*
- *Onboarding-friction note (per D-INGREDIENTS):* the ingredient list is required and human-owned. AI pre-fill of a draft list from name+description may be added later purely as a data-entry accelerator, but is out of scope here and never bypasses human confirmation.

## Data model & API summary
- **New models:** `Restaurant`, `RestaurantDish`, `RestaurantDishIngredient` (+ enums for status). **Reused:** `Ethnic`, `DishType`, `MealType`, `Patient` + the diet graph, RBAC for admin.
- **New endpoints:** `GET /api/restaurants`, `GET /api/restaurants/[slug]`, admin `restaurants` CRUD.
- **Changed:** `lib/meal-plan.ts` + alternatives/swap/taste/dish-checker refactored onto `lib/diet-match.ts` (behavior-aligning: word-boundary allergy matching everywhere).

## Screens / surfaces
- **Web:** admin onboarding screen only (`app/(dashboard)/admin/restaurants/`). No consumer surface yet.
- **iOS:** none this phase.

## Reuse of existing systems
- **Filters:** the whole point — extracts and reuses the existing banned-ingredient logic; adds only the reason-returning wrapper.
- **Design system:** admin screen uses `components/ui/*` + the card/table conventions.
- **Dashboard / Clara:** untouched (Clara's ban-set derivation is refactored onto the shared engine, no behavior change for it).

## Dependencies
None (foundation). Independent of the Clara iOS phase work.

## Open questions surfaced here
- **Dish macros:** `RestaurantDish` macros are optional. Do we require them (for the diet-match "macro fit" dimension and calorie display), or is ingredient-only matching enough for v1? *(Recommend optional in Phase 1; macro-fit ranking is a Phase-4 concern.)*

## What "done" looks like
- `lib/diet-match.ts` exists with `derivePatientBans` / `buildDietMatchers` / `evaluateDishAgainstProfile`, unit-tested (including the peanut/peanut-butter/eggplant cases and multi-source violations). All five prior call sites use it; the full existing test suite is green and new tests pin the newly-aligned allergy behavior.
- The three new Prisma models + migration are applied; a pilot restaurant with a full menu (each dish carrying a structured ingredient list) can be created and published entirely through the admin screen.
- `GET /api/restaurants/[slug]` returns, for a signed-in user with a dietary profile, each dish tagged `{ passed, violations }` — verified against a hand-checked fixture (e.g. a peanut-allergic user sees the pad thai fail with `violations: [{ ingredient: "peanuts", source: "allergy" }]`).
- **USER:** nothing visible yet. **RESTAURANT:** their menu can be onboarded (staff-assisted) and is now machine-scoreable against any diner's filters.
