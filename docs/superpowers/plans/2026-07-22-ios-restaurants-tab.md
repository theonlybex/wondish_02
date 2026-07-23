# Clara iOS — Restaurants Tab (wire the shipped mock to the live backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — this is a non-negotiable global user rule for all frontend work; it is restated in Step 1 of each such task.**

**Goal:** Turn the shipped Restaurants design mock (Clara `a466a68`: `RestaurantsView` + `RestaurantDetailView` — list with cuisine chips, hero card, fit bars, per-dish verdict cards, persistent allergy disclaimer) into the live, first/default tab: fetch the published-restaurant directory from **`GET /api/restaurants`** (per-user `matchSummary`) and each menu from **`GET /api/restaurants/[slug]`** (per-dish server-computed `{ passed, violations }` verdicts), keeping the shipped layout and replacing the demo models/data with DTOs plus the loading / empty / error / no-profile states the mock lacks. Restaurants is **free during the Miracle Mile pilot** — no meter, no paywall (the `PaywallContext.restaurants` seam exists from Phase 2 but is not presented).

**Architecture:** iOS-only wiring over the Phase-2 foundation: all requests go through the `\.apiClient` `WondishAPIClient` actor (Bearer inject, one-shot 401 re-mint, redirect-never-success, typed `APIError`); verdicts and match summaries are **server-computed only** (the diet matcher and patient profile never reach the client — `lib/diet-match.ts` per `docs/restaurants/phase-1.md`), the client renders `{ passed, violations }` verbatim through the existing `Verdict`/`VerdictBadge`. A pure `ViolationFormatter` turns `violations` into the mock's reason copy ("Contains peanuts · allergy"). An `@Observable @MainActor RestaurantsViewModel` owns the list state machine; the detail view fetches per-slug on push. Logic is tested in `ClaraTests` behind a `RestaurantsProviding` seam + `StubURLProtocol`.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0, XcodeGen, XCTest. Consumes the `docs/restaurants/phase-1.md` backend (Next.js 14, Prisma, Clerk v7) — **this plan defines the wire contract both sides implement** (Task 1); the backend work itself is `docs/restaurants/phase-1.md`, not this doc.

## ⚠️ Preconditions (verify BEFORE starting)

1. **Clara Phase 2 has landed** (with its 2026-07-22 amendment fixes): `WondishAPIClient`, `SessionStore` (with the on-launch `/api/me` fetch), `APIError`, `MeDTO`. This plan consumes them and cannot build without them.
2. **Restaurants backend Phase 1 has landed** in the web repo (`lib/diet-match.ts`, the three Prisma models, `GET /api/restaurants`, `GET /api/restaurants/[slug]`, admin CRUD) with at least one PUBLISHED pilot restaurant seeded. If it has not, ship it first from `docs/restaurants/phase-1.md`, implementing the response shapes pinned in Task 1 below.
3. The shipped shell is Clara `a466a68` or later: `RootTabView` = `[restaurants, fridge, chat, stats, account]`, `selection = .restaurants`.

## Global Constraints

- iOS repo: `/Users/becks/Desktop/NewView/Clara`, branch `restaurants-tab` cut from the **current `main` tip**. Web repo: `/Users/becks/Desktop/NewView/wondish_02`. App/bundle id `io.wondish.clara`, iPhone-only, portrait, iOS 17, light-only.
- Reuse ported design tokens/components ONLY — no new colors, no new components beyond what this plan names. Brand tokens as in the Phase-2 doc; `WBadge(.info)` is a teal alias of `.success` — never for state discrimination; verdict UI is `VerdictBadge` only.
- **Server-echo-only verdicts:** the client never computes, adjusts, or infers a verdict or match count. A `null` verdict/`matchSummary` renders the no-profile treatment, never a guessed verdict.
- **Safety (non-negotiable, from `docs/restaurants/phase-2.md`):** the persistent disclaimer already in both mock screens ("Wondish checks each dish against your way of eating. Always confirm with staff, especially for severe allergies.") stays, non-dismissible, on every surface that shows a verdict.
- iOS HIG: SF Symbols only, ≥44 pt touch targets, safe areas, Dynamic Type. Test/verify via `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build|test`.
- **Bearer acceptance remains the live dependency** (Phase 2): the verify task hits both endpoints with a real iOS-minted Bearer and asserts 200.

## Open decisions (each has a RECOMMENDED default the plan is written against)

| # | Decision | RECOMMENDED default |
|---|---|---|
| R-D1 | "Add to today" logging from a fitting dish | **Deferred** to a follow-up task after Phase 6 lands (it owns the iOS meal-log write stack) together with the small backend addition (`MealLogSource.RESTAURANT` + `restaurantDishId`, `docs/restaurants/phase-2.md`). v1 is a read-only directory + menu. Phase 6's amendment already makes unknown source strings decode-safe. |
| R-D2 | Mock's distance ("0.4 mi") and rating ("4.8") | **Hide both** — geo is restaurants Phase 7, ratings Phase 5. Show `neighborhood` only. Also drop the mock's hardcoded "3 more restaurants near you" footer. |
| R-D3 | `caution` verdicts | v1 wire contract is binary `{ passed, violations }` → `.fits`/`.doesntFit`; the disclaimer carries the uncertainty. An optional server `caution: true` (stale `lastVerifiedAt`, shared-fryer notes) may be added later; the DTO decodes it today as optional and maps to `.caution` when present. |
| R-D4 | Search field | **Cuisine chips only** for the pilot (~a handful of restaurants); free-text search deferred. |
| R-D5 | Signed-in user with no dietary profile | Show the full menu with **no verdict badges/fit bars** and a banner: "Finish your profile on wondish.io to see what fits you" (mirrors Phase 5's D10 posture). Server signals this with `null` verdict/`matchSummary`. |
| R-D6 | `imageUrl` rendering | **Skip in v1** — the shipped mock layout is text-first and reads well; restaurant imagery can be added when real assets exist. |

---

### Task 1: Wire contract + DTOs

**Files:**
- Create: `Clara/Features/Restaurants/RestaurantDTOs.swift`
- Test: `ClaraTests/RestaurantDTOTests.swift`

**Interfaces:**
- Produces: `RestaurantSummaryDTO`, `MatchSummaryDTO`, `RestaurantDetailDTO`, `RestaurantDishDTO`, `DishVerdictDTO`, `DishViolationDTO` — consumed by Tasks 2–6. This block is **the contract of record**; `docs/restaurants/phase-1.md`'s routes must emit exactly these shapes.

The pinned wire contract:

```
GET /api/restaurants?cuisine=<ethnicId>&neighborhood=<zone>&cursor=<opaque>&limit=<n, default 25, max 50>
                                            (auth; 401 JSON when unauthenticated; all params optional)
200 { "restaurants": [ { "id": "cuid", "slug": "olive-and-vine", "name": "Olive & Vine",
      "neighborhood": "Miracle Mile", "cuisine": "Mediterranean" | null,
      "matchSummary": { "passed": 7, "total": 9 } | null } ],         // null ⇒ no profile
      "cuisines": ["Mediterranean", "Italian", …],                    // server facet list (all published)
      "nextCursor": "opaque" | null }                                 // null ⇒ last page

GET /api/restaurants/[slug]                 (auth; unknown slug → 404 {"error":"Restaurant not found"})
200 { "restaurant": { "id", "slug", "name", "description": string|null,
      "neighborhood", "cuisine": string|null },
      "dishes": [ { "id": "cuid", "name", "description": string|null,
        "ingredients": ["Chickpeas","Tahini",…],                      // display strings, already resolved
        "price": "9.00" | null, "currency": "USD",
        "section": "Starters", "sortOrder": 0,
        "isRecommended": false,
        "verdict": { "passed": true, "caution": false,
                     "violations": [ { "ingredient": "peanuts", "term": "peanut",
                                       "source": "allergy" } ] } | null } ] }   // null ⇒ no profile
```

**Scale posture (many users, many restaurants — designed in now, cheap while both sides are unbuilt):** the list is server-paginated and server-filtered from day one; the client decodes `nextCursor` and appends pages even though the pilot fits in one. Cuisine chips render the server `cuisines` facet — **never** derived from loaded rows (breaks under pagination). `matchSummary` is computed per page only (≤50 restaurants' dishes through the shared matcher is cheap regex work; the DB read dominates, so the Phase-1 migration MUST index `Restaurant(status, neighborhood)` and `RestaurantDish(restaurantId, status)`). Menus are public shared data + a per-user verdict overlay: if verdict latency ever matters, the seam is caching the published-menu JSON server-side (keyed by restaurant id + `updatedAt`) and overlaying verdicts per request — no client change. Per-user burst rate-limits on both routes follow the repo's `rateLimit` convention (reads 120/60s), Redis-backed in prod.

- [ ] **Step 1: invoke `ui-ux-pro-max:ui-ux-pro-max` + `mobile-ios-design`** (data shapes feed the design surface).
- [ ] **Step 2: Write failing decode tests** — `RestaurantDTOTests`: decode a full list payload; a `matchSummary: null` row; a detail payload with a `verdict: null` dish, a failing dish with two violations, and an unknown extra field (must not throw); a `caution: true` dish. Assert typed fields, and that `price` stays a **string** (never `Double` — currency).
- [ ] **Step 3: Run tests, verify FAIL** (types don't exist).
- [ ] **Step 4: Implement the DTOs** — plain `Decodable` structs mirroring the contract above; `DishViolationDTO.source` decodes unknown strings to `.other` (forward-compat, same posture as Phase 6's source-badge rule).
- [ ] **Step 5: Run tests → PASS. Commit** `feat(restaurants): wire-contract DTOs`.

### Task 2: RestaurantsService over the API client

**Files:**
- Create: `Clara/Features/Restaurants/RestaurantsService.swift`
- Test: `ClaraTests/RestaurantsServiceTests.swift`

**Interfaces:**
- Consumes: Phase-2 `WondishAPIClient` (`\.apiClient`), `APIError`.
- Produces: `protocol RestaurantsProviding: Sendable { func list(cuisine: String?, cursor: String?) async throws -> RestaurantListDTO; func detail(slug: String) async throws -> RestaurantDetailDTO }` (where `RestaurantListDTO = { restaurants, cuisines, nextCursor }` from Task 1) and `struct RestaurantsService: RestaurantsProviding`. *(The exact `WondishAPIClient` request method signature is pinned against the Phase-2 code at build time — same reconfirm convention as Phases 3–6.)*

- [ ] **Step 1: invoke the two design skills.**
- [ ] **Step 2: Failing tests via `StubURLProtocol`** — 200 list decodes; 200 detail decodes; 404 slug maps to `APIError.notFound`; a stubbed 401-then-200 sequence proves the Phase-2 re-mint path is exercised (request-count assertion); a 307 is never a success.
- [ ] **Step 3: Run → FAIL. Step 4: Implement** (two thin GETs, no caching in v1). **Step 5: Run → PASS. Commit** `feat(restaurants): RestaurantsService`.

### Task 3: Verdict mapping + violation copy (pure)

**Files:**
- Create: `Clara/Features/Restaurants/ViolationFormatter.swift`
- Test: `ClaraTests/ViolationFormatterTests.swift`

**Interfaces:**
- Consumes: `DishVerdictDTO`, the existing `Verdict` enum (`.fits/.caution/.doesntFit`).
- Produces: `func verdict(for dto: DishVerdictDTO?) -> Verdict?` (`nil` in → `nil` out = no-profile), and `func reasonLine(_ violations: [DishViolationDTO]) -> String?` — first violation rendered as the mock's copy pattern `"Contains peanuts · allergy"`; multiple violations append `" +1 more"`; empty violations → `nil`.

- [ ] **Step 1: skills. Step 2: failing tests** — passed→`.fits` with `nil` reason; failed one-violation → `.doesntFit` + `"Contains peanuts · allergy"`; failed two-violations → `"Contains peanuts · allergy +1 more"`; `caution:true` → `.caution`; `nil` → `nil`; source `.other` renders without a source suffix (`"Contains X"`).
- [ ] **Step 3: FAIL. Step 4: implement (pure, no Foundation beyond String). Step 5: PASS. Commit** `feat(restaurants): verdict mapping + reason copy`.

### Task 4: RestaurantsViewModel state machine

**Files:**
- Create: `Clara/Features/Restaurants/RestaurantsViewModel.swift`
- Test: `ClaraTests/RestaurantsViewModelTests.swift`

**Interfaces:**
- Consumes: `RestaurantsProviding` (injected), `SessionStore` phase.
- Produces: `@Observable @MainActor final class RestaurantsViewModel` with `enum State { case loading, loaded([RestaurantSummaryDTO]), empty, failed(APIError) }`, `var selectedCuisine: String?`, `var cuisines: [String]` (the server `cuisines` facet — **replaces the mock's hardcoded array**; never derived from loaded rows), `var filtered: [RestaurantSummaryDTO]`, `var hero: RestaurantSummaryDTO?`, `func load() async`, `func retry() async`, `func loadNextPageIfNeeded(current: RestaurantSummaryDTO) async` (appends the `nextCursor` page when `current` is within 5 rows of the end; no-op when `nextCursor == nil` — single-page in the pilot, ready for many restaurants).
- **Hero rule (fixes the mock's quirk):** `hero` is non-nil only when `selectedCuisine == nil` ("All") and is the row with the highest `matchSummary.passed/total` ratio (ties: first); the list below the hero excludes it. Under a cuisine filter there is no hero and no row is dropped. Rows with `matchSummary == nil` never win the hero.

- [ ] **Step 1: skills. Step 2: failing tests** — load success → `.loaded` + cuisines derived; empty array → `.empty`; thrown `APIError` → `.failed`; hero rule (highest ratio wins; excluded from list; no hero under a filter; nil-summary rows never hero); retry after failure reloads.
- [ ] **Step 3: FAIL. Step 4: implement. Step 5: PASS. Commit** `feat(restaurants): list view-model`.

### Task 5: Wire `RestaurantsView` (keep the shipped layout)

**Files:**
- Modify: `Clara/Features/Restaurants/RestaurantsView.swift`
- Test: screenshots via fixtures (Task 7); logic already covered by Task 4.

**Interfaces:**
- Consumes: `RestaurantsViewModel`, `RestaurantSummaryDTO`.
- Produces: the live tab root. `LaunchFixtures` gains `restaurantsLoaded | restaurantsEmpty | restaurantsError | restaurantsNoProfile` (stub service injected in DEBUG), and the existing `-restaurantDetail` launch arg re-targets the loaded fixture's first restaurant.

- [ ] **Step 1: skills (mandatory before editing SwiftUI).**
- [ ] **Step 2: Replace demo data with the VM** — delete `sampleRestaurants` and the demo `Restaurant`/`MenuDish`/`RestaurantMenuSection` structs (Task 6 re-homes the detail rendering onto DTOs); keep the shipped **hero card, cuisine chips, row cards, fit bar, disclaimer** structure and styling exactly. `fitBar` renders `matchSummary` (hidden when `nil` per R-D5); rows drop distance + rating and show `neighborhood` only (R-D2); chips come from `vm.cuisines` prefixed by "All".
- [ ] **Step 3: Add the missing states** — `.loading`: three redacted row cards (`.redacted(reason: .placeholder)`); `.empty`: token-styled card "No restaurants in your area yet — we're starting with the Miracle Mile." ; `.failed`: error card + "Try again" (`WButtonStyle(variant: .secondary)`) calling `vm.retry()`; no-profile fixture shows the R-D5 banner above the list.
- [ ] **Step 4: Build + run all tests → PASS. Step 5: Commit** `feat(restaurants): live list wiring + states`.

### Task 6: Wire `RestaurantDetailView`

**Files:**
- Modify: `Clara/Features/Restaurants/RestaurantDetailView.swift`
- Test: `ClaraTests/RestaurantDetailGroupingTests.swift` (pure grouping), screenshots via fixtures.

**Interfaces:**
- Consumes: `RestaurantsProviding.detail(slug:)`, `ViolationFormatter`, `VerdictBadge`.
- Produces: `func groupDishes(_ dishes: [RestaurantDishDTO]) -> [(section: String, dishes: [RestaurantDishDTO])]` — pure; groups by `section`, orders sections by first-appearance of ascending `sortOrder`, dishes by `sortOrder` within section.

- [ ] **Step 1: skills. Step 2: failing grouping tests** (two sections interleaved in input; sortOrder respected; unknown/empty section falls back to "Menu").
- [ ] **Step 3: FAIL → implement grouping → PASS.**
- [ ] **Step 4: Wire the view** — fetch on appear by slug (loading redaction, 404 → "This restaurant is no longer listed", error → retry); keep the shipped header/fit-bar/disclaimer/dish-card structure, including the grayed+full-strength-reason treatment and the `isRecommended` → "Wondish pick" border (`dish.isRecommended` replaces the mock's `isPick`); verdict row renders `verdict(for:)`/`reasonLine(_:)` from Task 3, and the whole verdict row is hidden when the verdict is `nil` (R-D5 banner shows instead). Price renders the server string with currency; ingredients row joins `ingredients` with ", ".
- [ ] **Step 5: Build + tests → PASS. Commit** `feat(restaurants): live menu with server verdicts`.

### Task 7: Verify

- [ ] **Step 1:** `xcodegen generate` → full `xcodebuild … build` and `… test` — all green.
- [ ] **Step 2: Live smoke (blocking):** with a real device/simulator sign-in, hit `GET /api/restaurants` and `GET /api/restaurants/<pilot-slug>` through the app with an iOS-minted Bearer; assert 200s, a rendered menu, and — with a peanut-allergic test profile — a failing dish showing "Contains peanuts · allergy" (the same fixture check as `docs/restaurants/phase-1.md` "done").
- [ ] **Step 3: Screenshots:** launch with each of `restaurantsLoaded / restaurantsEmpty / restaurantsError / restaurantsNoProfile` and `-restaurantDetail`; capture via `xcrun simctl io booted screenshot`. Verify the disclaimer is present on both verdict surfaces in every capture.
- [ ] **Step 4: Commit + hand off** per `superpowers:finishing-a-development-branch`.

## Out of scope

- **"Add to today" logging** (R-D1) — follow-up after Phase 6; includes the web `MealLogSource.RESTAURANT` + `restaurantDishId` migration.
- QR/referral deep links (`/r/[token]`, restaurants Phase 3), recommendations (Phase 4), ratings (Phase 5), owner portal/paid placement (Phase 6), geo/distance (Phase 7).
- Web `/restaurants` pages (owned by `docs/restaurants/phase-2.md`).
- Any premium gating — free during the pilot; the Phase-2 `PaywallContext.restaurants` seam stays dormant.

## Verification checklist

Build green · all `ClaraTests` green · live Bearer smoke 200 on both endpoints · peanut-fixture verdict renders with reason · all five fixture screenshots captured with the disclaimer visible · no client-side verdict/match computation anywhere (grep for `passed`/`violations` usages outside DTO/formatter).
