# Weekly Target — Rising Momentum Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the BMI gauge in the overview's Caloric Profile card with a "This Week's Target" panel that shows a per-week weight target and an upward, motivational progress curve.

**Architecture:** A new pure function `computeWeeklyTarget()` in the caloric engine derives the weekly target (recompute-from-current "end of this week") plus a planned progress glide path (anchored to the plan's start weight/date). The caloric-profile API attaches the result to its response; `CaloricProfileCard` renders a Rising Momentum panel in place of the BMI gauge.

**Tech Stack:** TypeScript, Next.js (App Router), Prisma, React client component, inline SVG. Tests use Node's built-in `node:test` runner executed via `tsx` (already installed) — no new dependencies.

## Global Constraints

- No new npm dependencies. Tests run via `node --import tsx --test`.
- No Prisma schema migration. `mealPlanWeight` (lbs) and `mealPlanStartDate` already exist and are already returned by the caloric-profile route's patient fetch.
- All engine values are in **kg**; the client converts to lbs for display via `kgToLbs` from `lib/prediction-data`.
- Weekly schedule math MUST reuse existing helpers (`gradualDailyCals`, `gradualDailyDeficit`); do not duplicate the deficit ramp.
- Maintenance floor = `profile.tdeeUTBW ?? profile.tdeeWTBW`, consistent with `computePredictionEstimate`.
- Single constant `KCAL_PER_KG = 7700` (matches existing engine usage of `7700`).
- Wine `#812549` / `#B75E78`, cream `#F5F1DD` borders, white surface. SVG icons only — no emoji as structural icons. All motion gated behind `prefers-reduced-motion`.
- Directions supported: `lose` (overweight/obese), `gain` (underweight), `maintain` (healthy).

---

## File Structure

- `lib/caloric-engine.ts` — **modify**: add `WeeklyTargetPoint`, `WeeklyTarget` types and `computeWeeklyTarget()` plus two file-local helpers. Pure, no DB.
- `lib/caloric-engine.test.ts` — **create**: unit tests for `computeWeeklyTarget()`.
- `package.json` — **modify**: add a `test` script.
- `types/index.ts` — **modify**: add `WeeklyTargetPointDTO`, `WeeklyTargetDTO`, and `weeklyTarget?` on `CaloricProfileDTO`.
- `app/api/patient/caloric-profile/route.ts` — **modify**: compute and attach `weeklyTarget`.
- `components/dashboard/CaloricProfileCard.tsx` — **modify**: replace the BMI gauge block with a `WeeklyTargetPanel` sub-component (Task 3 scaffold, Task 4 curve).

---

### Task 1: Engine — `computeWeeklyTarget()` + tests

**Files:**
- Modify: `lib/caloric-engine.ts` (append after `estimateDaysToGoalWeight`, before the Macro Profiles section)
- Create: `lib/caloric-engine.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: existing `gradualDailyCals`, `CaloricProfile`, `CBMIClass` from this file.
- Produces:
  - `interface WeeklyTargetPoint { week: number; progressPct: number }`
  - `interface WeeklyTarget { direction: "lose"|"gain"|"maintain"; hasPlan: boolean; currentWeightKg: number; thisWeekTargetKg: number; weeklyDeltaKg: number; goalWeightKg: number; anchorStartKg: number; progressPct: number; weekIndex: number; totalWeeks: number; curve: WeeklyTargetPoint[]; cbmiClass: CBMIClass }`
  - `function computeWeeklyTarget(args: { profile: CaloricProfile; anchorStartKg: number | null; planStartDate: Date | null; now?: Date }): WeeklyTarget`

- [ ] **Step 1: Add the `test` script to `package.json`**

In `package.json`, add to `"scripts"` (after `"lint"`):

```json
"test": "node --import tsx --test lib/caloric-engine.test.ts",
```

- [ ] **Step 2: Write the failing test**

Create `lib/caloric-engine.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAllMetrics, computeWeeklyTarget } from "./caloric-engine";

const birthday = new Date("1994-01-01"); // ~age 32 at test time

function overweightProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 160, heightUnit: "cm",
    cbwValue: 70, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 60, utbwUnit: "kg",
  });
}

function underweightProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 170, heightUnit: "cm",
    cbwValue: 45, cbwUnit: "kg",
    activityLevel: 2,
  });
}

function healthyProfile() {
  return computeAllMetrics({
    sex: "female", birthday,
    heightValue: 165, heightUnit: "cm",
    cbwValue: 60, cbwUnit: "kg",
    activityLevel: 2,
  });
}

const now = new Date("2026-06-30");
const twoWeeksAgo = new Date("2026-06-16"); // planDay = 14 -> weekIndex 3

test("lose: target is below current, delta negative, week index from plan start", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 70, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "lose");
  assert.equal(wt.weekIndex, 3);
  assert.ok(wt.thisWeekTargetKg < wt.currentWeightKg, "target should be below current");
  assert.ok(wt.weeklyDeltaKg < 0, "delta should be negative for loss");
  assert.ok(wt.thisWeekTargetKg >= wt.goalWeightKg, "target never below goal");
});

test("lose: progress curve is monotonic non-decreasing and bounded 0..100", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 70, planStartDate: twoWeeksAgo, now });
  assert.ok(wt.curve.length >= 1);
  for (const pt of wt.curve) {
    assert.ok(pt.progressPct >= 0 && pt.progressPct <= 100);
  }
  for (let i = 1; i < wt.curve.length; i++) {
    assert.ok(wt.curve[i].progressPct >= wt.curve[i - 1].progressPct - 1e-6, "curve must rise");
  }
  assert.ok(wt.totalWeeks >= wt.weekIndex);
});

test("gain: underweight projects upward toward goal", () => {
  const p = underweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 45, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "gain");
  assert.ok(wt.thisWeekTargetKg > wt.currentWeightKg, "target should be above current");
  assert.ok(wt.weeklyDeltaKg > 0, "delta should be positive for gain");
  assert.ok(wt.thisWeekTargetKg <= wt.goalWeightKg, "target never above goal");
});

test("maintain: healthy BMI has no weekly change", () => {
  const p = healthyProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: 60, planStartDate: twoWeeksAgo, now });
  assert.equal(wt.direction, "maintain");
  assert.equal(wt.weeklyDeltaKg, 0);
});

test("no plan: falls back to current as anchor, weekIndex 1, hasPlan false", () => {
  const p = overweightProfile();
  const wt = computeWeeklyTarget({ profile: p, anchorStartKg: null, planStartDate: null, now });
  assert.equal(wt.hasPlan, false);
  assert.equal(wt.weekIndex, 1);
  assert.equal(wt.anchorStartKg, wt.currentWeightKg);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `computeWeeklyTarget` is not exported / not a function.

- [ ] **Step 4: Implement `computeWeeklyTarget()`**

In `lib/caloric-engine.ts`, append after `estimateDaysToGoalWeight` (around line 563), before `// ─── Macro Profiles`:

```ts
// ─── Weekly Target Projection ─────────────────────────────────────────────────
// Per-week weight target derived from the gradual deficit/surplus schedule.
// The hero "this week" target is recomputed from current weight (adapts to real
// progress); the progress curve is the planned glide path anchored to the plan's
// start weight + date. Pure — safe to import on the client.

const KCAL_PER_KG = 7700;

export interface WeeklyTargetPoint {
  week: number;        // 1-based week index from plan start
  progressPct: number; // 0–100 planned progress toward goal at end of that week
}

export interface WeeklyTarget {
  direction: "lose" | "gain" | "maintain";
  hasPlan: boolean;
  currentWeightKg: number;
  thisWeekTargetKg: number;   // end-of-this-week projection, clamped at goal
  weeklyDeltaKg: number;      // signed: <0 losing, >0 gaining, 0 maintain
  goalWeightKg: number;
  anchorStartKg: number;      // mealPlanWeight (or current weight when no plan)
  progressPct: number;        // achieved progress now (anchor → current), 0–100
  weekIndex: number;          // current week number from plan start (>=1)
  totalWeeks: number;         // re-estimated from current weight (>= weekIndex)
  curve: WeeklyTargetPoint[]; // planned glide path, rising 0→100
  cbmiClass: CBMIClass;
}

// Clamp a projected weight so it never overshoots the goal (either direction).
function clampTowardGoal(w: number, startKg: number, goalKg: number): number {
  if (startKg > goalKg) return Math.min(Math.max(w, goalKg), startKg); // losing
  if (startKg < goalKg) return Math.max(Math.min(w, goalKg), startKg); // gaining
  return goalKg;
}

// Cumulative kcal deficit (>0) or surplus (<0) over plan days [fromDay+1 .. fromDay+days].
function cumulativeDeficitKcal(
  tdee: number, fromDay: number, days: number,
  cbmiClass: CBMIClass, minCal: number, maintenanceFloor: number,
): number {
  let total = 0;
  for (let i = 1; i <= days; i++) {
    const intake = gradualDailyCals(tdee, fromDay + i, cbmiClass, minCal, maintenanceFloor);
    total += tdee - intake;
  }
  return total;
}

// Days for `startKg` to reach `goalKg`, walking the schedule from ramp day `fromDay+1`.
function daysToGoalWalk(
  startKg: number, goalKg: number, tdee: number, fromDay: number,
  cbmiClass: CBMIClass, minCal: number, maintenanceFloor: number,
): number {
  const neededKcal = Math.abs(startKg - goalKg) * KCAL_PER_KG;
  let total = 0;
  for (let d = 1; d <= 3650; d++) {
    const intake = gradualDailyCals(tdee, fromDay + d, cbmiClass, minCal, maintenanceFloor);
    const dayDelta = Math.abs(tdee - intake);
    if (dayDelta <= 0) return 3650;
    total += dayDelta;
    if (total >= neededKcal) return d;
  }
  return 3650;
}

export function computeWeeklyTarget(args: {
  profile: CaloricProfile;
  anchorStartKg: number | null;
  planStartDate: Date | null;
  now?: Date;
}): WeeklyTarget {
  const { profile } = args;
  const now = args.now ?? new Date();
  const goalKg = profile.tbwKg;
  const currentKg = profile.cbwKg;
  const cbmiClass = profile.cbmiClass;
  const minCal = profile.minCaloriesValue;
  const tdee = profile.tdeeCBW;
  const maintenanceFloor = profile.tdeeUTBW ?? profile.tdeeWTBW;
  const hasPlan = args.planStartDate != null;
  const anchorStartKg = args.anchorStartKg ?? currentKg;

  const planDay = args.planStartDate
    ? Math.max(0, Math.floor((now.getTime() - args.planStartDate.getTime()) / 86400000))
    : 0;
  const weekIndex = Math.floor(planDay / 7) + 1;

  const direction: WeeklyTarget["direction"] =
    cbmiClass === "overweight" || cbmiClass === "obese" ? "lose"
    : cbmiClass === "underweight" ? "gain"
    : "maintain";

  const span = anchorStartKg - goalKg;
  const progressPct = span === 0 ? 100
    : Math.min(100, Math.max(0, ((anchorStartKg - currentKg) / span) * 100));

  const reachedGoal =
    (direction === "lose" && currentKg <= goalKg) ||
    (direction === "gain" && currentKg >= goalKg);

  if (direction === "maintain" || reachedGoal) {
    return {
      direction,
      hasPlan,
      currentWeightKg: currentKg,
      thisWeekTargetKg: direction === "maintain" ? currentKg : goalKg,
      weeklyDeltaKg: 0,
      goalWeightKg: goalKg,
      anchorStartKg,
      progressPct: reachedGoal ? 100 : progressPct,
      weekIndex,
      totalWeeks: weekIndex,
      curve: [{ week: weekIndex, progressPct: reachedGoal ? 100 : progressPct }],
      cbmiClass,
    };
  }

  // Hero: end-of-this-week projection from current weight at the true ramp position.
  const weekKcal = cumulativeDeficitKcal(tdee, planDay, 7, cbmiClass, minCal, maintenanceFloor);
  const weeklyDeltaKg = -weekKcal / KCAL_PER_KG; // <0 losing, >0 gaining
  const thisWeekTargetKg = clampTowardGoal(currentKg + weeklyDeltaKg, currentKg, goalKg);

  // Adaptive horizon from current weight.
  const daysRemaining = daysToGoalWalk(currentKg, goalKg, tdee, planDay, cbmiClass, minCal, maintenanceFloor);
  const totalWeeks = Math.max(weekIndex, (weekIndex - 1) + Math.ceil(daysRemaining / 7));

  // Planned glide path from the anchor: progress% at the end of each week.
  const anchorSpan = anchorStartKg - goalKg;
  const curve: WeeklyTargetPoint[] = [];
  for (let k = 1; k <= totalWeeks; k++) {
    const cumKcal = cumulativeDeficitKcal(tdee, 0, 7 * k, cbmiClass, minCal, maintenanceFloor);
    const plannedKg = clampTowardGoal(anchorStartKg - cumKcal / KCAL_PER_KG, anchorStartKg, goalKg);
    const pct = anchorSpan === 0 ? 100
      : Math.min(100, Math.max(0, ((anchorStartKg - plannedKg) / anchorSpan) * 100));
    curve.push({ week: k, progressPct: pct });
  }

  return {
    direction, hasPlan,
    currentWeightKg: currentKg,
    thisWeekTargetKg, weeklyDeltaKg,
    goalWeightKg: goalKg, anchorStartKg,
    progressPct, weekIndex, totalWeeks, curve, cbmiClass,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/caloric-engine.ts lib/caloric-engine.test.ts package.json
git commit -m "feat(engine): add computeWeeklyTarget weekly projection"
```

---

### Task 2: Wire types + caloric-profile API

**Files:**
- Modify: `types/index.ts:174-218` (`CaloricProfileDTO`)
- Modify: `app/api/patient/caloric-profile/route.ts`

**Interfaces:**
- Consumes: `computeWeeklyTarget`, `WeeklyTarget` from Task 1; `convertWeight` from `lib/caloric-engine`.
- Produces: `profile.weeklyTarget` on the caloric-profile response, typed `WeeklyTargetDTO`.

- [ ] **Step 1: Add DTO types**

In `types/index.ts`, immediately before `export interface CaloricProfileDTO {` (line 174), add:

```ts
export interface WeeklyTargetPointDTO {
  week: number;
  progressPct: number;
}

export interface WeeklyTargetDTO {
  direction: "lose" | "gain" | "maintain";
  hasPlan: boolean;
  currentWeightKg: number;
  thisWeekTargetKg: number;
  weeklyDeltaKg: number;
  goalWeightKg: number;
  anchorStartKg: number;
  progressPct: number;
  weekIndex: number;
  totalWeeks: number;
  curve: WeeklyTargetPointDTO[];
  cbmiClass: CBMIClassType;
}
```

- [ ] **Step 2: Reference it on `CaloricProfileDTO`**

In `types/index.ts`, inside `CaloricProfileDTO`, change the trailing block (lines 215-217) from:

```ts
  // Target calories
  dailyCalories: number;
  minCaloriesValue: number;
}
```

to:

```ts
  // Target calories
  dailyCalories: number;
  minCaloriesValue: number;

  // Weekly target projection (attached by the caloric-profile route)
  weeklyTarget?: WeeklyTargetDTO;
}
```

- [ ] **Step 3: Compute and attach `weeklyTarget` in the route**

In `app/api/patient/caloric-profile/route.ts`, update the import on line 4 from:

```ts
import { computeAllMetrics, type Sex, type CaloricProfileInput } from "@/lib/caloric-engine";
```

to:

```ts
import {
  computeAllMetrics, computeWeeklyTarget, convertWeight,
  type Sex, type CaloricProfileInput,
} from "@/lib/caloric-engine";
```

Then change the final block (lines 62-64) from:

```ts
  const profile = computeAllMetrics(input);

  return NextResponse.json({ profile });
```

to:

```ts
  const profile = computeAllMetrics(input);

  // mealPlanWeight is stored in lbs (see Patient schema); convert to kg.
  const anchorStartKg =
    patient.mealPlanWeight != null ? convertWeight(patient.mealPlanWeight, "lbs").kg : null;

  const weeklyTarget = computeWeeklyTarget({
    profile,
    anchorStartKg,
    planStartDate: patient.mealPlanStartDate ?? null,
  });

  return NextResponse.json({ profile: { ...profile, weeklyTarget } });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors. (`patient.mealPlanWeight` and `patient.mealPlanStartDate` are present because the route fetches the full patient record.)

- [ ] **Step 5: Commit**

```bash
git add types/index.ts app/api/patient/caloric-profile/route.ts
git commit -m "feat(api): attach weeklyTarget to caloric-profile response"
```

---

### Task 3: Panel scaffold — replace BMI gauge with text states

**Files:**
- Modify: `components/dashboard/CaloricProfileCard.tsx`

**Interfaces:**
- Consumes: `profile.weeklyTarget` (`WeeklyTargetDTO`) from Task 2; `kgToLbs` (already imported).
- Produces: a `WeeklyTargetPanel` sub-component rendering hero number, delta chip, footer (`week N of M · BMI class`), and the maintain / goal-reached / no-plan states. Curve area is a reserved empty box (filled in Task 4).

- [ ] **Step 1: Replace the BMI gauge block**

In `components/dashboard/CaloricProfileCard.tsx`, replace the entire BMI gauge block (the `<div className="cp-a flex-1 min-w-[180px]" ...>` … `</div>` spanning lines 162-187) with:

```tsx
        {/* This Week's Target */}
        <WeeklyTargetPanel weeklyTarget={profile.weeklyTarget} cbmiClass={profile.cbmiClass} />
```

- [ ] **Step 2: Add the `WeeklyTargetPanel` sub-component**

At the bottom of `components/dashboard/CaloricProfileCard.tsx` (after the `MetricTile` component), add:

```tsx
// ─── Weekly Target Panel ─────────────────────────────────────────────────────

import type { WeeklyTargetDTO } from "@/types";

function WeeklyTargetPanel({
  weeklyTarget,
  cbmiClass,
}: {
  weeklyTarget?: WeeklyTargetDTO;
  cbmiClass: string;
}) {
  const wrap = "cp-a flex-1 min-w-[180px]";
  const eyebrow = "text-xs text-[#848181] mb-1.5 uppercase tracking-wider";

  if (!weeklyTarget || !weeklyTarget.hasPlan) {
    return (
      <div className={wrap} style={{ animationDelay: "120ms" }}>
        <p className={eyebrow}>This Week&apos;s Target</p>
        <p className="text-sm text-[#848181] mt-2 leading-relaxed">
          Set your plan start date to see your weekly targets.
        </p>
      </div>
    );
  }

  const { direction, thisWeekTargetKg, weeklyDeltaKg, goalWeightKg, progressPct, weekIndex, totalWeeks } =
    weeklyTarget;

  if (direction === "maintain") {
    return (
      <div className={wrap} style={{ animationDelay: "120ms" }}>
        <p className={eyebrow}>This Week&apos;s Target</p>
        <p className="text-2xl font-bold text-[#00B9A6] mt-1">Maintain</p>
        <p className="text-sm text-[#848181] mt-1">You&apos;re at a healthy weight.</p>
        <p className="text-[10px] text-[#ABA6A6] mt-2 capitalize">{cbmiClass}</p>
      </div>
    );
  }

  const reached = progressPct >= 100;
  const targetLbs = kgToLbs(thisWeekTargetKg);
  const deltaLbs = Math.abs(kgToLbs(weeklyDeltaKg));
  const arrow = direction === "gain" ? "▲" : "▼";

  return (
    <div className={wrap} style={{ animationDelay: "120ms" }}>
      <p className={eyebrow}>This Week&apos;s Target</p>

      {reached ? (
        <>
          <p className="text-2xl font-bold text-[#812549] mt-1">Goal reached</p>
          <p className="text-sm text-[#848181] mt-1">
            Maintain {kgToLbs(goalWeightKg).toFixed(1)} lbs
          </p>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-[#812549]">{targetLbs.toFixed(1)}</span>
            <span className="text-xs font-medium text-[#CCC6C6]">lbs</span>
            <span className="text-[11px] font-semibold text-[#B75E78]">
              {arrow} {deltaLbs.toFixed(1)}/wk
            </span>
          </div>

          {/* Curve area — filled in Task 4 */}
          <div className="mt-2 h-[56px]" data-testid="weekly-curve-slot" />

          <p className="text-[11px] text-[#848181] mt-1">
            <span className="font-semibold text-[#1E1A1A]">▲ {Math.round(progressPct)}% there</span>
            {" · "}week {weekIndex} of {totalWeeks}
            <span className="text-[#ABA6A6] capitalize"> · {cbmiClass}</span>
          </p>
        </>
      )}
    </div>
  );
}
```

Note: move the `import type { WeeklyTargetDTO } from "@/types";` line up to the existing import group at the top of the file (next to the `CaloricProfileDTO` import on line 4) rather than mid-file, to satisfy lint.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/overview`.
Expected: The Caloric Profile card's right column now shows "This Week's Target" with a hero lbs number, a `▼ x.x/wk` chip, an empty reserved curve area, and a `▲ NN% there · week N of M · <class>` footer. For a healthy profile it shows "Maintain". With no plan it shows the prompt.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/CaloricProfileCard.tsx
git commit -m "feat(overview): replace BMI gauge with weekly target panel scaffold"
```

---

### Task 4: Rising Momentum SVG curve + motion

**Files:**
- Modify: `components/dashboard/CaloricProfileCard.tsx`

**Interfaces:**
- Consumes: `weeklyTarget.curve` (`WeeklyTargetPointDTO[]`), `weekIndex`, `totalWeeks` from Task 3's panel.
- Produces: a `MomentumCurve` sub-component rendered inside the curve slot.

- [ ] **Step 1: Add the `MomentumCurve` sub-component**

At the bottom of `components/dashboard/CaloricProfileCard.tsx`, add:

```tsx
// ─── Momentum Curve (rising progress %) ──────────────────────────────────────

function MomentumCurve({
  curve,
  weekIndex,
}: {
  curve: { week: number; progressPct: number }[];
  weekIndex: number;
}) {
  const W = 180;
  const H = 56;
  const PAD = 6;

  // Window to ~7 weeks centered on "now" so dots stay legible.
  let pts = curve;
  if (curve.length > 8) {
    const start = Math.max(0, Math.min(weekIndex - 4, curve.length - 7));
    pts = curve.slice(start, start + 7);
  }
  if (pts.length === 0) return null;

  const minWk = pts[0].week;
  const maxWk = pts[pts.length - 1].week;
  const xFor = (week: number) =>
    maxWk === minWk ? PAD : PAD + ((week - minWk) / (maxWk - minWk)) * (W - 2 * PAD);
  const yFor = (pct: number) => H - PAD - (pct / 100) * (H - 2 * PAD);

  const xy = pts.map((p) => ({ x: xFor(p.week), y: yFor(p.progressPct), week: p.week }));

  // Smooth path via Catmull-Rom → cubic bezier.
  const line = (() => {
    if (xy.length === 1) return `M ${xy[0].x} ${xy[0].y}`;
    let d = `M ${xy[0].x} ${xy[0].y}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[i - 1] ?? xy[i];
      const p1 = xy[i];
      const p2 = xy[i + 1];
      const p3 = xy[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  })();

  const area = `${line} L ${xy[xy.length - 1].x} ${H - PAD} L ${xy[0].x} ${H - PAD} Z`;
  const last = xy[xy.length - 1];
  const nowPt = xy.find((p) => p.week === weekIndex) ?? last;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} aria-hidden="true">
      <defs>
        <linearGradient id="momentumFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B75E78" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#B75E78" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill="url(#momentumFill)" />
      <path
        d={line}
        fill="none"
        stroke="#B75E78"
        strokeWidth="2"
        strokeLinecap="round"
        className="mc-draw"
        pathLength={1}
      />

      {/* Goal flag at the top-right terminus */}
      <g transform={`translate(${last.x}, ${last.y})`}>
        <line x1="0" y1="0" x2="0" y2="-9" stroke="#812549" strokeWidth="1.5" />
        <path d="M0 -9 L6 -7 L0 -5 Z" fill="#812549" />
      </g>

      {/* Pulsing "now" dot */}
      <circle cx={nowPt.x} cy={nowPt.y} r="3.5" fill="#812549" className="mc-pulse" />
    </svg>
  );
}
```

- [ ] **Step 2: Render the curve inside the slot**

In `WeeklyTargetPanel`, replace the curve slot:

```tsx
          {/* Curve area — filled in Task 4 */}
          <div className="mt-2 h-[56px]" data-testid="weekly-curve-slot" />
```

with:

```tsx
          <div className="mt-2">
            <MomentumCurve curve={weeklyTarget.curve} weekIndex={weekIndex} />
          </div>
```

- [ ] **Step 3: Add the draw-in + pulse animation (reduced-motion safe)**

In the `<style>` block inside `CaloricProfileCard` (the one defining `cp-rise` / `cp-ring`, around lines 109-120), add these keyframes/classes before the closing backtick:

```css
        @keyframes mc-draw-kf {
          from { stroke-dashoffset: 1; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes mc-pulse-kf {
          0%, 100% { opacity: 1; transform: scale(1); transform-origin: center; }
          50%      { opacity: 0.5; transform: scale(1.45); transform-origin: center; }
        }
        .mc-draw { stroke-dasharray: 1; stroke-dashoffset: 0; animation: mc-draw-kf 0.6s ease-out both 0.2s; }
        .mc-pulse { animation: mc-pulse-kf 2.4s ease-in-out infinite; transform-box: fill-box; }
        @media (prefers-reduced-motion: reduce) {
          .mc-draw, .mc-pulse { animation: none; }
        }
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS — no type errors; production build succeeds.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/overview`.
Expected: The panel shows a rising filled curve sweeping upward toward a small goal flag, a pulsing wine dot at the current week, and the hero/footer from Task 3. With OS "reduce motion" enabled, the curve renders in its final state with no animation. Confirm the BMI gauge is gone and layout next to the calorie ring is intact at narrow widths.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/CaloricProfileCard.tsx
git commit -m "feat(overview): add rising momentum curve to weekly target panel"
```

---

## Self-Review

**Spec coverage:**
- §4 engine `computeWeeklyTarget` (lose/gain/maintain, ramp depth, clamping, progress %, curve, no-plan) → Task 1. ✅
- §5 data flow (route + DTO, no migration) → Task 2. ✅
- §6 UI panel (hero, delta chip, footer, BMI word, rising curve, goal flag, now dot, motion, reduced-motion) → Tasks 3 & 4. ✅
- §7 edge cases (no-plan, maintain, goal-reached, windowing) → Task 3 states + Task 4 windowing. ✅
- §9 tests → Task 1 unit tests; component verified via typecheck + manual (no RTL/jsdom in repo, keeping scope minimal per Global Constraints). ✅

**Placeholder scan:** No TBD/TODO; every code step contains full code and exact commands. ✅

**Type consistency:** `WeeklyTarget`/`WeeklyTargetPoint` (engine, Task 1) mirror `WeeklyTargetDTO`/`WeeklyTargetPointDTO` (types, Task 2) field-for-field; `weeklyTarget?` consumed in Tasks 3–4 matches. `computeWeeklyTarget` and `convertWeight` signatures used in Task 2 match Task 1 / existing engine. `kgToLbs` already imported in the card. ✅

**Note on v1 scope:** the curve plots the planned glide path only (no actual logged-weight overlay), per the approved spec.
