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

  const byDate = new Map<string, LevelDayInput>();
  for (const r of rows) {
    let d = byDate.get(r.localDate);
    if (!d) {
      d = { localDate: r.localDate, meals: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sodium: null };
      byDate.set(r.localDate, d);
    }
    const s = r.servings;
    d.meals += 1;
    d.calories += (r.calories ?? 0) * s;
    d.protein += (r.protein ?? 0) * s;
    d.carbs += (r.carbs ?? 0) * s;
    d.fat += (r.fat ?? 0) * s;
    d.fibre += (r.fiber ?? 0) * s;
    if (r.sodium != null) d.sodium = (d.sodium ?? 0) + r.sodium * s;
  }

  const dayTarget = await getDayTarget(patientId, toDate, false);
  const targets = dayTarget
    ? { calories: dayTarget.calories, protein: dayTarget.protein, carbs: dayTarget.carbs, fat: dayTarget.fat }
    : null;
  return summarizeLevels(Array.from(byDate.values()), targets, { fromDate, toDate });
}
