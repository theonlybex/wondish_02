# Phase 7 — Location / Geo ("near me") + Clara Restaurant Skill

*Scale beyond a single walkable district, and let Clara answer "where should I eat tonight?"*

## Goal

Add real geography so recommendations become **"restaurants near me, ranked by fit and distance,"** and give **Clara** a conversational restaurant skill. This is deliberately late: the Miracle Mile pilot is a handful of restaurants in one district, so Phases 1-6 run on the coarse `neighborhood` zone. Geo becomes necessary when the catalog spans multiple areas.

## What gets built

### 1. Geo foundation (net-new — nothing exists today)
Exploration confirmed **zero** geo capability: no lat/lng in use, no geocoding, no distance queries, no maps dependency, no PostGIS.
- **Populate `Restaurant.latitude/longitude`** (the columns added-but-nullable in Phase 1) via a **geocoding step** at onboarding (address → lat/lng through a geocoding provider — provider choice is an open question; adds the first maps/geo dependency).
- **Distance queries:** either enable a Postgres geo extension (PostGIS or `cube`+`earthdistance` — not currently enabled) or do **bounding-box + haversine in app code** over the pilot-scale catalog. *(Recommend app-side haversine for v1 given modest catalog size; revisit PostGIS at scale.)*
- **User location:** capture device location on iOS (CoreLocation, with a foreground permission prompt + `NSLocationWhenInUseUsageDescription`) and an optional web geolocation / manual "set my area." Store nothing sensitive server-side beyond what a query needs.

### 2. Distance in ranking + "near me"
- Activate the **`distancePenalty`** term in `lib/restaurant-ranking.ts` (the zero-weight seam from Phase 4) — nearer restaurants rank higher, blended with diet-fit/rating/sponsor. `GET /api/restaurants/recommendations` and the directory accept a `lat/lng/radius`.
- **iOS:** "Restaurants near you" on the Restaurants tab (distance on each card; optional map view). **Web:** distance/area filter on `/restaurants`.

### 3. Clara restaurant skill
- Extend Clara so a diner can ask **"where should I eat tonight?"** / "what can I order at <restaurant>?" and get an answer grounded in **their diet + the restaurant catalog**.
- Reuses the **`buildFoodMapText(patient)`** dietary context already extracted to `lib/patient-context.ts` (Clara iOS Phase 3) plus the Phase-1 evaluator and Phase-4 ranking — Clara calls the same structured matcher, so its recommendations never contradict the visual pass/fail. Streams via the existing `dish-checker` streaming pattern (`claude-sonnet-5`, rate-limited).

## Data model & API summary
- **Changed:** `Restaurant.latitude/longitude` populated (geocoding); `lib/restaurant-ranking.ts` activates `distancePenalty`; recommendations/directory accept location params.
- **New:** geocoding integration; iOS CoreLocation capture; a Clara restaurant tool/skill (reusing `buildFoodMapText` + evaluator + ranking).
- **Possible infra:** Postgres geo extension (or app-side haversine).

## Screens / surfaces
- **iOS:** "near you" + distance on cards + optional map; Clara chat can recommend restaurants/dishes.
- **Web:** distance/area filter on `/restaurants`; Clara restaurant answers.

## Reuse of existing systems
- **Clara:** the `dish-checker` streaming route + `buildFoodMapText` dietary context + the Phase-1 evaluator (so Clara and the UI agree).
- **Ranking:** the Phase-4 `distancePenalty` seam.
- **Filters:** the same shared matcher — Clara's suggestions are diet-safe by construction.

## Dependencies
- **Phases 1-4** (catalog, ranking seams, recommendations). **Clara iOS Phase 5** (the chat surface) for the in-app Clara skill. Pull this phase **earlier** only if the pilot expands beyond one walkable district before v1 (flagged in coherence.md + roadmap.md).

## Open questions
- **Geocoding/maps provider** (cost, ToS for storing coordinates, whether a map view is needed for v1).
- **Location privacy:** how much user location is stored vs used transiently (recommend: query-time only, nothing persisted beyond a coarse area the user opts into).
- **Clara scope:** does the restaurant skill also *book*/deep-link, or only recommend? (recommend: recommend + deep-link to the restaurant page for v1.)

## What "done" looks like
- Recommendations and the directory can rank/filter by distance from the user; iOS shows "near you" with distances; a nut-allergic user near several restaurants still sees the safe ones ranked above closer-but-unsafe ones (diet-fit dominates distance).
- Clara answers "where should I eat tonight?" with restaurants/dishes that match the user's filters, grounded in the same evaluator the UI uses (no contradictions).
- **USER:** "what can I eat near me right now?" answered visually and conversationally. **RESTAURANT:** discoverability by nearby, matched, high-intent diners.
