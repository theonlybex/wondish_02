import { JourneyStats, MacroDay, MacroStats } from "@/types";
import { sumMealLogs, r1 } from "@/lib/macros";

export type { MacroDay, MacroStats } from "@/types";

interface JournalMealRaw {
  skipped: boolean;
  preparation?: string | null;
}

interface JournalEntryRaw {
  date: Date | string;
  mood?: string | null;
  energyLevel?: string | null;
  weight?: number | null;
  meals: JournalMealRaw[];
}

// totalDays = number of days in the requested window. Without it, engagement
// falls back to entries.length — which silently ignores days with no journal
// entry at all (2 engaged entries in a 30-day window would read as 100%).
export function computeJourneyStats(entries: JournalEntryRaw[], totalDays?: number): JourneyStats {
  if (entries.length === 0) {
    return {
      avgMood: 0,
      avgEnergy: 0,
      avgWeight: null,
      engagementPercent: 0,
      mealSourceBreakdown: { cooked: 0, skipped: 0, readyToEat: 0, restaurant: 0 },
      dailyMoods: [],
      dailyWeights: [],
    };
  }

  const moods = entries.map((e) => parseFloat(e.mood ?? "0")).filter((n) => n > 0);
  const energies = entries.map((e) => parseFloat(e.energyLevel ?? "0")).filter((n) => n > 0);
  const weights = entries.filter((e) => e.weight).map((e) => e.weight!);

  const allMeals = entries.flatMap((e) => e.meals);
  const isSkipped = (m: (typeof allMeals)[number]) => m.skipped || m.preparation === "skipped";
  const activeMeals = allMeals.filter((m) => !isSkipped(m));
  const mealSourceBreakdown = {
    cooked: activeMeals.filter((m) => m.preparation === "cooked").length,
    skipped: allMeals.filter(isSkipped).length,
    readyToEat: activeMeals.filter((m) => m.preparation === "ready-to-eat").length,
    restaurant: activeMeals.filter((m) => m.preparation === "restaurant").length,
  };

  const engaged = entries.filter((e) => e.meals.some((m) => !isSkipped(m))).length;

  const fmt = (d: Date | string) => {
    // A date-only ISO string is already the answer; parsing it would shift it a day
    // west of UTC (new Date("YYYY-MM-DD") is midnight UTC read back in local time).
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const dt = typeof d === "string" ? new Date(d) : d;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };

  return {
    avgMood: moods.length ? +(moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1) : 0,
    avgEnergy: energies.length
      ? +(energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(1)
      : 0,
    avgWeight: weights.length
      ? +(weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(1)
      : null,
    engagementPercent: Math.round((engaged / Math.max(totalDays ?? entries.length, entries.length, 1)) * 100),
    mealSourceBreakdown,
    dailyMoods: entries
      .map((e) => ({ date: e.date, mood: parseFloat(e.mood ?? "") }))
      .filter(({ mood }) => Number.isFinite(mood) && mood > 0)
      .map(({ date, mood }) => ({ date: fmt(date), mood })),
    dailyWeights: entries
      .filter((e) => e.weight)
      .map((e) => ({ date: fmt(e.date), weight: e.weight! })),
  };
}

// ─── computeMacroStats — pure sibling, ADDITIVE (computeJourneyStats above is
// pinned by tests and untouched) ─────────────────────────────────────────────
//
// Stats read ONLY stored MealLog snapshots — one source of truth, never
// recomputed from recipes. Groups by the `localDate` string (no Date
// hydration → no off-by-one), scales+sums via sumMealLogs (r1 once at each
// day-total boundary), and QUARANTINES all-incomplete days: a day whose every
// row is `incomplete` (macros summed as 0 because nothing was priceable)
// still appears in `dailyMacros` flagged, but is excluded from the averages
// and from `daysOnTarget` — otherwise a fully-unpriceable day reads as a
// 0-kcal day and drags the mean while looking "wildly under target". Days
// with SOME complete rows count normally (their incomplete rows contribute
// their known-0 values, flagged on the day). `daysOnTarget` is ratio-based
// (|calories/target − 1| ≤ 0.10) — never a float equality (audit T4).

export interface MacroLogRowRaw {
  localDate: string;
  servings: number;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  incomplete?: boolean;
  deletedAt?: Date | string | null;
}

export function computeMacroStats(
  logs: MacroLogRowRaw[],
  target: MacroStats["target"]
): MacroStats {
  const byDay = new Map<string, MacroLogRowRaw[]>();
  for (const row of logs) {
    if (row.deletedAt != null) continue; // tombstones never aggregate
    const bucket = byDay.get(row.localDate);
    if (bucket) bucket.push(row);
    else byDay.set(row.localDate, [row]);
  }

  const dailyMacros: MacroDay[] = [];
  let sumCalories = 0;
  let sumProtein = 0;
  let sumCarbs = 0;
  let sumFat = 0;
  let daysComplete = 0;
  let daysIncomplete = 0;
  let daysOnTarget = 0;

  const days = Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [date, rows] of days) {
    const totals = sumMealLogs(rows); // servings-scaled, r1 at the day boundary
    dailyMacros.push({
      date,
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      incomplete: totals.incomplete, // any row incomplete → day flagged
    });

    const allIncomplete = rows.every((r) => r.incomplete === true);
    if (allIncomplete) {
      daysIncomplete += 1; // quarantined: visible, never averaged
      continue;
    }
    daysComplete += 1;
    sumCalories += totals.calories;
    sumProtein += totals.protein;
    sumCarbs += totals.carbs;
    sumFat += totals.fat;
    if (target && target.calories > 0 && Math.abs(totals.calories / target.calories - 1) <= 0.1) {
      daysOnTarget += 1;
    }
  }

  const denom = Math.max(1, daysComplete);
  return {
    dailyMacros,
    avgCalories: r1(sumCalories / denom),
    avgProtein: r1(sumProtein / denom),
    avgCarbs: r1(sumCarbs / denom),
    avgFat: r1(sumFat / denom),
    daysLogged: byDay.size,
    daysComplete,
    daysIncomplete,
    daysOnTarget,
    target,
  };
}
