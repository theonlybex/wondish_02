# Plan: iOS Journal calendar grid + full-screen day view

**Date:** 2026-07-25 · **Spec:** docs/superpowers/specs/2026-07-25-journal-calendar-grid-design.md
**Repo:** Clara only. Branch `journal-grid` off main (fc23c94+). Baseline suite: 357/357.
**No backend/wire changes.** Contract of record for payloads = existing
`JournalDTOs.swift` + `SupplementDTOs.swift` (do not touch DTO files).

## Task 1 — Calendar grid model (logic + tests, no UI)

Extend `Clara/Features/Journal/JournalViewModel.swift`:

- Keep existing `load()` merge exactly (states, non-fatal history, `date <= today`
  filter for the feed data). Additionally retain from the calendar payload:
  `planStartDate`, `planEndDate`, and `maxCalorieTarget` (max `dailyCalorieTarget`
  across ALL plan entries, not just past ones), plus `daysByDate: [String: JournalDay]`.
- New nested pure types + API (all unit-testable without SwiftUI):
  - `struct DayCell: Equatable, Identifiable` — `date: String` (YYYY-MM-DD, id),
    `dayNumber: Int`, `inDisplayedMonth: Bool`, `isToday: Bool`,
    `isTappable: Bool`, `dotCount: Int` (min(meals,3); 0 when not in month).
  - `private(set) var displayedMonth: String` (YYYY-MM), initialized to `today`'s
    month; `var canGoBack/canGoForward: Bool` clamped to
    `planStartDate.month … max(planEndDate, today).month`;
    `func goBack()/goForward()` (no-ops when clamped).
  - `func cells() -> [DayCell]` — Monday-first grid for `displayedMonth`,
    padded with leading/trailing out-of-month cells to full weeks.
    `isTappable` = in displayed month AND `planStartDate <= date <= today`.
  - `private(set) var selectedDate: String?` + `func select(_ date: String)`
    (ignores non-tappable dates), `func closeDay()` keeps selection.
  - `func day(for date: String) -> JournalDay?` (nil ⇒ empty past day),
    `func planDayNumber(for date: String) -> Int?` (1-based from planStartDate,
    nil outside plan range).
- Date math: reuse the existing local-date helpers (`localDateString` etc.);
  lexicographic compare for YYYY-MM-DD is sanctioned repo convention.
- TESTS (`ClaraTests/JournalViewModelTests.swift`, extend): month cell layout for a
  known month (leading pad, trailing pad, Monday start), dot counts, today flag,
  future/pre-plan not tappable, chevron clamping both edges (incl. plan ending
  before today ⇒ forward clamp is today's month), select ignores future,
  planDayNumber boundaries (start day = 1, day before start = nil),
  maxCalorieTarget over full plan.

## Task 2 — Day-detail view model (logic + tests)

New `Clara/Features/Journal/JournalDayDetailViewModel.swift` (register in pbxproj):

- Init with `date: String`, `day: JournalDay?`, `planDayNumber: Int?`,
  `maxCalorieTarget: Double?`, `service: SupplementProviding`.
- `enum SupplementsState: Equatable { case loading, detailed([SupplementDTO]), fallback }`
  — `load()` calls `service.list(date: date)`; success ⇒ `.detailed` (rows show
  taken/missed + dosage); thrown error ⇒ `.fallback` (rows from
  `day.supplementsTaken`/`supplementsTotal`). Skip the fetch entirely (straight to
  `.fallback`) when the day has zero supplement history AND no meals — but still
  fetch when history exists (deleted-supplement caveat per spec).
- Presentation helpers (pure, tested): `ringRatio` (min(1, target/max), 1 when max
  nil/0, nil when target nil), `takenSummary` ("N of M taken") for both states,
  title/date formatting, `showCaloriesCard`/`showMealsCard`/`showSupplementsCard`,
  all-empty flag.
- TESTS: new `ClaraTests/JournalDayDetailViewModelTests.swift` — enrichment success
  maps taken flags, failure falls back to history names, skip-fetch rule,
  ringRatio guards (nil target / nil max / zero max / clamp >1), summary strings,
  card visibility incl. all-empty day.

## Task 3 — Views (UI; invoke ui-ux-pro-max first)

- Rewrite `JournalView.swift` body per spec/mockup: calendar card (month header
  with 44pt chevron targets, weekday row, `LazyVGrid` 7 columns, cells per DayCell),
  hint copy, existing loading/failed/empty states retained (skeleton now mimics the
  calendar card). Feed rows/`JournalDayCard` deleted (and their pbxproj entries if
  in separate files). Tap ⇒ `vm.select(date)` + present full-screen cover.
- New `Clara/Features/Journal/JournalDayDetailView.swift` (register in pbxproj):
  full-screen cover content per spec — ✕ close (44pt), title block, CALORIES ring
  card, MEALS card (reuse the existing row treatment), SUPPLEMENTS card with
  `.task { await vm.load() }` and redacted placeholder while `.loading`;
  all-empty state. Zoom transition from tapped cell, availability-gated exactly like
  MealPlanView's dish pager (plain cover on iOS 17).
- Design-system tokens only; day cells + chevrons get `wMinTapTarget` treatment
  (helper shipped 938b0ee); accessibility labels per spec; dots
  `accessibilityHidden(true)`.

## Task 4 — Fixtures, launch args, audit

- Extend `LaunchFixtures.swift`: `journalLoaded` fixture must exercise the grid
  well — ensure its two days fall in the current fixture month and add a
  fixture `FixtureSupplementProviding.list(date:)` payload (one taken, one missed
  w/ dosage, plus a failure toggle for the fallback path). Add launch arg
  `-journalDay <YYYY-MM-DD>` that auto-selects+presents that day's detail
  (mirrors `-expandDish` convention) for screenshot automation.
- Screenshot sweep (controller verifies each): grid loaded month, day detail
  (detailed supplements), day detail (fallback), empty day, journal failed state,
  Dynamic Type XXL grid.
- Full suite green; console hygiene; commit trail per task; merge `journal-grid`
  → main ff after final review.

## Review dimensions (named)

1. Grid date math (month boundaries, Monday-first padding, DST-proof via string
   dates, clamp edges).
2. State machine: selection vs cover dismissal; supplements enrichment fallback.
3. No wire-contract drift: DTO files untouched; `list(date:)` called with the
   day's date string verbatim.
4. Design parity with accepted mockup (dots, today outline, selected fill,
   dimmed future/out-of-plan, hint copy, card order in day view).
5. Deletions are complete: no dead feed code, no orphaned pbxproj refs.
