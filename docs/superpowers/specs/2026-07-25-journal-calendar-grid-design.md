# Journal calendar grid + full-screen day view (iOS) — design spec

**Date:** 2026-07-25 · **Repo:** Clara (iOS only — zero backend changes)
**Mockup:** user-accepted artifact (claude.ai/code/artifact/37cfc08a-4178-4875-a662-cd09604d22cc), 2026-07-25.
**Supersedes:** the Journal segment's newest-first card feed (shipped 2026-07-24). The feed is removed.

## Goal

Bring the web journal's calendar → tap-a-day → day-detail pattern to the iOS Journal
segment (center Plan tab), where the day detail is a **full-screen view** showing
everything logged that day: meals with ratings, supplements, and the day's calorie
picture. Web parity plus supplements (web has no supplements surface).

## Screen 1 — Journal segment: month grid

- A single white rounded card (design-system radius/tokens) containing:
  - Month header `◀ July 2026 ▶`. Chevrons page months. Range is clamped to
    `planStartDate … max(planEndDate, today)`; chevrons disable at the edges.
    Initial month = the month containing `today`.
  - Monday-first weekday row `M T W T F S S` (per accepted mockup).
  - Month grid. Each day cell (≥44pt tap target):
    - **Dots (0–3)** under the number = `min(meals.count, 3)` for that day.
    - **Today** = outlined (inset ring, burgundy).
    - **Selected** = filled burgundy, white number/dots. Selection persists while
      the segment is alive.
    - **Future days and days outside the plan range** = dimmed, not tappable.
    - **Tappable** = any non-future, in-range day (with or without data — an empty
      past day opens a day view with empty states, matching "0 meals" reality).
- Below the card: hint copy "Tap a day to see everything you logged".
- Existing segment states are preserved: loading skeleton (skeleton of the calendar
  card), failed ("Couldn't load your journal" + Try again), and empty
  (no plan/no data → existing "No history yet" treatment).

## Screen 2 — Full-screen day view

Presented as a full-screen cover from the tapped cell (zoom transition
`matchedTransitionSource`/`.navigationTransition(.zoom)` availability-gated on the
iOS-17 floor, same pattern as the meal-plan dish pager). ✕ (top-left, 44pt) closes
back to the grid with selection kept.

Content (scrolling, read-only):
- **Title block:** weekday+date ("Wednesday, July 22"), subtitle "Day N of your plan"
  (N from `planStartDate`, 1-based; omit the subtitle for days outside the plan range).
- **CALORIES card:** ring showing this day's `dailyCalorieTarget` relative to the
  highest target across the plan (web `CaloricSection` parity: ratio =
  `min(1, dailyTarget / maxTargetAcrossPlan)`, full ring when max is 0/absent),
  big number = target; chips: Target kcal · Meals logged (plain count, e.g.
  "Meals logged · 3"). Card hidden when the day has no `dailyCalorieTarget`
  and no meals.
- **MEALS card:** rows `MEALTYPE · recipeName · rating thumb` (teal up / red down /
  none), exactly the current card-feed row treatment. Hidden when no meals.
- **SUPPLEMENTS card:** on open, lazily fetch `SupplementProviding.list(date:)`
  (existing endpoint `GET /api/supplements?date=`) to get the full list with dosage
  and per-date taken state → rows: teal tick (taken) / empty tick (missed), name,
  `· dosage` when present; summary "N of M taken". If the fetch fails, fall back to
  the already-merged history data (taken names + total, no missed names/doses).
  Card hidden when the day has zero supplement data in both sources.
- All-empty day: friendly empty state ("Nothing logged this day").

## Data (all existing — no new endpoints, no wire changes)

- `GET /api/journal/calendar?allMeals=1` → planStartDate/planEndDate, per-day
  `dailyCalorieTarget` + meals (mealType, recipeName, rating). Already fetched.
- `GET /api/supplements/history?from&to` → per-day taken names + total. Already
  fetched and merged in `JournalViewModel`.
- `GET /api/supplements?date=` → per-day full supplement list (name, dosage,
  timeSlot, taken). New *call site* (day view), existing route + service method.
- Known accepted limitation: a supplement soft-deleted after the viewed day
  disappears from `list(date:)`; the history fallback still names it if taken.

## Non-goals (explicitly out of scope this cycle)

- Editing from the day view (re-rating meals, toggling supplement ticks) — later step.
- Any web changes; any backend changes.
- Notes/mood journaling (web `JournalSection` form) — not in the iOS data layer yet.

## Accessibility & quality bars

- Day cells: ≥44pt targets, `accessibilityLabel` like "July 22, 3 meals logged,
  supplements taken", selected/today traits; dots are decorative (hidden).
- Dynamic Type XXL must not break the grid (numbers may truncate dots row spacing,
  never overflow cells horizontally).
- Light-mode-locked app; design-system tokens only (WColor/WSpacing/WFont).
- VM logic (grid construction, month clamping, day-detail enrichment fallback)
  unit-tested; views verified by fixture screenshots.
