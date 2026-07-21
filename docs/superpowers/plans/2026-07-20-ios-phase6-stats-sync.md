# Clara iOS Phase 6 — Stats

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every task that creates or edits SwiftUI MUST invoke the `ui-ux-pro-max:ui-ux-pro-max` skill AND the `mobile-ios-design` skill before writing any Swift — this is a non-negotiable global user rule for all frontend work; it is restated in Step 1 of each such task.**

**Goal:** Replace `StatsPlaceholderView` with a native, offline-capable **Stats** experience — the iOS half of macro-tracking. Build (1) a single-scroll dashboard for the selected day: a calorie ring (`WColor.primary` target arc + actual-intake arc), macro tiles (P/C/F vs target), a Swift Charts macro donut and calorie-trend line — all rendered from **server echoes only, with zero client-side macro math** (two named presentation-only exceptions, below); (2) the daily meal-log UI (day list grouped by meal type, MANUAL add/edit/delete); and (3) the **offline sync engine** described in the macro-tracking plan's iOS section — an outbox persisting creates/edits/deletes with fresh `clientRequestId` + device-local `localDate`, delta reconciliation via `?updatedSince=` (opaque compound cursor), soft-delete tombstones, dual-addressing by id-or-`clientRequestId`, and dispatch-aware coalescing (a queued *un-dispatched* create absorbs a later edit or is cancelled by a later delete; once dispatched, later edits/deletes become distinct wire ops so the server's `update:{}` upsert pin can protect a landed edit). Freemium: Stats free = **today-only** (history/trends premium), gated by `EntitlementStore` and intercepted with `PaywallView(.statsHistory)`. **No new web endpoint, schema, or migration** — every backend Phase 6 consumes is already shipped.

**Architecture:** Phase 6 is pure iOS-client work against two already-shipped endpoints — `GET /api/journey` (`?from=&to=`, powering donut + trend) and `GET/POST/PATCH/DELETE /api/meal-log` (its `?date=` day-read and `?updatedSince=` delta modes) — plus the existing `MealLog` Prisma model, all consumed through the **Phase-2 infrastructure**: `actor WondishAPIClient` (Bearer injection, JSON-401 re-mint-and-retry-once, redirect-never-success, typed `APIError`), `SessionStore`, `EntitlementStore`, and the `TokenProviding` seam. `StatsView` is the Stats-tab root: a `NavigationStack` wrapping one `ScrollView` of stacked cards, driven by a single `@Observable @MainActor StatsViewModel` handed the injected client, `EntitlementStore`, `MealLogRepository`, and a `MealLogSyncEngine`. The VM owns `selectedDate` and two independent async loads — the **day envelope** (`GET /api/meal-log?date=`) powering ring/tiles/meal-list, and the **trend** (`GET /api/journey?from=&to=`) powering donut + trend — each rendered independently so the ring never blocks on the chart. Writes never hit the network directly: Add/Edit/Delete enqueue into an `OutboxStore` (a file-backed, actor-guarded, **versioned** Codable queue behind a protocol) which optimistically mutates a local day cache and drains in the background; the returned server envelope (`dayTotals`/`remaining`) refreshes the ring. All timestamp DTO fields decode as `String` (never `Date`) — the server emits fractional-second ISO the Phase-2 `.iso8601` strategy would reject, and the delta cursor must round-trip verbatim. `localDate` is derived device-side by `LocalDate` (`en_US_POSIX` locale, `.current` timezone), the string-for-string twin of the web `formatLocalDate` **on the write/day-read path** (see the trend-path TZ caveat in Global Constraints). All new logic is covered by `ClaraTests` (XCTest) behind `StubURLProtocol` / `StubTokenProvider` / in-memory outbox / injectable clock seams — no live backend, no `ModelContainer`.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0 target, XcodeGen, XCTest, **Swift Charts** (`import Charts`, iOS-17-native — no external dependency), Foundation `DateFormatter`/`ISO8601DateFormatter`, `FileManager` (Application Support) for the outbox. Reuses the Phase-2 networking/session/entitlement stack and the Phase-1 design system. **No new SPM dependency.** Web side: no changes.

## Global Constraints

- iOS app location: `/Users/becks/Desktop/NewView/Clara` — its own git repository, separate from the web repo. Work on branch `phase6-stats` (from the current Phase-2 tip; **Task 1 Step 0 creates it**). App/bundle id: `io.wondish.clara`.
- Web repo: `/Users/becks/Desktop/NewView/wondish_02` — **no changes in Phase 6** (no endpoint, schema, migration, or `lib/*.ts`). If any backend gap surfaces mid-implementation, **halt and escalate** — Phase 6 is scoped as pure client work.
- Swift + SwiftUI only; no UIKit-only screens. iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), portrait only. iOS 17.0 minimum (Swift Charts `SectorMark`, `@Observable`, `.scrollTargetBehavior` all require it).
- **Reuse the existing Phase-2 infrastructure — do not re-implement it.** Networking goes through the injected `WondishAPIClient` (reached via `@Environment(\.apiClient)`); query params travel through `APIRequest.query`, **never** string-concatenated into `path`. Premium is read **only** through `EntitlementStore.isPremium`. The Phase-2 `StubURLProtocol` (app target, `#if DEBUG`) and `StubTokenProvider` (test target) are reused verbatim for tests and the `-UITestFixture` harness.
- **Reuse ported design tokens/components — no new colors, and exactly ONE justified new token-only primitive (`UndoToast`, D-table + Task 9).** Tokens: `WColor.{primary #812549, primaryLight #B75E78, primaryDark #5F1C35, background #F9F7ED, surfaceSecondary/cream #F5F1DD, border #EAE4CA, textPrimary #1E1A1A, textSecondary #4F4A4A, textTertiary #848181, success #00B9A6, warning #FDC221, error #EA5455, brandGradient}`; `WFont.inter(_:_:)`; `WSpacing.{xs4,sm8,md12,lg16,xl24,xxl32,xxxl48}`; `WRadius.{sm8,md12,lg16,card24,pill}`; `Color(hex:)`. Components: `WButton`/`WButtonStyle`, `WBadge`, `.wCard(padding:)`, `WTextField`, `VerdictBadge`, `BrandWordmark`. Flat surfaces, hairline borders, **no shadows**. Inter fonts only. SF Symbols (no emoji icons). `.monospacedDigit()` on every number.
- **`WBadge(.info)` is a teal alias of `.success`** — NEVER use `.info`/`.success` to distinguish macro states. Macro-state badges use `.primary` (on-target), `.warning` (over), `.error` (way-over), `.neutral` ("Est."/incomplete). Chart series colors come from `WColor` tokens directly: protein = `WColor.primary`, carbs = `WColor.primaryLight`, fat = `WColor.warning` (matching the web `MacroSplitDonut` #812549 / #B75E78 / #FDC221).
- **Server-echo-only macros — zero client math, with two NAMED presentation-only exceptions.** The ring reads `dayTotals.calories` / `dayTarget.calories` / signed `remaining.calories`; tiles read `avg*`/`target`; charts read `MacroStats`. Never sum `logs` on device, never compute `remaining`, never derive over-budget (read it from signed `remaining` echo). The **only** sanctioned on-device arithmetic is presentation geometry that produces no reported number: (a) the ring's visual clamp `fraction = min(actual/target, 1.0)` (D5); (b) the donut's slice-proportion `%` from `protein/carbs/fat` grams (F9). Both are covered by an assertion that no *reported* macro figure is ever computed client-side.
- **All timestamp DTO fields (`loggedAt`, `updatedAt`, `deletedAt`) decode as `String`, not `Date`** — the server emits fractional-second ISO (`"2026-07-20T12:34:56.789Z"`) that the Phase-2 client's `JSONDecoder.dateDecodingStrategy = .iso8601` rejects; and `updatedAt` (the delta-cursor seed) plus the opaque `nextCursor` must round-trip verbatim. No DTO field is typed `Date`, so the global `.iso8601` strategy is inert for these responses — stated explicitly so it is never accidentally exercised. On-demand display formatting of `loggedAt` (e.g. "7:34 PM") uses a local `ISO8601DateFormatter(options: [.withInternetDateTime, .withFractionalSeconds])`.
- **`localDate` is the aggregation key and is REQUIRED on every write** (server 400s if absent — the route never defaults it). Derive it device-side via the single `LocalDate` helper — `en_US_POSIX` locale (stable format), `dateFormat = "yyyy-MM-dd"`, `timeZone`/`calendar` left at `.current` (device-local day boundary). Forcing UTC reintroduces the T3 off-by-one the whole design avoids. The write path and `?date=` day-read are **pure string passthrough** (device string is stored/filtered verbatim) — robust and TZ-independent.
- **Trend-path timezone caveat — NOT a byte-twin (F3).** Unlike the write/day-read path, `GET /api/journey?from=&to=` **reparses** the date strings server-side (`new Date("yyyy-MM-dd")` → `setHours(23,59,59,999)` in server-local TZ → `formatLocalDate` with server-local getters). It only round-trips cleanly when **the server process runs `TZ=UTC`** (Vercel default). Do NOT claim day-path/trend-path parity. **Pre-flight (Task 12 Step 0): confirm the deployed backend is `TZ=UTC`; if it is not, halt and escalate** — this is a real backend constraint the "no web changes" scoping otherwise hides.
- iOS HIG: SF Symbols, ≥44 pt touch targets, respect safe areas, Dynamic Type, honor Reduce Motion (ring/trim animations become static). **No permission prompts** — Stats touches no camera/mic/photos/location.
- iOS test/verify: `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' build|test` (discover the device via `xcrun simctl list devices available | grep iPhone`). **Web test obligation: NIL** — Phase 6 adds no web surface; existing `lib/meal-log.test.ts`, `lib/journey.test.ts` (incl. `computeMacroStats`), `lib/macros.test.ts` already pin every contract consumed. No `node --test` work.
- **Flagged (not guessed) wire dependencies — unit tests prove client shape against `StubURLProtocol`, not the live contract.** These are exercised for real by the Task 12 Step 0 live smoke: dual-addressing by `clientRequestId` in the path segment; the opaque `?updatedSince=` compound-cursor round-trip; the `404 {error:"Meal log not found"}` coalescing signal; and the `TZ=UTC` journey-window assumption above.

---

## Open decisions (need sign-off) — each has a RECOMMENDED default so the plan is actionable now

| # | Decision | RECOMMENDED default (plan is written against this) |
|---|---|---|
| D1 | **Outbox persistence engine** | **File-backed, VERSIONED Codable `OutboxStore` behind a protocol** (`FileOutboxStore`, actor-guarded `{version, ops:[QueuedOp]}` envelope in Application Support, per-op tolerant decode). Testable without a `ModelContainer`, dependency-free, append-mostly. **SwiftData (`@Model`) is the named alternative** if the local day/history cache later grows; Core Data is not warranted (iOS-17-only, no legacy). |
| D2 | **Does Stats increment `UsageMeter`?** | **No.** Stats has no per-count limit in `FreemiumLimits` (Scan 3/Fridge 1/Chat 5 only). Freemium rule is "today-only," enforced purely via `EntitlementStore.isPremium`. Leave `UsageMeter` untouched (pinned by `test_usageMeter_notIncremented`). |
| D3 | **Background sync scope** | **Foreground-first:** `@Environment(\.scenePhase) == .active` + drain on every successful write + `.refreshable` pull-to-refresh. Each drain attempt re-mints the bearer per request (a drain outlives a ~60 s Clerk JWT). **`BGAppRefreshTask` / `BGTaskScheduler` true-background sync is deferred but named.** |
| D4 | **Date-range default** | **Free = today-only** (`from = to = LocalDate.today()`, never requests history so the server never returns premium-only ranges to a free client); **premium default = last 30 days** (matches the `GET /api/journey` server default; `.chartScrollableAxes(.horizontal)` for longer ranges). |
| D5 | **Ring geometry when over budget** | **Clamp the main arc at full + draw a thin over-fill arc in `WColor.error`** (HIG activity-ring idiom). The clamp is visual only (`fraction = min(actual/target, 1.0)`) — never a reported number; the "over" state is read from signed `remaining.calories < 0`, with the word "over" + `exclamationmark.triangle.fill` carrying meaning (never color-only). |
| D6 | **`dayTarget == nil` (incomplete caloric profile)** | **Render a neutral track-only ring + caption "Set your targets on the web to see your ring"** — no crash, no fake target, no client math. Tiles show grams with "—" targets and no progress bar. Routes emit `dayTarget:null` (never 422), so this is a normal path. |
| D7 | **Empty meal-type rows** | **Collapse to one section "+ add" affordance + the canonical toolbar `＋`** (less clutter) rather than four persistent "+ add breakfast/lunch/…" rows. |
| D8 | **Add-meal default meal type** | **Time-of-day heuristic** (before 11 → breakfast, 11–15 → lunch, 15–21 → dinner, else snack), user-overridable via the segmented picker. |
| D9 | **Two distinct "incomplete" notions in the trend (F4)** | **Distinguish them, do not merge.** `MacroDay.incomplete` (any row incomplete; day is still on the line and **counted in the average**) renders as **"partially estimated"** — a `WColor.warning` `PointMark` on the plotted line. The `MacroStats.daysIncomplete` set (**every** row incomplete; **quarantined from averages**) uses distinct **"N days couldn't be counted"** caption language and is NOT drawn as an on-line point. Never let the marker count contradict the caption count. |
| D10 | **Freemium history/trends gate is client-only and server-bypassable** | **Accepted as honor-system** (consistent with Phase-2 D15). `GET /api/journey` and `?from=&to=` have **no** premium gate; enforcement is purely `EntitlementStore.isPremium` client-side. This is a **revenue-affecting** decision surfaced here (not buried in out-of-scope) so product signs off knowingly. |

---

### Task 1: iOS — `LocalDate` formatter + `Clock`/`NowProviding` time seam

**Repo:** `/Users/becks/Desktop/NewView/Clara`. Foundation of every write and range query; no UI. TDD-first, no skill gate (pure logic).

**Files:**
- Create: `Clara/Core/Time/LocalDate.swift`
- Create: `Clara/Core/Time/Clock.swift`
- Create (test): `ClaraTests/LocalDateFormatterTests.swift`, `ClaraTests/ClockTests.swift`

**Interfaces:**
- Produces: `enum LocalDate` — `static func string(from date: Date) -> String`, `static func today(_ now: Date = Date()) -> String`. Single shared `DateFormatter`: `locale = Locale(identifier: "en_US_POSIX")`, `dateFormat = "yyyy-MM-dd"`, **`timeZone`/`calendar` left at `.current`**. The string-for-string twin of the web `formatLocalDate` (`lib/local-date.ts:18-23`) on the write/day-read path. Consumed by every write body and by the day/journey query builders.
- Produces: `protocol NowProviding: Sendable { var now: Date { get } }` + `struct SystemClock: NowProviding` (real time) and a test `FixedClock`. Injected into `StatsViewModel` and `MealLogSyncEngine` so cursor timestamps and `localDate` are deterministic in tests.

- [ ] **Step 0: Create the branch**

  ```bash
  cd /Users/becks/Desktop/NewView/Clara && git checkout -b phase6-stats
  ```
  (from the Phase-2 tip.)

- [ ] **Step 1: Write failing `LocalDateFormatterTests` + `ClockTests`**

  ```swift
  import XCTest
  @testable import Clara

  final class LocalDateFormatterTests: XCTestCase {
      func test_format_yyyyMMdd_posixLocale() { /* matches ^\d{4}-\d{2}-\d{2}$ */ }
      func test_format_usesDeviceTimeZone_not_UTC() {
          // TimeZone.current = GMT-7, instant 2026-07-20T06:30Z → "2026-07-19" (T3 off-by-one guard)
      }
      func test_format_stable_across_locales() {
          // force Locale = ar_SA default: output still Gregorian ASCII digits (POSIX wins the format)
      }
      func test_format_matches_webGolden() {
          // table of (epochSeconds, tzIdentifier) → expectedString golden pairs mirroring formatLocalDate
      }
  }

  final class ClockTests: XCTestCase {
      func test_fixedClock_returnsSeededInstant() { /* FixedClock(now: fixed).now == fixed */ }
      func test_systemClock_advances() { /* two reads are monotonic non-decreasing */ }
  }
  ```
  Run: `xcodebuild … test` → Expected: compile FAILURE.

- [ ] **Step 2: Implement `LocalDate.swift` + `Clock.swift`**

  ```swift
  enum LocalDate {
      private static let formatter: DateFormatter = {
          let f = DateFormatter()
          f.locale = Locale(identifier: "en_US_POSIX")   // POSIX → stable numerals/format
          f.dateFormat = "yyyy-MM-dd"
          // DO NOT set timeZone or calendar → both default to .current (device local).
          // POSIX fixes the FORMAT; device-local timezone fixes the DAY BOUNDARY.
          return f
      }()
      static func string(from date: Date) -> String { formatter.string(from: date) }
      static func today(_ now: Date = Date()) -> String { string(from: now) }
  }
  ```
  For the timezone-sensitive tests, inject the timezone by cloning the formatter with the test `TimeZone` (do not mutate the shared instance). Run → Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
  xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
  git add -A && git commit -m "feat(stats): LocalDate yyyy-MM-dd device-calendar formatter (web formatLocalDate twin) + Clock seam"
  ```

---

### Task 2: iOS — DTO layer + JSON fixtures (byte-for-byte web mirrors)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 1. Pure Decodable/Encodable, no UI, no skill gate.

**Files:**
- Create: `Clara/Features/Stats/DTO/MacroSnapshot.swift`, `NullableMacroSnapshot.swift`, `DailyTargets.swift`, `Remaining.swift`, `MealLogDTO.swift`
- Create: `Clara/Features/Stats/DTO/Envelopes.swift` (`DayLogResponse`, `DeltaResponse`, `MealLogWriteResponse`)
- Create: `Clara/Features/Stats/DTO/MacroStats.swift` (`JourneyPayload`, `MacroStats`, `MacroDay`)
- Create: `Clara/Features/Stats/DTO/MealLogInput.swift` (`CreateMealLogBody`, `PatchMealLogBody`, `PerServingBody`, `MealType`)
- Create (test): `ClaraTests/MealLogDTOTests.swift`, `ClaraTests/Fixtures/*.json`

**Interfaces:** all fields verified against `lib/meal-log.ts:506-526`, `lib/macros.ts:32-39`, `lib/caloric-engine.ts:907-914`, `types/index.ts:143-163`.
- Produces: `MacroSnapshot { calories, protein, carbs, fat, fiber: Double; incomplete: Bool }` (totals view — server 0-coerces nulls, servings-scaled, r1-rounded); `NullableMacroSnapshot` (same fields as `Double?` — **nulls PRESERVED**, unset ≠ explicit 0; the edit modal needs this); `DailyTargets { calories, protein, carbs, fat: Double; profile: String; basis: String }` (String, not enum, for forward-compat; nullable when caloric profile incomplete); `Remaining { calories, protein, carbs, fat: Double }` (signed target−totals; null when no target).
- Produces: `MealLogDTO { id, localDate, mealType, source, name: String; servings: Double; unit, clientRequestId: String?; perServing: NullableMacroSnapshot; totals: MacroSnapshot; recipeId, customIngredientId, journalMealId, pictureResultId, fridgeRecipeId, note, deletedAt: String?; loggedAt, updatedAt: String }` (`Decodable, Identifiable, Equatable, Sendable`). `mealType`/`source` are `String`, not enums (forward-compat).
- Produces envelopes: `DayLogResponse { date, logs, byMealType{breakfast,lunch,dinner,snack}, dayTotals, dayTarget?, remaining? }`; `DeltaResponse { logs, nextCursor: String? }` (logs **INCLUDE tombstones**, `nextCursor` OPAQUE — store & echo verbatim); `MealLogWriteResponse { log: MealLogDTO?, dayTotals, dayTarget?, remaining?, ok: Bool? }` (`log` absent, `ok:true` present on DELETE).
- Produces: `JourneyPayload { macroStats: MacroStats }` — **lenient: maps only `macroStats`**, deliberately omitting the heavy `stats`/`entries` blocks (`JSONDecoder` ignores unmapped keys). `MacroStats { dailyMacros:[MacroDay], avgCalories/Protein/Carbs/Fat, daysLogged/Complete/Incomplete/OnTarget, target: MacroTarget? }`; `MacroDay { date:String, calories, protein, carbs, fat: Double, incomplete: Bool }`. (Powers donut + trend; the two `incomplete` notions are read distinctly per D9 — `MacroDay.incomplete` vs `MacroStats.daysIncomplete`.)
- Produces: `CreateMealLogBody` (`localDate` required, `source="MANUAL"`, `name`, `servings`, `perServing: PerServingBody`, fresh `clientRequestId`); `PatchMealLogBody` (all optional; `servings` rescales server-side — **no client macro resend**) with a dedicated `.undo` factory that hand-encodes a single explicit-null `deletedAt` key; `PerServingBody` with a **hand-written `encode(to:)` that always emits all five macro keys** (emit explicit JSON `null` for nil via `encodeNil(forKey:)`, so "absent ⇒ NULL" holds on both POST and PATCH — Swift's default `Encodable` omits nil optionals, which would read as "no change" on a PATCH that clears a macro). `enum MealType: String { breakfast, lunch, dinner, snack }`.

> **Note (F10/#9):** the meal-log `?from=&to=` range mode, `RangeResponse`, `range_read.json`, and `StatsService.range()` are **intentionally NOT built** — nothing consumes them (the trend reads `GET /api/journey`). Do not add them; one range reader only.

- [ ] **Step 1: Author the JSON fixtures** — under `ClaraTests/Fixtures/`, byte-copied from the verified web contracts: `day_read.json` (full `?date=` envelope with all four `byMealType` keys), `meallog_allFields.json`, `perServing_nullPreserved.json` (macros null + `incomplete:true`), `dayTarget_null.json`, `dayTarget_present.json` (both `"plan-ramp"` and `"steady-state"` bases), `remaining_signed.json` (negative), `journey_macroStats.json` (incl. the heavy `stats`/`entries` blocks to prove they're ignored, and both a `MacroDay.incomplete:true` row AND a `daysIncomplete>0` count for D9), `delta_page.json` (with a tombstone row `deletedAt != null` and `nextCursor:null`), `unknown_extra_keys.json`.

- [ ] **Step 2: Write failing `MealLogDTOTests`**

  `test_decode_dayRead_envelope`, `test_decode_mealLogDTO_allFields`, `test_decode_perServing_nullPreserved` (asserts `perServing.calories == nil`, distinct from a `0` fixture — load-bearing for the edit modal), `test_decode_totals_nullCoercedToZero`, `test_decode_dayTarget_null`, `test_decode_dayTarget_present` (both `basis` values), `test_decode_remaining_signed`, `test_decode_iso8601_timestamps` (as `String`; `deletedAt:null → nil`), `test_decode_journey_macroStats` (ignores `stats`/`entries` without failing), `test_decode_macroDay_incompleteFlag`, `test_decode_daysIncomplete_distinct_from_perDay` (D9: the `daysIncomplete` count and the count of `MacroDay.incomplete==true` rows are read from different fields), `test_decode_deltaPage_envelope` (tombstone present, `nextCursor:nil`), `test_decode_unknownExtraKeys_ignored`. Plus an **encode** guard: `test_encode_perServing_emitsExplicitNulls` (all five keys present with `null` for nil). Run → Expected: compile FAILURE.

- [ ] **Step 3: Implement the DTO + input files** — mirror the interfaces above exactly; timestamps `String`; `PerServingBody.encode(to:)` hand-written with `encodeNil`. Run `MealLogDTOTests` → Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
  xcodebuild -project Clara.xcodeproj -scheme Clara -destination 'platform=iOS Simulator,name=<FIRST_AVAILABLE_IPHONE>' test
  git add -A && git commit -m "feat(stats): byte-for-byte MealLog/MacroStats DTOs (String timestamps, null-preserving perServing) + fixtures"
  ```

---

### Task 3: iOS — `OutboxStore` protocol + versioned `FileOutboxStore` + `QueuedOp` + dispatch-aware coalescing reducer

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Task 2. Pure logic + persistence, no UI, no skill gate. Implements D1; carries F1 (dispatch-aware coalescing) and F6 (versioned/tolerant persistence).

**Files:**
- Create: `Clara/Core/Sync/QueuedOp.swift`
- Create: `Clara/Core/Sync/OutboxStore.swift` (`protocol OutboxStore` + `InMemoryOutboxStore` test fake)
- Create: `Clara/Core/Sync/FileOutboxStore.swift` (actor, versioned Codable envelope in Application Support)
- Create: `Clara/Core/Sync/OutboxCoalescer.swift` (pure coalescing rules)
- Create (test): `ClaraTests/OutboxStoreTests.swift`
- Create (test fixture): `ClaraTests/Fixtures/outbox_v1.json` (prior-version envelope, for the migration test)

**Interfaces:**
- Produces: `struct QueuedOp: Codable, Equatable, Sendable { let clientRequestId: String; var kind: Kind; var payloadJSON: Data; var serverId: String?; var dispatched: Bool; let createdAt: Date }`, `enum Kind: String, Codable { case create, patch, delete }`. **`dispatched`** flips true the first time an op is written to the wire (ack unknown thereafter until a response lands); it is the coalescing pivot, NOT `serverId == nil`.
- Produces: `protocol OutboxStore: Actor { func all() async -> [QueuedOp]; func enqueue(_ op: QueuedOp) async; func remove(clientRequestId: String) async; func update(_ op: QueuedOp) async; func markDispatched(clientRequestId: String) async; func setServerId(_ id: String, for clientRequestId: String) async }`. `FileOutboxStore` persists a **versioned envelope `{ "version": 2, "ops": [QueuedOp] }`** to `Application Support/outbox.json` (atomic write). **Decode is tolerant:** unknown top-level version → attempt best-effort per-op decode; a per-op decode failure **quarantines that op** (skipped, not fatal); a whole-file decode failure **renames the file to `outbox.corrupt.json` and starts empty** rather than silently discarding-in-place. `InMemoryOutboxStore` holds an array. Both are parameterized in tests.
- Produces: `enum OutboxCoalescer` — pure functions applied on enqueue, **keyed on `dispatched` (F1)**:
  - **edit-before-create-dispatched** (`create(cr1).dispatched == false`) → mutate the queued create's `payloadJSON` in place, `kind` stays `.create` (edit rides the create).
  - **delete-before-create-dispatched** (`create(cr1).dispatched == false`) → remove BOTH ops, never hits the wire.
  - **edit-after-create-dispatched** (`create(cr1).dispatched == true`, ack unknown or `serverId` set) → a distinct queued `.patch` addressed by `serverId` if known else `clientRequestId` (so a landed edit is a real PATCH the server's `update:{}` pin protects — a replayed create must never clobber it).
  - **delete-after-create-dispatched** → a distinct queued `.delete` addressed by `serverId` if known else `clientRequestId`; its 404-vs-200 legitimately reports whether the create landed (no both-ops-removed shortcut, so no phantom-resurrection). FIFO per row.

- [ ] **Step 1: Write failing `OutboxStoreTests`** (parameterized over `InMemoryOutboxStore` + real `FileOutboxStore`)

  `test_enqueue_create_persists` (survives reload), `test_coalesce_editBeforeCreateDispatched` (single op remains, payload mutated, `kind==.create`), `test_coalesce_deleteBeforeCreateDispatched` (BOTH removed), `test_coalesce_multipleEdits_beforeDispatch` (create+patch+patch → one create carrying last payload), `test_editAfterCreateDispatched_separatePatchOp` (distinct `.patch`, addressed by `serverId` if known else `clientRequestId` — F1 ack-lost guard), `test_deleteAfterCreateDispatched_realDeleteOp` (distinct `.delete`, NOT a both-removed shortcut — F1 phantom guard), `test_dualAddressing_prefersServerId` (targets `id` when known, else `clientRequestId`), `test_ordering_fifo_perRow`, `test_persistence_versionedEnvelope_roundTrip`, `test_migration_v1Fixture_loads` (loads `outbox_v1.json`), `test_corruptFile_quarantined_notDiscardedInPlace` (bad JSON → `outbox.corrupt.json` created, store starts empty, original bytes preserved), `test_perOpDecodeFailure_skipsOneKeepsRest`. Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `QueuedOp`, `OutboxStore` (+ in-memory fake), versioned `FileOutboxStore`, dispatch-aware `OutboxCoalescer`** — reads once into memory on init (tolerant/quarantining), writes atomically on each mutation. Run → Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(sync): versioned FileOutboxStore + QueuedOp(dispatched) + dispatch-aware coalescing reducer"
  ```

---

### Task 4: iOS — `MealLogSyncEngine` (drain + delta reconciliation + tombstones + 404-drop + poison-message rollback)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 3. Consumes the Phase-2 `WondishAPIClient`/`APIRequest.query`/`APIError`. No UI, no skill gate. Carries F2 (poison path), F5 (cursor residual), and the F1 dispatch semantics.

**Files:**
- Create: `Clara/Core/Sync/DeltaCursorState.swift` (stores `lastSyncSeed: String?` in `UserDefaults`; opaque `nextCursor` echo)
- Create: `Clara/Core/Sync/MealLogService.swift`, `Clara/Core/Sync/StatsService.swift` (thin `WondishAPIClient` wrappers)
- Create: `Clara/Core/Sync/MealLogSyncEngine.swift` (`actor`)
- Create (test): `ClaraTests/SyncEngineTests.swift`

**Interfaces:**
- Produces: `struct MealLogService` — `day(_ localDate:) async throws -> DayLogResponse`, `delta(updatedSince:) async throws -> DeltaResponse`, `create(_:) async throws -> MealLogWriteResponse`, `patch(_ idOrCRID:, _:) async throws -> MealLogWriteResponse`, `delete(_ idOrCRID:) async throws -> MealLogWriteResponse`. All query params travel through `APIRequest.query`. `patch`/`delete` are **dual-addressed**: the path segment is the server `id` OR the `clientRequestId`.
- Produces: `struct StatsService` — `journey(from:to:) async throws -> JourneyPayload` **only** (no `range()` — F10).
- Produces: `actor MealLogSyncEngine` — `func enqueue(_:)`, `func drain() async`, `func pullDelta() async`, `func cancelQueuedDelete(clientRequestId:) async -> Bool` (F7 support), exposing an `AsyncStream`/callback of local-cache mutations the repository observes.
  - **drain (marks `dispatched=true` before each first send):** pops ops FIFO; `create` → POST (201 first insert / 200 idempotent replay both = success, store `serverId`); `.offline`/`.server`/`.transport`/`.decoding` → keep op queued, retry next drain; `.rateLimited(retryAfter:)` → back off by `retryAfter`; **`.notFound` (404 `{error:"Meal log not found"}`) on a DELETE/PATCH → drop the queued op** (`[id]/route.ts:98-100`; sound because only a dispatched op reaches the wire — F1); **any other non-retryable `4xx` (e.g. validation `400`, unexpected `402`) → TERMINAL: drop the op, emit a `.rolledBack(clientRequestId)` cache mutation so the repository removes the orphaned optimistic row, and surface a non-blocking error (F2)**; `.unauthorized` → bubble to `SessionStore`, **keep the op queued** (don't drop). Re-mints the bearer per attempt via the injected `TokenProviding` (a multi-page drain outlives a 60 s JWT).
  - **pullDelta:** first-ever sync sends `updatedSince = "1970-01-01T00:00:00.000Z"`; within a drain, while `nextCursor != nil` immediately re-call `delta(updatedSince: nextCursor!)` — the cursor is **opaque base64url, echoed verbatim, never parsed** (server owns the compound `(updatedAt,id)` tie-break). After the final page (`nextCursor:null`), set `lastSyncSeed = max(updatedAt)` across all rows pulled this drain (string max, same-format UTC ISO); page-1 filter is strict `updatedAt > since` (exclusive). **Cross-drain residual (F5, accepted):** because the terminal page returns `nextCursor:null`, the client cannot persist the server's compound cursor and re-enters the *next* drain on a plain-timestamp seed. The intra-drain compound guarantee therefore does NOT extend across drains; a post-drain write colliding to the millisecond with the prior drain's `max(updatedAt)` could be missed. This is documented as an accepted residual (organic `updatedAt` is monotonic wall-clock); hardening it would require a server change (emit `nextCursor` on the terminal page), which is **out of scope / flag-not-fix** under "no web changes." Tombstone rows (`deletedAt != nil`) apply as local deletions keyed by `id`/`clientRequestId`. A mid-page failure leaves `lastSyncSeed` unchanged (no gap).

- [ ] **Step 1: Write failing `SyncEngineTests`** (scripting `StubURLProtocol`, asserting on recorded requests + local cache)

  `test_drain_create_success_201_storesServerId`, `test_drain_create_replay_200_idempotent`, `test_drain_offline_keepsOpQueued`, `test_drain_rateLimited_backoff` (honored delay recorded), `test_drain_delete_unknownId_404_dropsOp` (no infinite retry), `test_drain_permanent400_dropsOp_and_rollsBackOptimistic` (F2: terminal 4xx drops op + emits `.rolledBack` + surfaces error), `test_editAfterDispatch_sendsSeparatePatch_notMergedCreate` (F1 ack-lost: a landed edit survives a create replay), `test_deleteAfterDispatch_sendsRealDelete_noPhantom` (F1: server row actually deleted), `test_deltaPull_firstPage_sendsISO`, `test_deltaPull_paging_echoesCursorVerbatim` (engine never base64-decodes it), `test_deltaPull_tombstone_removesLocalRow`, `test_deltaPull_upsert_byClientRequestId` (reconcile before `serverId` known), `test_deltaPull_advancesLastSync_onlyOnFinalPage` (mid-page failure leaves seed unchanged), `test_deltaPull_sameTimestampBatch_withinDrain_noDrop` (two rows sharing `updatedAt` split across the 500 boundary, both applied — intra-drain guarantee), `test_reMintTokenPerAttempt` (multi-page drain calls `tokens.token(forceRefresh:)` per request). Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `MealLogService`, `StatsService`, `DeltaCursorState`, `MealLogSyncEngine`** — run `SyncEngineTests` → Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(sync): MealLogSyncEngine (201/200/offline/429/404-drop, terminal-4xx rollback, dispatch-aware ops, verbatim cursor, tombstones, per-attempt re-mint)"
  ```

---

### Task 5: iOS — `MealLogRepository` (day read + optimistic write/edit/delete/undo, server-echo-only)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2–4. Pure state, no UI, no skill gate. Carries F7 (undo-vs-queued-delete).

**Files:**
- Create: `Clara/Features/Stats/MealLogRepository.swift` (`@Observable @MainActor`)
- Create (test): `ClaraTests/MealLogRepositoryTests.swift`

**Interfaces:**
- Produces: `@Observable @MainActor final class MealLogRepository` holding the local day cache (`byMealType` + `dayTotals`/`dayTarget`/`remaining` from the server echo). Methods: `func loadDay(_ localDate: String) async throws` (`GET ?date=`), `func addMeal(_ input: CreateMealLogBody) async` (builds `localDate` via `LocalDate`, fresh `clientRequestId = UUID().uuidString.lowercased()`, source `"MANUAL"`, optimistically inserts into cache, enqueues via `MealLogSyncEngine`, applies the returned `{log, dayTotals, remaining}` echo on drain), `func editMeal(idOrCRID:, patch: PatchMealLogBody) async` (PATCH; `servings`-only edits do NOT resend `perServing` — server rescales), `func deleteMeal(idOrCRID:) async` (optimistic tombstone + queued DELETE), `func undoDelete(_ snapshot: MealLogDTO) async`. Observes the engine's `.rolledBack` mutation to remove an orphaned optimistic row (F2). **Surfaces `dayTotals`/`remaining` verbatim — never sums `logs`.**
- **`undoDelete` (F7):** if the DELETE op for this row is **still queued and un-dispatched**, call `syncEngine.cancelQueuedDelete(clientRequestId:)` and restore the row locally — **no network, no undo-PATCH**. Only if the DELETE has already been dispatched/confirmed does it issue `PatchMealLogBody.undo` (`deletedAt:null`). Never leaves a queued DELETE racing a queued undo-PATCH.

- [ ] **Step 1: Write failing `MealLogRepositoryTests`**

  `test_write_manual_buildsBody` (POST body has `localDate` from `LocalDate`, `source:"MANUAL"`, `name`, `servings`, `perServing`, fresh `clientRequestId`), `test_write_missingLocalDate_neverSent` (repo always supplies it — guards the server 400), `test_write_optimistic_then_reconcile` (cache updated from server echo, no client macro math), `test_edit_servings_noMacroResend` (PATCH sends `servings` only), `test_delete_optimistic_softDelete` (row tombstoned locally, DELETE queued), `test_undo_cancelsQueuedUndispatchedDelete_noNetwork` (F7 branch A), `test_undo_afterDispatch_sendsUndoPatch` (F7 branch B), `test_rolledBack_removesOptimisticRow` (F2: engine `.rolledBack` prunes the orphan), `test_dayTotals_displayFromEcho` (VM surfaces echoes; assert no local summation of `logs`). Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `MealLogRepository`** — run → Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(stats): MealLogRepository — optimistic add/edit/delete, undo-vs-queued-delete, rollback observer, server-echo-only day model"
  ```

---

### Task 6: iOS — Paywall `.statsHistory` context + entitlement wiring

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Phase-2 only. **Ordered BEFORE the VM (Task 7) so `PaywallContext.statsHistory` exists before any VM code references it (fixes the circular dependency).** No new SwiftUI screen (reuses the Phase-2 `PaywallView`), so no skill gate on this task's logic.

**Files:**
- Modify: `Clara/Features/Paywall/PaywallView.swift` (the file holding the Phase-2 `PaywallContext` enum — add the `.statsHistory` case + headline copy; add `Identifiable` conformance if not already present, so `.sheet(item:)` compiles in Task 8)
- Create (test): `ClaraTests/PaywallGatingTests.swift`

**Interfaces:**
- Produces: `PaywallContext.statsHistory` yielding the Stats headline ("See your full history and trends"); per the Phase-2 spec the context **swaps only headline copy**, no structural change. `PaywallContext` is (or becomes) `Identifiable` so `.sheet(item:)` can bind `paywall: PaywallContext?`. `EntitlementStore.isPremium` flipping true (via `session.me.isPremium` or StoreKit entitlement) re-enables the range picker without an app restart.

- [ ] **Step 1: Write failing `PaywallGatingTests`** — `test_statsHistory_context_headlineCopy` (`.statsHistory` yields the Stats headline; only copy swaps), `test_paywallContext_isIdentifiable` (stable `id` per case, so `.sheet(item:)` presents), `test_premiumFlips_unlocksHistory` (flipping `isPremium` true re-enables the range picker without restart). Run → Expected: compile FAILURE.

- [ ] **Step 2: Add the `.statsHistory` case + copy + `Identifiable`** — run → Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(paywall): add .statsHistory context (headline copy) + Identifiable for sheet(item:) + live entitlement flip test"
  ```

---

### Task 7: iOS — `StatsViewModel` (dashboard state + freemium window gating)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 4, 5, 6. Consumes `EntitlementStore`, `MealLogRepository`, `StatsService`, `PaywallContext.statsHistory` (now defined by Task 6). No UI, no skill gate.

**Files:**
- Create: `Clara/Features/Stats/StatsViewModel.swift` (`@Observable @MainActor`)
- Create: `Clara/Features/Stats/StatsSheet.swift` (routing enum)
- Create (test): `ClaraTests/StatsViewModelTests.swift`

**Interfaces:**
- Produces: `enum StatsSheet: Identifiable { case add; case edit(MealLogDTO) }` with `var id: String` (`"add"` / `"edit-\(log.id)"`) so `.sheet(item:)` routes add/edit (fixes the undefined-`StatsSheet` gap).
- Produces: `@Observable @MainActor final class StatsViewModel` with `var selectedDate: Date`, `var localDateString: String { LocalDate.string(from: selectedDate) }`, `var isToday: Bool`, and **two independent state surfaces** so the ring never blocks on the trend:
  - `enum DayState { case loading, empty(DailyTargets?), loaded(DayLogResponse), error(APIError) }`
  - `enum TrendState { case loading, locked, empty, loaded(MacroStats), error(APIError) }`
  - `private(set) var day: DayState`, `private(set) var trend: TrendState`, `var paywall: PaywallContext?`, `var activeSheet: StatsSheet?`.
  - `func refresh() async` loads day + trend concurrently (`async let`). **Freemium window (D4/D10):** free (`!entitlements.isPremium`) pins `from = to = LocalDate.today()` and sets `trend = .locked` (**and never calls `journey()` — no history bytes reach a free client**); premium sends the D4 30-day window. `func step(days:)` guards free-tier history → sets `paywall = .statsHistory` (no network). `addMeal/editMeal/deleteMeal/undoDelete` delegate to `MealLogRepository`. `func presentAdd()` / `func presentEdit(_:)` set `activeSheet`. Error mapping per the Phase-2 taxonomy: `.profileNotFound` → "finish onboarding" empty-state (no retry); `.offline` → render last cache + offline banner; `.premiumRequired` → `paywall = .statsHistory` (defensive — pre-gated, rarely fires). **Trend `incomplete` surfacing (D9):** exposes `MacroDay.incomplete` (partially-estimated, on-line points) separately from `MacroStats.daysIncomplete` (quarantined caption count) so the UI never contradicts itself. **Does NOT touch `UsageMeter` (D2).**

- [ ] **Step 1: Write failing `StatsViewModelTests`**

  `test_load_today_free_windowIsSingleDay_noJourneyCall` (free: `trend==.locked`, `journey()` never invoked — D10 no-leak), `test_load_history_premium_windowFull` (premium: 30-day `journey()` window sent), `test_freeUser_historyTap_presentsPaywall` (sets `paywall == .statsHistory`, no network), `test_profileNotFound_404_emptyState`, `test_offline_showsCachedThenBanner`, `test_activeSheet_addAndEdit_route` (`presentAdd`/`presentEdit` set the right `StatsSheet` id), `test_calorieRing_inputs` (actual arc from `dayTotals.calories`, target from `dayTarget.calories`, over-budget from signed `remaining.calories < 0` — all pass-through), `test_donut_seriesColors` (P/C/F → `.primary`/`.primaryLight`/`.warning`; assert `.info`/`.success` never used), `test_trend_twoIncompleteNotions_distinct` (D9: per-day `.incomplete` markers and the `daysIncomplete` caption count come from different fields and may differ), `test_noReportedMacro_computedClientSide` (only ring-fraction + donut-% presentation math exist; no reported figure derived), `test_usageMeter_notIncremented` (pins D2). Run → Expected: compile FAILURE.

- [ ] **Step 2: Implement `StatsViewModel` + `StatsSheet`** — run → Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(stats): StatsViewModel + StatsSheet routing — concurrent day/trend loads, free today-only no-leak gating, distinct incomplete notions"
  ```

---

### Task 8: iOS — Stats dashboard UI + composition root (ring + tiles + donut + trend) *(SwiftUI)*

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 2, 6, 7.

**Files:**
- Create: `Clara/Features/Stats/StatsView.swift`, `Clara/Features/Stats/StatsEnvironment.swift` (composition-root `EnvironmentValues` keys)
- Create: `Clara/Features/Stats/Components/DaySelectorHeader.swift`, `CalorieRingView.swift`, `MacroTilesRow.swift`, `MacroDonutChart.swift`, `CalorieTrendChart.swift`, `StatsLockedCard.swift`

**Composition root (fixes the "unconstructible VM" gap):** this task establishes the environment plumbing so `StatsView` is runnable when built. Add `StatsEnvironment.swift` defining `EnvironmentValues` keys for a shared `MealLogSyncEngine`, `MealLogRepository`, and `OutboxStore` (default instances constructed at the app root from `@Environment(\.apiClient)` + `EntitlementStore`, mirroring Phase-2 Task 5's `AccountViewModel(api:)` pattern). `StatsView.init` builds its `StatsViewModel` from these injected dependencies + `EntitlementStore`. **App-root instantiation of outbox/engine/repository happens HERE, not deferred to Task 10/11** — Task 10 only adds scenePhase/refresh *triggers*, Task 11 only swaps the tab body.

**Interfaces (public component signatures hoisted per #13):**
- Produces: `StatsView(initialDate: Date = Date())` — NavigationStack, `.navigationTitle("Stats")`, `WColor.background`, one `ScrollView { LazyVStack(spacing: WSpacing.lg) }`, `.refreshable`, `.sheet(item: $vm.paywall)` (paywall) — composing (top→bottom): `DaySelectorHeader`, `CalorieRingView`, `MacroTilesRow`, the premium **Analytics block** (`MacroDonutChart` + `CalorieTrendChart`, wrapped in `StatsLockedCard` for free users). Each surface renders its own `loading`/`empty`/`loaded`/`error` state independently.
- Produces: `DaySelectorHeader(localDateString:isToday:isPremium:onStep:(Int)->Void)`
- Produces: `CalorieRingView(totals: MacroSnapshot, target: DailyTargets?, remaining: Remaining?, reduceMotion: Bool)`
- Produces: `MacroTilesRow(totals: MacroSnapshot, target: DailyTargets?, remaining: Remaining?)`
- Produces: `MacroDonutChart(totals: MacroSnapshot)`
- Produces: `CalorieTrendChart(stats: MacroStats)`
- Produces: `StatsLockedCard(onUnlock: () -> Void)` (wraps a **static teaser**, see F11)

- [ ] **Step 1: Invoke the frontend design skills** — `Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` **before writing any Swift/UI**. Then implement:
  - `DaySelectorHeader`: `‹ date ›` stepper; centered label `WFont.inter(17,.semibold)` + `WBadge(text:"Today",variant:.primary)` when `isToday`; trailing `›` **disabled when `isToday`** (no future days); free-tier back-chevron carries a small `lock.fill` glyph and calls `onStep(-1)` → `paywall = .statsHistory` (discoverable gate, not a silent no-op). 44×44 hit areas.
  - `CalorieRingView`: two-layer `ZStack` — track `Circle().stroke(WColor.border, lineWidth:14)`; progress `Circle().trim(from:0,to:fraction).stroke(arcColor, style: StrokeStyle(lineWidth:14, lineCap:.round)).rotationEffect(.degrees(-90))`, `fraction = min(dayTotals.calories/dayTarget.calories, 1.0)` (**visual clamp only, D5**); over-budget (`remaining.calories < 0`) switches `arcColor` `.primary → .error` + thin over-fill arc. Center: `dayTotals.calories` (`WFont.inter(34,.extrabold).monospacedDigit()`), "of {target} kcal", signed remaining line ("{n} left" `.textSecondary` / "{n} over" `.error` + `exclamationmark.triangle.fill` — **never color-only**). `dayTarget == nil` → neutral track + "Set your targets on the web to see your ring" (D6). `.easeOut(0.35)` trim animation, disabled under Reduce Motion. `.accessibilityElement(children:.ignore)` + `.accessibilityLabel("Calories: {n} of {target}, {n} {left|over}")`.
  - `MacroTilesRow`: `HStack(spacing: WSpacing.md)` of 3 equal `.wCard(padding: WSpacing.md)` tiles (Protein `.primary` / Carbs `.primaryLight` / Fat `.warning` dot), label, grams `.monospacedDigit()`, "of {target}g", 4 pt `Capsule` progress bar vs `WColor.border`. Badge only where flagged: on-target `.primary`, over `.warning`, way-over `.error`, incomplete-day `.neutral` "Est." — **never `.info`/`.success`**. `target == nil` → "—" target, no bar.
  - `MacroDonutChart` (`import Charts`): `SectorMark(angle:.value("g", grams), innerRadius:.ratio(0.62), angularInset:1.5).cornerRadius(4).foregroundStyle(by:.value("Macro", name))` over 3 rows, `.chartForegroundStyleScale(["Protein":WColor.primary,"Carbs":WColor.primaryLight,"Fat":WColor.warning])`, center overlay = total kcal, legend with grams + `%` (**the `%` is the sanctioned presentation-only proportion, F9 — not a reported macro**). Empty/incomplete day → grey ring + "No macros logged".
  - `CalorieTrendChart` (`import Charts`): `LineMark` over `macroStats.dailyMacros` (x = parsed `date`→`Date` on `.dateTime(.day())`, y = `calories`), `WColor.primary`, `.interpolationMethod(.catmullRom)`; dashed `RuleMark(y: target.calories)` in `WColor.textTertiary`; **`MacroDay.incomplete` days get a `WColor.warning` `PointMark` (shape + color) meaning "partially estimated" — they stay on the line/average (D9)**; the caption "N days couldn't be counted" is driven by the DISTINCT `macroStats.daysIncomplete` (quarantined) count, never by the on-line marker count; y-domain `[0, target*1.3]`; `.chartScrollableAxes(.horizontal)` for long ranges.
  - `StatsLockedCard` (F11): wraps a **static, non-network teaser** (a hardcoded illustrative sample chart shape or a neutral placeholder — **NOT** real journey data, since free users never fetch it — avoiding the D4/D10 premium-data leak) under `.blur(radius:14).allowsHitTesting(false)`, over a centered `lock.fill` + "See your trends" + `WButton(.primary)` "Unlock history" → `onUnlock()` (sets `paywall = .statsHistory`). Blur communicates locked-but-real *value*; the tap target is the button, not the (placeholder) chart. Add a comment noting the teaser is intentionally not network-populated.

- [ ] **Step 2: Regenerate, build, test** — `xcodegen generate` → `build` + `test` green (VM/DTO tests still pass; the views are exercised via the fixture harness in Task 11).

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(stats-ui): dashboard + composition root — ring, tiles, Swift Charts donut + trend, static-teaser locked card"
  ```

---

### Task 9: iOS — Day log UI + MANUAL entry sheets + UndoToast primitive *(SwiftUI)*

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 5, 7, 8.

**Files:**
- Modify: `Clara/Features/Stats/StatsView.swift` (append the four `MealTypeSection`s to the `LazyVStack`; bind `.sheet(item: $vm.activeSheet)` → `AddMealSheet`/`EditMealSheet`; host the `UndoToast` overlay) — **fixes the missing-Modify gap**
- Create: `Clara/Features/Stats/Components/MealTypeSection.swift`, `MealRowView.swift`, `UndoToast.swift`
- Create: `Clara/Features/Stats/Sheets/AddMealSheet.swift`, `EditMealSheet.swift`

> **`UndoToast` (allowlist exception, #10):** the reuse allowlist forbids ad-hoc new components, but no existing overlay covers a timed undo affordance. As Phase-2 carved out `Avatar`/`AccountRow`, Phase 6 adds exactly one justified **token-only** primitive — `UndoToast(message: String, onUndo: () -> Void)` built solely from `WColor`/`WFont`/`WRadius`/`WSpacing`/`WButton` (no new colors, flat, hairline border, no shadow). It is listed in Global Constraints and here; nothing else new is introduced.

**Interfaces:**
- Produces: four `MealTypeSection`s (Breakfast/Lunch/Dinner/Snack, fixed order) appended to `StatsView`'s `LazyVStack`; header = meal-type name + kcal subtotal (`.monospacedDigit()`); empty type collapses to one "+ add" affordance (D7). `MealRowView`: leading source glyph (`fork.knife` MANUAL / `camera` PICTURE / `refrigerator` FRIDGE / `book` RECIPE), name (`WFont.inter(15,.semibold)`, `.tail` truncation) + "{servings}× · {source}", trailing kcal `.monospacedDigit()` + "P{n} C{n} F{n}"; `incomplete` rows show `WBadge(.neutral,"Est.")` + `.textTertiary` tint (never `.info`); tap → `presentEdit` (`EditMealSheet`); swipe-trailing `.destructive` Delete → optimistic remove + `deleteMeal` + a 4 s **`UndoToast`** calling `undoDelete` (which cancels a still-queued un-dispatched DELETE with no network, per F7); ≥44 pt row, full-row `.contentShape(Rectangle())`.
- Produces: `AddMealSheet` (`.presentationDetents([.large])`) — `WTextField` Name (required, ≤120), segmented meal-type `Picker` (default = D8 heuristic), Servings stepper+`.decimalPad` (default 1, `0<v≤50`), optional per-serving macros (empty stays `nil`, not 0); `WButton(.primary)` "Add" disabled until Name non-empty → builds `CreateMealLogBody` → `vm.addMeal` → dismiss optimistically; dirty-form dismiss confirm. `EditMealSheet` — same layout pre-filled from the tapped `MealLogDTO` (`perServing` from `NullableMacroSnapshot` so unset shows blank); editable name/mealType/servings/perServing (server rescales — client never resends totals); destructive `WButton(.danger)` "Delete meal" visually separated from primary "Save".

- [ ] **Step 1: Invoke the frontend design skills** — `Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)` before writing Swift. Then implement `UndoToast`, the sections, row, and both sheets per the interface, and wire `.sheet(item: $vm.activeSheet)` in `StatsView`. Use `LazyVStack` sections (not `List`) so the whole page shares one scroll under the analytics cards (no nested-scroll).

- [ ] **Step 2: Regenerate, build, test** — green.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(stats-ui): day log — grouped meal sections, MANUAL add/edit/delete sheets, swipe-delete + token-only UndoToast"
  ```

---

### Task 10: iOS — Sync triggers (scenePhase + write + pull-to-refresh)

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends Tasks 4, 8, 9. Small wiring; implements D3. **The dependency injection at the app root already landed in Task 8's composition root — this task adds only the triggers/indicator.**

**Files:**
- Modify: `Clara/Features/Stats/StatsView.swift` (scenePhase + refreshable drivers + sync indicator)

**Interfaces:**
- Produces: `@Environment(\.scenePhase)` `.active` → `await syncEngine.drain()` + `await syncEngine.pullDelta()`; `.refreshable { await vm.refresh() }` drains + delta-pulls; a drain fires after every successful write. A small nav-bar sync glyph (`arrow.triangle.2.circlepath`) shows while the outbox drains, clearing on success; pending-but-unsynced rows show a faint "pending" dot. `.offline` never surfaces a write error — the op stays queued (terminal-4xx rollback from F2 is the only write-error surface). Each drain attempt re-mints the bearer per request (already handled in Task 4). **`BGAppRefreshTask` is out of scope (D3).**

- [ ] **Step 1: Invoke the frontend design skills** (this modifies SwiftUI) — `Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)`. Wire the scenePhase/refreshable/write-triggered drains + the sync glyph + pending dots.

- [ ] **Step 2: Regenerate, build, test** — green.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(sync): foreground-first drain triggers (scenePhase/write/pull-to-refresh) + nav sync indicator"
  ```

---

### Task 11: iOS — RootTabView wiring + `-UITestFixture` harness

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends all prior. Replaces `StatsPlaceholderView`.

**Files:**
- Modify: `RootTabView` (replace **only** the `.stats` tab body — `StatsPlaceholderView` → `StatsView`)
- Delete: `Clara/Features/Stats/StatsPlaceholderView.swift` (after `StatsView` lands)
- Create: `Clara/Features/Stats/Support/StatsUITestFixture.swift` (`#if DEBUG` — seeds `StubURLProtocol` with canned responses per launch-arg state; reuses the Phase-4 `LaunchFixtures` pattern)

**Interfaces:**
- Produces: a shipped Stats tab. **Preservation clause (#5):** keep `selection: Tab = .scan` (Scan remains the default tab); leave every other tab's body, label, and `systemImage` unchanged — **only the `.stats` body changes** (the shared composition-root dependencies were injected at the app root in Task 8).
- Produces: deterministic `-UITestFixture` states seeding `StubURLProtocol` (no live backend) for: `statsLoadedPremium` (ring + trend + donut + tiles populated), `statsFreeToday` (static-teaser locked analytics), `statsPaywall` (`PaywallView(.statsHistory)`), `statsEmpty` / `statsProfileNotFound` (onboarding empty-state), `statsOffline` (cached + banner), `statsDayLog` (grouped meal list with add/edit/delete + undo toast), `statsIncompleteDays` (trend `.warning` partially-estimated markers + a `daysIncomplete` "N days couldn't be counted" caption — D9 distinction visible).

- [ ] **Step 1: Invoke the frontend design skills** (modifies SwiftUI) — `Skill(ui-ux-pro-max:ui-ux-pro-max)` + `Skill(mobile-ios-design)`. Replace only the `.stats` body, delete the placeholder file, add the `#if DEBUG -UITestFixture` branch feeding each canned state through `StubURLProtocol`.

- [ ] **Step 2: Regenerate, build, test** — green.

- [ ] **Step 3: Commit**

  ```bash
  git add -A && git commit -m "feat(stats): wire StatsView into RootTabView (.stats body only, Scan default preserved) + delete placeholder + -UITestFixture harness"
  ```

---

### Task 12: VERIFY — TZ pre-flight + live wire smoke + build + full ClaraTests suite + fixture screenshots

**Repo:** `/Users/becks/Desktop/NewView/Clara` — depends all. Uses `using-xcode-cli` for every simulator step. **No `node --test`** (no web surface).

- [ ] **Step 0: Flagged-dependency pre-flight (F3 + live wire smoke, #12) — halt-and-escalate on failure, do NOT modify the web repo**
  - **`TZ=UTC` check (F3):** confirm the deployed backend process runs `TZ=UTC` (Vercel default). Request `GET /api/journey?from=<today>&to=<today>` for a known-logged day and confirm the returned window's last `MacroDay.date` equals the requested `to` (a negative-offset server TZ would shift it). If the window is shifted, **halt and escalate** — the trend path is not day-path-equivalent under non-UTC.
  - **Live wire smoke (the three assumptions no `StubURLProtocol` test can prove):** against a staging bearer — (a) create a MANUAL log → `pullDelta` round-trips it back (echoes the opaque cursor verbatim); (b) **dual-addressed PATCH then DELETE by `clientRequestId`** (not server `id`) both succeed; (c) DELETE an unknown id → confirm the literal `404 {error:"Meal log not found"}` body the coalescer's drop rule keys on. Record results; any mismatch → halt and escalate (client wire assumption is wrong, not the web code).

- [ ] **Step 1: Regenerate + build**

  ```bash
  cd /Users/becks/Desktop/NewView/Clara && xcodegen generate
  DEV=$(xcrun simctl list devices available | grep -m1 -o 'iPhone [0-9][^(]*' | xargs)
  xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" build
  ```
  Expected: `BUILD SUCCEEDED`.

- [ ] **Step 2: Full unit suite (green)**

  ```bash
  xcodebuild -project Clara.xcodeproj -scheme Clara -destination "platform=iOS Simulator,name=$DEV" test
  ```
  Expected: `TEST SUCCEEDED` — `LocalDateFormatterTests`, `ClockTests`, `MealLogDTOTests`, `OutboxStoreTests`, `SyncEngineTests`, `MealLogRepositoryTests`, `PaywallGatingTests`, `StatsViewModelTests` all pass.

- [ ] **Step 3: Boot + install + screenshot each state** (via `-UITestFixture` over `StubURLProtocol` — no live backend)

  ```bash
  xcrun simctl boot "$DEV"; xcrun simctl bootstatus "$DEV" -b
  xcrun simctl install "$DEV" <path-to-Clara.app>
  for S in statsLoadedPremium statsFreeToday statsPaywall statsEmpty statsOffline statsDayLog statsIncompleteDays; do
    xcrun simctl launch --terminate-running-process "$DEV" io.wondish.clara -UITestFixture "$S"
    xcrun simctl io "$DEV" screenshot <scratchpad>/stats-$S.png
  done
  ```

  **Pass criteria:** TZ pre-flight + live smoke clean + `BUILD SUCCEEDED` + full suite green + seven screenshots showing: **loaded (premium)** ring + trend + donut + tiles; **free / today-only** with the blurred *static-teaser* locked analytics card; **paywall** `PaywallView(.statsHistory)`; **empty / profile-not-found** onboarding empty-state; **offline** cached data + banner; **day log** grouped-by-mealType list with add/edit/delete + undo toast; **incomplete-days** trend with `WColor.warning` partially-estimated markers AND a distinct `daysIncomplete` caption (D9). Visually confirm maroon `#812549`, cream `#F9F7ED`, Inter, light-only, flat surfaces/hairline borders/no shadows, `.monospacedDigit()` numbers, ≥44 pt targets, and that no `.info`/`.success` badge distinguishes macro state.

- [ ] **Step 4: Commit the VERIFY report**

  ```bash
  git commit --allow-empty -m "chore(verify): phase 6 TZ pre-flight + live wire smoke + build + full ClaraTests suite + Stats fixture screenshots green"
  ```

---

## Out of scope for Phase 6 (deliberately)

- **Any web change** — no new endpoint, schema, migration, or `lib/*.ts`; every backend consumed is already shipped and pinned by existing coverage. If a gap surfaces (incl. the F3 non-UTC server-TZ case or the F5 terminal-page cursor), **halt and escalate** — do not silently patch the web repo.
- **Meal-log `?from=&to=` range mode / `RangeResponse` / `StatsService.range()`** — not built; the trend reads `GET /api/journey` only (F10). One range reader.
- **`BGTaskScheduler` / `BGAppRefreshTask` true-background sync (D3)** — Phase 6 is scenePhase + write-triggered + pull-to-refresh; the queue converges without it.
- **Hardening the cross-drain delta cursor (F5)** — accepted residual; the fix requires a server change (emit `nextCursor` on the terminal page) and is flag-not-fix under "no web changes."
- **`POST /api/meal-log/batch` multi-item logging** — Picture/Fridge (Phases 3/4) use it; Phase-6 MANUAL logging uses the single `POST`.
- **CUSTOM- and RECIPE-source entry from Stats** — Phase 6 hand-entry is MANUAL only (CUSTOM is premium-gated `402`, RECIPE requires a `recipeId` from other surfaces).
- **Weight/mood sparkline** from the journey `stats` block — `JourneyPayload` deliberately decodes only `macroStats`; add `JourneyStats` later if a sparkline lands.
- **SwiftData local cache / CloudKit sync** — D1 ships the versioned file-backed outbox; SwiftData is the named alternative if the cache grows. The server is the sync authority.
- **Server-side history/trends enforcement (D10)** — no server gate exists; the freemium rule is client-only via `EntitlementStore` and is **bypassable** by a crafted request. Signed off as honor-system (consistent with Phase-2 D15), surfaced in the D-table, not buried here.
- **Deep-link entry** beyond `StatsView(initialDate:)` plumbing (notification routing is a later phase).

## Verification

- **iOS unit tests (XCTest, `@testable import Clara`, auto-picked under `ClaraTests/`; every unit isolates pure logic behind `TokenProviding` / `URLProtocol` / `OutboxStore` / `NowProviding` seams — no live backend, no `ModelContainer`):** `LocalDateFormatterTests` (POSIX format, device-timezone day boundary / T3 guard, non-Gregorian-locale stability, web golden pairs — T1) + `ClockTests` (`FixedClock`/`SystemClock` seam); `MealLogDTOTests` (day/meallog/delta/journey decode, **null-preserving `perServing`**, `String` timestamps, tombstone rows, lenient `stats`/`entries` omission, the two-distinct-`incomplete`-notions decode, explicit-null macro encode — T2); `OutboxStoreTests` (versioned persistence round-trip, v1 migration, corrupt-file quarantine, per-op tolerant decode, **dispatch-aware coalescing** incl. ack-lost edit-becomes-PATCH and delete-becomes-real-DELETE, dual-addressing — T3/F1/F6); `SyncEngineTests` (201/200/offline/429/**404-drop**, **terminal-4xx drop+rollback**, verbatim cursor echo, tombstone removal, `clientRequestId` reconcile, `lastSync` advances only on final page, intra-drain same-timestamp-batch no-drop, per-attempt re-mint — T4/F1/F2); `MealLogRepositoryTests` (MANUAL body build, always-supply-`localDate`, optimistic-then-reconcile, servings-only edit, optimistic soft-delete, **undo-vs-queued-delete both branches**, **rollback observer**, echo-only totals — T5/F7/F2); `PaywallGatingTests` (`.statsHistory` copy, `Identifiable`, live entitlement flip — T6); `StatsViewModelTests` (free today-only **no-journey-call** vs premium window, history-tap paywall, profile-not-found empty-state, offline banner, `StatsSheet` routing, ring/donut/trend pass-through inputs, **two-distinct-incomplete-notions**, no-reported-macro-computed-client-side, `.info`/`.success` never used, **`UsageMeter` untouched** — T7/D9/D10). Run: `xcodebuild … test`.
- **Web unit tests: NONE.** Phase 6 adds no web endpoint, schema, migration, or `lib/*.ts`. Every contract consumed is already pinned by `lib/meal-log.test.ts`, `lib/journey.test.ts` (incl. `computeMacroStats`), `lib/macros.test.ts`. **The plan's `node --test` obligation is nil** (contrast Phases 3/4, which do add endpoints).
- **Flagged (unverified-by-unit-test) wire dependencies — proven by the Task 12 Step 0 live smoke, not guessed:** dual-addressing by `clientRequestId` in the path segment; the opaque `?updatedSince=` compound-cursor round-trip; the `404 {error:"Meal log not found"}` coalescing signal; and the `TZ=UTC` journey-window assumption (F3 — halt-and-escalate if the deployed backend is not UTC).
- **Build:** `xcodegen generate` → `xcodebuild -project Clara.xcodeproj -scheme Clara … build` → `BUILD SUCCEEDED`.
- **Simulator screenshots (via `using-xcode-cli`, `#if DEBUG -UITestFixture` over `StubURLProtocol`):** seven states — loaded (premium), free/today-only (static-teaser locked analytics), paywall (`.statsHistory`), empty/profile-not-found, offline (cached + banner), day log (grouped add/edit/delete + undo toast), incomplete-days (trend `.warning` partially-estimated markers + distinct `daysIncomplete` caption). Confirm brand tokens, Inter, light-only, flat/no-shadow surfaces, `.monospacedDigit()`, ≥44 pt targets, and the `.info`/`.success` discrimination hazard avoided.