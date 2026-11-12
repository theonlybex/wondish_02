// Loads a patient's LevelSummary from their MealLog rows. Shared by GET
// /api/numbers and Clara's dish skill so both read the week the same way.
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/local-date";
import { getDayTarget } from "@/lib/meal-log";
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
