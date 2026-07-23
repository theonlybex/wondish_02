# Phase 4 — "Going Out Tonight" Recommendation Surface

*Proactive discovery — turns the restaurant directory into a personalized "where should I eat tonight?"*

## Goal

A dashboard surface that **recommends restaurants whose menus fit the user's filters**, ranked so the best-fitting, best options come first. On iOS it's the hero of the Restaurants tab; on web it's a "Going Out Tonight" dashboard card. This is the retention driver that makes Wondish the thing you open *before* deciding where to eat.

## What gets built

### 1. Recommendation/ranking engine (new lib, reuses the scorer shape)
- **`lib/restaurant-ranking.ts`** — scores each published restaurant for a given patient. The score composes:
  - **Diet-match strength** — share of the menu that passes (`evaluateDishAgainstProfile` across the menu, from Phase 1), weighted toward restaurants with several fitting dishes (not just one).
  - **Macro/goal fit** *(optional)* — reuse `macroDeviation()` + `resolveMacroProfile()` against fitting dishes' macros where present.
  - **Cuisine variety** — a mild boost toward cuisines the user hasn't recently gone out for (full rotation is Phase 5; here it's a soft term).
  - **Placeholders for later terms:** `ratingBoost` (Phase 5) and `sponsorBoost` (Phase 6) and `distancePenalty` (Phase 7) are defined as **zero-weight seams now**, so those phases slot in without touching call sites. This mirrors the existing `pickByMotivation()` scorer (`lib/meal-plan.ts:51-101`), which already blends macro-fit + affinity + novelty.
- **`GET /api/restaurants/recommendations`** — returns the ranked list for the current user (restaurant + match summary + top fitting dishes), computed server-side.

### 2. Surfaces
- **iOS (Restaurants tab hero):** the tab root leads with **"Going Out Tonight"** — a ranked, swipeable set of restaurant cards (each: name, cuisine, "N dishes fit you", a hero fitting dish), then the full directory below. Tapping a card → Phase-2 `RestaurantDetailView`.
- **Web dashboard card:** a new **"Going Out Tonight"** card added as a **named grid area** in `app/(dashboard)/overview/page.tsx` (add the area to the `gridTemplateAreas` strings + one card shell `div` — no new layout system). Card shows the top 2-3 matched restaurants with a "See all →" link to `/restaurants`. Uses the canonical card shell + header bar (accent pill in `#812549`).

## Data model & API summary
- **New:** `lib/restaurant-ranking.ts`; `GET /api/restaurants/recommendations`; iOS "Going Out Tonight" hero; web dashboard card.
- **Changed:** dashboard grid template (`overview/page.tsx`) gains a `goingOut` area.
- **No new Prisma models** — ranking is query-time over Phase-1 data. *(Cuisine-variety state, if persisted, arrives in Phase 5.)*

## Screens / surfaces
- **iOS:** "Going Out Tonight" hero at the top of the Restaurants tab.
- **Web:** "Going Out Tonight" dashboard card + the existing `/restaurants` directory.

## Reuse of existing systems
- **Filters/matching:** Phase-1 evaluator across menus.
- **Recommender:** the `pickByMotivation` scoring *shape* and `macroDeviation`/`resolveMacroProfile` (macro fit).
- **Dashboard:** the grid-area + card-shell + header-bar conventions; the cross-card `CustomEvent` sync pattern if the card needs to react to profile changes.
- **Design system:** iOS `WCard`/`WBadge`; web card shell + `Badge`.

## Dependencies
- **Phases 1-2** (data + evaluation + restaurant page to link into). Independent of Phase 3, but most valuable once there are signed-up users (Phase 3) to recommend to.

## Open questions
- **Ranking transparency:** how much to explain *why* a restaurant is recommended ("8 dishes fit your plan; Mediterranean; new cuisine for you"). *(Recommend: show the fit count + cuisine; keep it simple.)*
- **Cold start / no profile:** what to show a user with no dietary profile yet (recommend: popular pilot restaurants + a "complete your profile to personalize" nudge).

## What "done" looks like
- A signed-in user with a profile sees a ranked "Going Out Tonight" set — on the iOS Restaurants tab and the web dashboard card — where the top restaurants genuinely have the most fitting dishes; tapping opens the restaurant page.
- The ranking function is unit-tested (a user with a nut allergy ranks a nut-heavy restaurant below a safe one; a muscle-gain user sees higher-protein-fit restaurants rise).
- **USER:** an at-a-glance answer to "where can I eat tonight that fits me?" **RESTAURANT:** organic exposure to matched, high-intent diners — and a preview of the paid-placement value (Phase 6) built on the same ranking.
