# Phase 5 — Cuisine Rotation + Ratings

*Variety and quality — steer diners to a new cuisine each outing, and surface the top-rated restaurants per cuisine.*

## Goal

Two related refinements that make the recommendation feel curated rather than repetitive: a **cuisine-rotation control** that nudges the user toward a different `Ethnic` cuisine each time they go out (with the best restaurants shown per cuisine), and a **rating system** so "top-rated per cuisine" is real. Both feed back into the Phase-4 ranking.

## What gets built

### 1. Cuisine rotation (reuses `Ethnic`; adds per-user state)
- **`PatientCuisineRotation`** (new — or fields on `Patient`, mirroring how `Patient` already holds plan state like `activePlanVersion`): tracks the cuisines a user has recently gone out for (from logged `RESTAURANT` meals + explicit "I went here" signals) and a rotation cursor over `Ethnic`.
- **A "cuisines" control** (the surface the brief describes): a chip/carousel of cuisines on the Restaurants tab that (a) defaults to steering toward a cuisine the user *hasn't* had recently, and (b) lets them override to browse a specific cuisine. Selecting a cuisine filters the directory + recommendations to that `Ethnic`, showing **top-rated restaurants for it**.
- Turns the Phase-4 `cuisine variety` soft term into a first-class, user-visible rotation.

### 2. Ratings (net-new — nothing exists today)
- **`RestaurantRating`** (new): `{ restaurantId, patientId, score (Float), review? , createdAt }`, `@@unique([restaurantId, patientId])` (last-write-wins). Optionally **`RestaurantDishRating`** for per-dish signal. The `Float` score column mirrors the existing `JournalMeal.rating` precedent.
- **Aggregates:** a `Restaurant.avgRating` + `ratingCount` rollup (denormalized, updated on write) so "top-rated per cuisine" is a cheap ordered query (`where ethnicId, orderBy avgRating desc`).
- **Rating capture:** a post-visit prompt — after a user logs a `RESTAURANT` meal (Phase 2) or on a returning visit, ask "how was <Restaurant>?" (design-system rating sheet). Reuses the thumbs/stars idiom the app already has for meals.
- **`ratingBoost`** term in `lib/restaurant-ranking.ts` (the zero-weight seam from Phase 4) becomes active — higher-rated restaurants rank higher, tempered by rating count (Bayesian-ish so a single 5★ doesn't dominate).

### 3. Surfaces
- **iOS:** cuisine chips/carousel on the Restaurants tab; a "Top in <Cuisine>" section; a post-visit rating sheet; ratings shown on restaurant cards/detail (`WBadge` + star row).
- **Web:** cuisine filter on `/restaurants`; ratings on the restaurant page; "Top-rated <Cuisine>" module.

## Data model & API summary
- **New models:** `RestaurantRating` (+ optional `RestaurantDishRating`), `PatientCuisineRotation` (or `Patient` fields). **Changed:** `Restaurant` gains `avgRating`/`ratingCount`; `lib/restaurant-ranking.ts` activates `ratingBoost` + cuisine-rotation weighting.
- **New endpoints:** `POST /api/restaurants/[id]/rating`; `GET /api/restaurants/recommendations` gains a `cuisine` filter + rotation awareness; `GET /api/restaurants?ethnicId=&sort=rating`.

## Screens / surfaces
- **iOS:** cuisine rotation control + top-rated sections + rating sheet on the Restaurants tab.
- **Web:** cuisine filter + ratings + top-rated module on `/restaurants`.

## Reuse of existing systems
- **Cuisine:** the existing `Ethnic` model + `Recipe`/`RestaurantDish` cuisine linkage.
- **Ratings idiom:** `JournalMeal.rating` (`Float`) precedent + the app's existing thumbs/stars UI.
- **Ranking:** extends the Phase-4 `lib/restaurant-ranking.ts` seams.
- **Design system:** rating sheet + chips reuse `components/ui/*` / `WCard`/`WBadge`.

## Dependencies
- **Phase 4** (ranking engine to plug `ratingBoost` + rotation into) and **Phase 2** (restaurant meals to trigger post-visit ratings). Ratings need real usage to be meaningful, so this follows the pilot.

## Open questions
- **Rating source integrity:** only let users rate restaurants they've *logged a meal at* / scanned into (prevents brigading)? *(Recommend: gate rating on a logged `RESTAURANT` meal or QR scan at that restaurant.)*
- **Rotation aggressiveness:** hard-steer (only show the "next" cuisine) vs soft-nudge (rank it up but show all)? *(Recommend soft-nudge + explicit override.)*

## What "done" looks like
- A user can steer to a specific cuisine or accept the rotation nudge toward one they haven't had recently; each cuisine shows its top-rated pilot restaurants; after a restaurant meal they're prompted to rate it, and that rating moves the restaurant's rank.
- Ranking tests confirm `ratingBoost` behaves (rating-count-tempered) and rotation deprioritizes recently-visited cuisines.
- **USER:** variety without decision fatigue + a trustworthy quality signal. **RESTAURANT:** an organic path to prominence (be genuinely good → rank up in your cuisine), and rating visibility that rewards good service to Wondish diners.
