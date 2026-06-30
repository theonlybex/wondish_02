# Weekly Target — Rising Momentum Panel

**Date:** 2026-06-30
**Status:** Design approved, pending implementation plan
**Area:** Overview → Caloric Profile card; caloric engine; caloric-profile API

---

## 1. Problem

The overview's Caloric Profile card currently shows a **static BMI gauge** and a **static "Target Weight"** drawn straight from the profile's final goal. Because patients eat to a gradual deficit/surplus meal plan, the system already knows where they *should* be at each stage — but never surfaces it. There is no week-by-week sense of progress or momentum.

We want to replace the **BMI gauge** with a **"This Week's Target"** panel that shows the weekly weight target and frames progress as an **upward, motivational climb** toward the goal.

## 2. Goals / Non-goals

**Goals**
- Compute a per-week weight target from the existing gradual deficit/surplus schedule.
- Surface "this week's target" plus a rising progress visualization in the Caloric Profile card, replacing the BMI gauge.
- Support both directions: loss (deficit) and gain (surplus), plus a maintain state for healthy BMI.
- Keep a small BMI-class word so that signal is not fully lost.

**Non-goals (v1)**
- No overlay of the patient's *actual logged weights* against the plan. The curve plots the **planned glide path only**. (Future enhancement.)
- No DB schema migration. No new API endpoint.
- No change to how the meal plan itself is generated.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Where it lives | Replaces the **BMI gauge** block in `CaloricProfileCard.tsx` (calorie ring stays to its left). |
| What the number means | **"End of this week"** — weight you should reach 7 days from now, projected from current weight along the plan's pace. |
| Anchoring of the hero target | **Recompute from current weight** each render (adapts to real progress). |
| Anchoring of the progress % / curve | Anchored to `mealPlanWeight` + `mealPlanStartDate` (weight/date when the active plan was generated). |
| Visual | **Rising momentum curve** — a smooth filled area rising left→right where Y = progress % toward goal, a pulsing "now" marker, and a goal flag at the top-right. |
| Curve data source | **Planned glide path only** (no actual-weight overlay in v1). |
| BMI | Keep the small `cbmiClass` word in the panel; drop the gauge. |

## 4. The math — new pure function

Add to `lib/caloric-engine.ts`, reusing existing helpers (`gradualDailyDeficit`, `gradualDailyCals`, `getActivityMultiplier`, `estimateDaysToGoalWeight`). Pure function, no DB access — safe to unit test in isolation.

```ts
export interface WeeklyTargetPoint {
  week: number;        // 1-based week index from plan start
  progressPct: number; // 0–100, planned progress toward goal at end of that week
}

export interface WeeklyTarget {
  direction: "lose" | "gain" | "maintain";
  currentWeightKg: number;
  thisWeekTargetKg: number;   // end-of-this-week projection, clamped at goal
  weeklyDeltaKg: number;      // signed: negative = losing, positive = gaining
  goalWeightKg: number;
  anchorStartKg: number;      // mealPlanWeight (or currentWeight fallback)
  progressPct: number;        // achieved progress now, 0–100 (anchor → current)
  weekIndex: number;          // current week number from mealPlanStartDate (>=1)
  totalWeeks: number;         // re-estimated from current weight
  curve: WeeklyTargetPoint[]; // planned glide path, 0→100%
  cbmiClass: CBMIClass;
}

export function computeWeeklyTarget(args: {
  profile: CaloricProfile;       // already computed via computeAllMetrics
  anchorStartKg: number | null;  // mealPlanWeight in kg; null if no plan yet
  planStartDate: Date | null;    // mealPlanStartDate; null if no plan yet
  now?: Date;
}): WeeklyTarget | null;
```

### 4.1 Direction
- `overweight` / `obese` → `"lose"` (deficit).
- `underweight` → `"gain"` (surplus).
- `healthy` → `"maintain"` (no weekly change; see edge cases).

### 4.2 Anchors
- `anchorStartKg` = `mealPlanWeight` converted to kg, falling back to current weight when no plan exists yet.
- `planDay` = whole days between `planStartDate` and `now` (0 when no plan). Sets the **ramp depth** so the deficit/surplus magnitude reflects the true position in the schedule rather than resetting to week 1.
- `weekIndex` = `floor(planDay / 7) + 1`.

### 4.3 Hero target ("end of this week")
- `tdee` = `profile.tdeeCBW` (TDEE at current weight).
- `maintenanceFloor` = TDEE at goal weight (`profile.tdeeUTBW ?? profile.tdeeWTBW`), consistent with `computePredictionEstimate`.
- Sum the next 7 days of adjustment at the current ramp position:
  `weekKcal = Σ_{i=1..7} (tdee − gradualDailyCals(tdee, planDay + i, cbmiClass, minCal, maintenanceFloor))`.
  For `gain`, `gradualDailyCals` returns intake > TDEE, so `weekKcal` is negative (a surplus) — the sign carries through.
- `weeklyDeltaKg = −weekKcal / 7700`  (loss → negative; gain → positive).
- `thisWeekTargetKg = clamp(currentWeightKg + weeklyDeltaKg, …toward goal)`:
  - loss: `max(thisWeekTarget, goal)` (never below goal).
  - gain: `min(thisWeekTarget, goal)` (never above goal).

### 4.4 Achieved progress (the motivational %)
- `progressPct = clamp01((anchorStartKg − currentWeightKg) / (anchorStartKg − goalWeightKg)) * 100`.
  - Works for both directions because numerator and denominator share sign.
  - When `anchorStartKg === goalWeightKg` (degenerate), treat as 100% / maintain.

### 4.5 Planned glide-path curve
- `totalDays` = `estimateDaysToGoalWeight(tdee, maintenanceFloor, |anchorStart − goal|kg, cbmiClass, minCal)` from the **anchor** weight.
- `totalWeeks` = `max(weekIndex, ceil(totalDaysFromCurrent / 7))`, where `totalDaysFromCurrent` is the same estimate run from current weight (so M shrinks as the user progresses but never drops below the current week).
- `curve` = for each week `k = 1..totalWeeks`, compute planned weight at end of week `k` by walking the schedule from `anchorStartKg`, then
  `progressPct(k) = clamp01((anchorStartKg − plannedWeight(k)) / (anchorStartKg − goal)) * 100`.
  Monotonic 0→100. If `totalWeeks` is large, the UI samples a window (see §6).

### 4.6 Returns `null`
- Profile incomplete (caller already guards this) — function may also return `null` when goal is not strictly on the deficit/surplus side and class is not healthy; the maintain state is represented with `direction: "maintain"` and an empty/flat curve rather than `null`.

## 5. Data flow

1. `app/api/patient/caloric-profile/route.ts`
   - Add `goalWeight`, `goalWeightUnit`, `mealPlanWeight`, `mealPlanStartDate` to the patient `select`/`include` (some already fetched implicitly via the full record — verify and add what's missing).
   - After `computeAllMetrics`, call `computeWeeklyTarget({ profile, anchorStartKg, planStartDate })`.
   - Return `{ profile: { ...profile, weeklyTarget } }`.
2. `types/index.ts`
   - Add optional `weeklyTarget?: WeeklyTargetDTO` to `CaloricProfileDTO` (numbers in kg; client converts to lbs via `kgToLbs`, matching the rest of the card).
3. No other endpoints change.

## 6. UI — Rising Momentum panel

Replaces the BMI gauge block (`CaloricProfileCard.tsx`, the `cp-a flex-1 min-w-[180px]` block). Calorie ring is untouched.

**Layout (top to bottom), ~180px wide, height matched to the calorie ring:**
- Eyebrow label: `THIS WEEK'S TARGET` (existing uppercase tracking style).
- Hero: `212.1` + `lbs` (wine `#812549`), with a small delta chip `▼ 2.1 / wk` (loss) or `▲ 2.1 / wk` (gain).
- **Rising momentum curve** (inline SVG, ~180×56):
  - Y = progress %, X = week. Smooth (Catmull-Rom / monotone) filled area, wine gradient fill at ~15–20% opacity, `#B75E78` stroke.
  - Goal flag glyph (SVG, not emoji) at the top-right terminus.
  - Pulsing "now" dot at `(weekIndex, progressPct)`.
  - If `totalWeeks > ~8`, sample a window of ~7 weeks centered on `now` so dots/curve stay legible.
- Footer line: `▲ 68% there · week 3 of 17` + the small `cbmiClass` word (e.g. `Overweight`) in muted tone.

**Motion (UX guidance):**
- Curve path draws in once on mount with ease-out, ≤300ms (`stroke-dashoffset` or area clip-reveal — use transform/opacity-friendly technique, avoid animating width/height).
- "Now" dot: gentle pulse (subtle scale/opacity), 1–2 elements max.
- All motion gated behind `prefers-reduced-motion: reduce` → render final state, no animation.

**Styling:** stay within the card's existing tokens — wine `#812549` / `#B75E78`, cream `#F5F1DD` borders, white surface, no new heavy shadows. SVG icons only (no emoji as structural icons).

**Accessibility:**
- Panel has an `aria-label` summarizing the insight: e.g. "This week's target 212 lbs, 68% toward your goal, week 3 of 17."
- Color is not the only signal — numbers and the `▲/▼` glyph + text carry meaning.
- Contrast ≥4.5:1 for text, ≥3:1 for the curve stroke vs background.

## 7. Edge cases

| Case | Behavior |
|---|---|
| No `mealPlanStartDate` or no goal beyond current | Quiet prompt: "Set your plan to see weekly targets." `weekIndex` falls back to 1, anchor = current weight. |
| Healthy BMI (`direction: "maintain"`) | Show "Maintain — you're at a healthy weight" with maintenance calories; flat/empty curve, no moving target. |
| Goal reached or passed (current at/beyond goal) | "Goal reached 🎉 — maintain {goal}." progress = 100%, curve full. |
| `totalWeeks` very large (slow pace) | Sample a ~7-week window around `now`; footer still shows true `week N of M`. |
| `anchorStartKg === goalWeightKg` | Treat as maintain / 100%. |

## 8. Files touched

- `lib/caloric-engine.ts` — add `computeWeeklyTarget` + `WeeklyTarget`/`WeeklyTargetPoint` types.
- `app/api/patient/caloric-profile/route.ts` — fetch plan anchor fields, call the function, attach to response.
- `types/index.ts` — add `WeeklyTargetDTO` and `weeklyTarget?` on `CaloricProfileDTO`.
- `components/dashboard/CaloricProfileCard.tsx` — replace BMI gauge block with the Rising Momentum panel.

## 9. Testing

- Unit tests for `computeWeeklyTarget` (pure): loss / gain / maintain directions; ramp depth at various `planDay`; goal-clamping; `progressPct` monotonic 0→100; no-plan fallback; degenerate anchor==goal.
- Component render: verify the panel shows hero, curve, footer, and the maintain / goal-reached / no-plan states; verify reduced-motion renders the final frame.
- Manual: overview loads, panel matches card styling, numbers reconcile with the `/prediction` page direction.

## 10. Open questions / future

- v2: overlay actual logged weights (from journal `dailyWeights`) against the planned curve to show plan-vs-reality.
- v2: tap panel → deep link to the full `/prediction` page.
