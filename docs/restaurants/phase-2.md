# Phase 2 — Restaurant Page: Menu With Pass/Fail Highlighting (web + iOS)

*The first visible payoff — a diner opens a restaurant and sees exactly what they can eat.*

## Goal

Turn the Phase-1 evaluation API into the core user experience: a **restaurant page** whose menu shows each dish either **highlighted (fits your plan)** or **grayed out with the reason it doesn't** — so someone with dietary restrictions can walk in and order confidently. Plus a simple **directory** to reach those pages. Mobile-first: the iOS experience is primary; the web page is a lighter mirror.

## What gets built

### iOS (Clara) — the primary surface
- **Restaurants becomes the first + default tab.** Replace the stock `TabView` in `RootTabView.swift` with a **custom 6-item bottom bar** — `[Restaurants] [Scan] [Fridge] [Clara] [Stats] [Account]` — with Restaurants selected on launch (`@State selection = .restaurants`). *(Stock iOS collapses a 6th tab into "More"; the custom bar keeps all six visible with compact icons/short labels. Invoke `ui-ux-pro-max` before building it; flag the 6-tab density trade-off for review.)*
- **`RestaurantsListView`** (the tab root) — a directory of published restaurants (`GET /api/restaurants`), each row a `WCard` showing name, cuisine (`WBadge`), neighborhood, and a **"N of M dishes fit you"** match summary. Search + cuisine filter chips.
- **`RestaurantDetailView`** — the menu. Each dish is a row/card rendering the Phase-1 verdict via the existing **`VerdictBadge`** (`fits` / `caution` / `doesntFit`): passing dishes full-color, failing dishes **grayed (opacity/desaturation)** with a **`Doesn't fit`** badge and a tappable "why" (the `violations` list: "Contains peanuts — allergy"). Sections mirror the menu (`section`/`sortOrder`). The Wondish-recommended dish gets a subtle highlight.
- **Log a dish:** each fitting dish offers "Add to today" via the planned **`AddToLogService`** (Clara Phase 3/6 infra), writing a `MealLog` with `source = RESTAURANT` (new enum value — see below) so a restaurant meal flows into the Stats ring like any other.
- Reuses: `WondishAPIClient` + `APIError`, `SessionStore`/`MeDTO`, `VerdictBadge` + `Verdict(apiValue:)`, `WCard`/`WBadge`/`WButtonStyle`, the meal-log DTO/write stack.

### Web — the acquisition landing surface (not just a mirror)
*Coherence note: the web restaurant page is where a **QR scanner who doesn't have the app yet** lands (Phase 3). It is the pilot's first-touch consumer surface, not an optional mirror of iOS — so it is pilot-critical, and iOS is the retention fast-follow.*
- **`app/restaurants/[slug]/page.tsx`** — the public/authenticated restaurant page. Menu grid reusing an **extended `DishCard`**: add an **ingredients row** (data already on the dish DTO but not rendered today, per exploration) and a **verdict state** — passing dishes normal, failing dishes `grayscale`/muted with a `Badge` ("Doesn't fit — contains peanuts"). Web has no verdict primitive today, so this introduces the pass/fail chip on web using the existing `Badge` (6 variants).
- **`app/restaurants/page.tsx`** — the directory (list + cuisine filter), reusing `DishCard`-style tiles and the card shell.
- **Nav:** add a "Restaurants" entry to the dashboard sidebar — requires an i18n key in `messages/en.json`, `es.json`, `ru.json` (sidebar nav is i18n-keyed).
- Signed-out visitors see the menu with a "sign in to see what fits you" prompt (verdicts require a profile).

### Cross-cutting safety (required on every verdict surface — see coherence.md #4)
- A **persistent safety disclaimer** wherever a verdict shows: the Wondish verdict is a decision aid, **not a guarantee** — "always confirm with restaurant staff, especially for severe allergies." Non-dismissible on the menu; the app makes allergy-relevant claims about third-party food and must never imply certainty.
- A dish is marked **`fits` only on positive evidence** of its (required, structured) ingredient list; any absent/unverified ingredient yields **`caution`, never `fits`**. Menu freshness is surfaced via `RestaurantDish.lastVerifiedAt` (stale menus flagged).

### Backend (small additions)
- **`MealLogSource.RESTAURANT`** — new enum value + migration, so a logged restaurant dish is attributable (parallels the existing `PICTURE`/`FRIDGE`/`RECIPE` sources). The meal-log write path accepts a `restaurantDishId` provenance pointer (opaque, like `pictureResultId`).
- Reuse Phase-1 `GET /api/restaurants` + `/[slug]` (already return per-dish verdicts). No new matching code.

## Data model & API summary
- **Changed:** `MealLogSource` gains `RESTAURANT`; `MealLog` gains an optional `restaurantDishId` provenance field (migration). `DishCard` (web) extended to render ingredients + verdict.
- **New:** iOS `RestaurantService` + Restaurant DTOs (`RestaurantDTO`, `RestaurantDishDTO` with `verdict: { passed, violations }`); iOS `RestaurantsListView` / `RestaurantDetailView`; web `app/restaurants/*`.
- **Reused endpoints:** Phase-1 `GET /api/restaurants`, `GET /api/restaurants/[slug]`, the existing `POST /api/meal-log`.

## Screens / surfaces
- **iOS:** new **Restaurants tab** (first/default) → list → detail (menu with pass/fail) → log. Custom 6-tab bar.
- **Web:** `/restaurants` directory + `/restaurants/[slug]` page; sidebar nav entry.

## Reuse of existing systems
- **Filters:** consumes Phase-1 verdicts directly (no new matching).
- **Design system:** iOS `VerdictBadge`/`WCard`/`WBadge`; web `DishCard` (extended) + `Badge` + card shell.
- **Dashboard:** the Stats ring receives restaurant meals via the existing meal-log write (`AddToLogService`).
- **Clara iOS infra:** `WondishAPIClient`, `SessionStore`, meal-log stack.

## Dependencies
- **Phase 1** (data model + evaluation API + shared matcher).
- **Clara iOS Phase 2** (auth/networking gate) must exist for the iOS surface — `WondishAPIClient`/`SessionStore` are prerequisites. *If Clara Phase 2 isn't ready, the web restaurant page can ship first and the iOS tab follows.* (Called out in coherence.md and roadmap.md.)

## What "done" looks like
- On iOS, Restaurants is the first tab and the app opens to it; a diner opens a pilot restaurant and sees the menu with fitting dishes highlighted and non-fitting dishes grayed with a clear reason; they can add a fitting dish to today's log.
- The web restaurant page shows the same for a signed-in user; the directory lists pilot restaurants with a per-user match summary.
- A peanut-allergic test user sees the same dish grayed on both platforms with "Contains peanuts — allergy."
- **USER:** can walk into a pilot restaurant, open its Wondish page, and order exactly what fits — the core promise. **RESTAURANT:** has a live, diet-aware Wondish page for its menu.
