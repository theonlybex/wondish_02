# Supplements & Journal — Meal Plan hub (iOS + backend)

**Date:** 2026-07-24
**Status:** Approved (design + interactive mockup accepted by user)
**Scope:** wondish_02 backend (Prisma + API) and Clara iOS app. No web UI this cycle.

## Summary

The iOS center tab becomes a "Meal Plan hub" with a top segmented switcher —
**Meal Plan | Supplements | Journal** — defaulting to Meal Plan and swapping the
content below, mirroring the bottom tab bar interaction. Supplements is a new
user-managed, server-backed daily supplement tracker. Journal is a read-only
reverse-chronological history of past days' dishes and supplements taken.

An interactive HTML mockup using the app's design tokens was reviewed and
accepted by the user on 2026-07-24.

## Decisions made (with user)

1. **Supplements data:** user-managed, server-backed. Users add their own
   supplements; stored in Postgres via new Prisma models so they sync to the
   web app later and survive reinstalls.
2. **Entry shape:** name (required), dosage (optional free text, e.g.
   "2000 IU · 1 capsule"), time-of-day slot (`MORNING | AFTERNOON | EVENING`).
   Daily check-off per supplement; checks reset each day; intake history kept
   server-side.
3. **Cycle scope:** backend API + iOS only. Web UI in a later cycle (the API
   will already exist).
4. **Journal home:** third segment on the Meal Plan hub (not Account, not a
   6th bottom tab). Bottom tab bar unchanged (5 tabs).

## iOS design

### PlanHubView (new, `Features/MealPlan/`)

- `RootTabView` swaps `MealPlanView()` for `PlanHubView()` on the center tab.
- Owns the `NavigationStack`, the "Meal Plan" nav title, and a pill segmented
  switcher (design-system styled: `surfaceSecondary` track, white active chip
  with `border` hairline and semibold `primary` text — NOT stock
  `UISegmentedControl`). Segments: Meal Plan, Supplements, Journal.
- Default segment: Meal Plan. Selection is in-memory state (resets on app
  relaunch; no persistence needed).
- Hosts the three segment views below the switcher; switching swaps content
  with a short fade/rise transition.
- `MealPlanView` content becomes the first segment essentially unchanged
  (its own `NavigationStack`/`navigationTitle` move up to `PlanHubView`).

### Supplements segment (new, `Features/Supplements/`)

Files: `SupplementsView.swift`, `SupplementsViewModel.swift`,
`SupplementService.swift`, `SupplementDTOs.swift`.

- **Summary card:** "TODAY, <date>" kicker, big "N of M taken" count, teal
  progress bar. Mirrors the meal-plan summary card idiom.
- **List:** grouped by time slot (Morning / Afternoon / Evening, with SF
  Symbol slot icons — sun.max, clock, moon). Each row: tappable check circle
  (26pt visual, ≥44pt hit area — same interaction as the shopping-list rows),
  name, dosage caption. Checked rows: teal filled circle, name struck
  through/tertiary. Empty slots render nothing (no empty group headers).
- **Check-off:** optimistic toggle, `POST /api/supplements/[id]/intake` with
  today's local date; revert + error alert on failure.
- **Add:** full-width primary "Add supplement" button → sheet (medium detent):
  name field (required, non-empty), dosage field (optional), 3-chip time-slot
  picker (default Morning). Save → `POST /api/supplements`, insert into list.
- **Edit/delete:** swipe actions on rows (Edit opens the same sheet prefilled
  → `PATCH`; Delete confirms → `DELETE`). Deleting keeps historical intake
  rows (journal still shows past days truthfully; see backend).
- **Empty state:** friendly icon + "No supplements yet" + explanatory line +
  primary "Add supplement" button.
- **Loading/failed states:** redacted placeholder rows / retry button,
  mirroring `MealPlanView` patterns.

### Journal segment (new, `Features/Journal/`)

Files: `JournalView.swift`, `JournalViewModel.swift`, `JournalService.swift`,
`JournalDTOs.swift`.

- Read-only, reverse-chronological day cards, newest first. Today's card
  appears at the top once it has any data (logged meals or supplement
  intakes); live tracking still happens in the other two segments.
- Each card: date kicker ("YESTERDAY · JUL 23" / weekday · date), day's
  planned/logged kcal (when available), rows of meals eaten (meal-type label,
  dish name, thumbs up/down icon when rated), and a supplements footer line
  (pill icon, "2 of 3 taken — Vitamin D3, Omega-3").
- Data sources: existing `GET /api/journal/calendar` (entries + meals + per-day
  targets over the plan range) + new `GET /api/supplements/history`. If the
  calendar payload lacks dish names for journal meals, extend the calendar
  route server-side to include recipe names — no N+1 recipe fetches from the
  phone.
- Empty state: "No history yet — logged meals and supplements will show up
  here."
- Pagination: not needed this cycle; the calendar route already bounds the
  range to the meal-plan window.

### Project integration

- New Swift files are added to `Clara.xcodeproj/project.pbxproj` by hand
  (xcodegen is not installed on this machine).
- DEBUG `LaunchFixtures` stubs for Supplements and Journal so simulator
  screenshots are deterministic, following the existing
  `stubMealPlanProviding` pattern.

## Backend design (wondish_02)

### Prisma models

```prisma
model Supplement {
  id        String             @id @default(cuid())
  patientId String
  patient   Patient            @relation(fields: [patientId], references: [id], onDelete: Cascade)
  name      String
  dosage    String?
  timeSlot  String             // "MORNING" | "AFTERNOON" | "EVENING"
  deletedAt DateTime?          // soft delete: history stays truthful
  createdAt DateTime           @default(now())
  intakes   SupplementIntake[]

  @@index([patientId])
}

model SupplementIntake {
  id           String     @id @default(cuid())
  supplementId String
  supplement   Supplement @relation(fields: [supplementId], references: [id], onDelete: Cascade)
  patientId    String
  date         DateTime   // local midnight, journal-style
  createdAt    DateTime   @default(now())

  @@unique([supplementId, date])
  @@index([patientId, date])
}
```

Soft delete (`deletedAt`) rather than hard delete so past journal days keep
showing what was actually taken; active-list queries filter
`deletedAt: null`. Migration via `prisma migrate dev` (authored in-cycle, run
per the repo's usual release process).

### API routes (all Clerk-authed, patient-scoped like `/api/journal`)

- `GET /api/supplements?date=YYYY-MM-DD` → active supplements + which are
  taken on that date: `{ supplements: [{id, name, dosage, timeSlot, takenToday}] }`.
  Missing/invalid `date` → today (server local), consistent with journal GET.
- `POST /api/supplements` `{name, dosage?, timeSlot}` → created supplement.
- `PATCH /api/supplements/[id]` `{name?, dosage?, timeSlot?}` → updated.
- `DELETE /api/supplements/[id]` → soft delete (sets `deletedAt`).
- `POST /api/supplements/[id]/intake` `{date, taken}` → upsert/delete the
  intake row for that date; idempotent.
- `GET /api/supplements/history?from&to` → per-day intake summaries:
  `{ days: [{date, taken: [{name}], total}] }` including soft-deleted
  supplements' past intakes.

### Validation (`lib/supplements.ts` + tests)

Pure functions following `lib/journal.ts`:

- name: non-empty trimmed string, max 100 chars.
- dosage: optional string, max 100 chars.
- timeSlot: one of `MORNING | AFTERNOON | EVENING`.
- dates: reuse `parseLocalDateStrict` from `lib/journal.ts`.
- ownership: every `[id]` route verifies the supplement belongs to the
  caller's patient (404 otherwise).

### Journal calendar extension

If `GET /api/journal/calendar` does not already return dish names for meals,
add recipe `name` to its meal payload (single joined query, no client N+1).

### Standing-rule note

The diet-match rule ("every food surface derives bans via `lib/diet-match.ts`")
does **not** apply: supplements are free-text user entries, not food-catalog
surfaces. Explicitly out of scope.

## Testing

- **Backend:** unit tests for `lib/supplements.ts` validation (`node:test`
  via `npm test`, following `lib/journal.test.ts`).
- **iOS:** `ClaraTests` for `SupplementsViewModel` (load/add/toggle/error
  paths with stub service), `JournalViewModel` (merge of calendar + history),
  and DTO decoding — following `MealPlanViewModelTests` /
  `MealPlanDTOTests` patterns.

## Out of scope

- Web UI for supplements/journal (later cycle; API is ready).
- Supplement scheduling beyond daily (weekday frequency etc.).
- Reminders/notifications for supplements.
- Clara-recommended supplements.
