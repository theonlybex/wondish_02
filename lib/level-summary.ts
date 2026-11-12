// Loads a patient's LevelSummary from their MealLog rows. Shared by GET
// /api/numbers and Clara's dish skill so both read the week the same way.
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/local-date";
import { getDayTarget } from "@/lib/meal-log";
import type { FullDay } from "@/lib/numbers-full";
import { summarizeLevels, type LevelDayInput, type LevelSummary } from "@/lib/levels";

/** The `days`-day window ending on `toDate` (the caller's local today). */
export async function loadLevelSummary(patientId: string, toDate: string, days: number): Promise<LevelSummary> {
  const fromDate = addDays(toDate, -(days - 1));

  const rows = await prisma.mealLog.findMany({
    where: { patientId, localDate: { gte: fromDate, lte: toDate }, deletedAt: null },
    select: { localDate: true, servings: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, sodium: true },
  });

  const dayInputs = levelDaysFromRows(rows);

  const dayTarget = await getDayTarget(patientId, toDate, false);
  const targets = dayTarget
    ? { calories: dayTarget.calories, protein: dayTarget.protein, carbs: dayTarget.carbs, fat: dayTarget.fat }
    : null;
  return summarizeLevels(dayInputs, targets, { fromDate, toDate });
}

/**
 * Full-numbers feed: the same window, rows read with `nutrients` too. The
 * default loadLevelSummary above is left alone so GET /api/numbers stays
 * byte-identical without full=1.
 */
export async function loadFullLevelData(patientId: string, toDate: string, days: number) {
  const fromDate = addDays(toDate, -(days - 1));
  const rows = await prisma.mealLog.findMany({
    where: { patientId, localDate: { gte: fromDate, lte: toDate }, deletedAt: null },
    select: { localDate: true, servings: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, sodium: true, nutrients: true },
  });
  return { range: { fromDate, toDate }, days: fullDaysFromRows(rows as MealLevelRow[]) };
}

/** One MealLog row as the week's levels read it (per-serving numbers × servings). */
export interface MealLevelRow {
  localDate: string;
  servings: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sodium: number | null;
  /** Per-serving extras beyond the columns, { saturatedFat, addedSugar, ... }. */
  nutrients?: unknown;
}

/**
 * Groups a window's rows into days. A day's sodium is known only when EVERY
 * meal that day carries it: sodium is a new column, and adding just the rows
 * that have it would read a three-meal day as one dish's sodium ("within
 * limit" for nearly everyone). summarizeLevels averages over known days only.
 */
export function levelDaysFromRows(rows: MealLevelRow[]): LevelDayInput[] {
  const byDate = new Map<string, LevelDayInput & { sodiumComplete: boolean }>();
  for (const r of rows) {
    let d = byDate.get(r.localDate);
    if (!d) {
      d = { localDate: r.localDate, meals: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sodium: 0, sodiumComplete: true };
      byDate.set(r.localDate, d);
    }
    const s = r.servings;
    d.meals += 1;
    d.calories += (r.calories ?? 0) * s;
    d.protein += (r.protein ?? 0) * s;
    d.carbs += (r.carbs ?? 0) * s;
    d.fat += (r.fat ?? 0) * s;
    d.fibre += (r.fiber ?? 0) * s;
    if (r.sodium == null) d.sodiumComplete = false;
    else d.sodium = (d.sodium ?? 0) + r.sodium * s;
  }
  return Array.from(byDate.values()).map(({ sodiumComplete, ...d }) => ({ ...d, sodium: sodiumComplete ? d.sodium : null }));
}

const numberIn = (json: unknown, key: string): number | null => {
  if (!json || typeof json !== "object") return null;
  const v = (json as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * Days for the full Numbers feed. Day sodium, saturated fat and added sugar
 * count only when EVERY meal that day carries the value (same rule as above).
 */
export function fullDaysFromRows(rows: MealLevelRow[]): FullDay[] {
  const base = levelDaysFromRows(rows);
  const byDate = new Map<string, MealLevelRow[]>();
  for (const r of rows) byDate.set(r.localDate, [...(byDate.get(r.localDate) ?? []), r]);
  const sumKnown = (meals: MealLevelRow[], key: string): number | null => {
    let total = 0;
    for (const m of meals) {
      const v = numberIn(m.nutrients, key);
      if (v === null) return null;
      total += v * m.servings;
    }
    return total;
  };
  return base.map((d) => {
    const meals = byDate.get(d.localDate) ?? [];
    return {
      localDate: d.localDate,
      meals: d.meals,
      calories: d.calories,
      protein: d.protein,
      carbs: d.carbs,
      fibre: d.fibre,
      sodium: d.sodium,
      saturatedFat: sumKnown(meals, "saturatedFat"),
      addedSugar: sumKnown(meals, "addedSugar"),
    };
  });
}
