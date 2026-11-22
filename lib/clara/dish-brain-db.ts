// The brain reads: what the dish brain needs beyond the patient and the marks.
// Five reads, started together; each one that fails gives its empty value, so a
// dish is served without that steer rather than not at all.
import { prisma } from "@/lib/db";
import { loadFullLevelData } from "@/lib/level-summary";
import { getDayTarget } from "@/lib/meal-log";
import { NO_BRAIN_ROWS, type BrainRows } from "./dish-brain";

function soft<T>(what: string, work: () => Promise<T>, fallback: T): Promise<T> {
  let p: Promise<T>;
  try {
    p = work();
  } catch (err) {
    p = Promise.reject(err);
  }
  return p.catch((err) => {
    console.warn(`[clara-dish] ${what} failed to load: ${(err as Error)?.message ?? String(err)}`);
    return fallback;
  });
}

/** Five reads in one Promise.all. Each that fails resolves to its NO_BRAIN_ROWS value and logs one `[clara-dish] <what> failed to load: <message>` warning. Never rejects. */
export async function loadBrainRows(patientId: string, today: string): Promise<BrainRows> {
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const [week, dayTarget, pills, dishes, liked] = await Promise.all([
    soft("week levels", () => loadFullLevelData(patientId, today, 7), NO_BRAIN_ROWS.week),
    soft("day target", () => getDayTarget(patientId, today, false), NO_BRAIN_ROWS.dayTarget),
    soft(
      "pills",
      () => prisma.supplement.findMany({ where: { patientId, deletedAt: null }, select: { name: true, contents: true, estimated: true } }),
      NO_BRAIN_ROWS.pills,
    ),
    soft(
      "today's dishes",
      // One read for today and the six days before it: today's names keep the protein open, the
      // earlier ones keep the week varied.
      async () => {
        const rows = await prisma.mealLog.findMany({
          where: { patientId, localDate: { gte: from.toISOString().slice(0, 10), lte: today }, deletedAt: null },
          select: { name: true, localDate: true },
          orderBy: { createdAt: "asc" },
        });
        return {
          today: rows.filter((r) => r.localDate === today).map((r) => r.name),
          recent: rows.filter((r) => r.localDate !== today).map((r) => r.name),
        };
      },
      { today: [] as string[], recent: [] as string[] },
    ),
    soft(
      "liked foods",
      async () =>
        (
          await prisma.patientIngredientPreference.findMany({
            where: { patientId, liked: true },
            select: { ingredient: { select: { name: true, allergenGroups: true } } },
          })
        ).map((r) => ({ name: r.ingredient.name, allergenGroups: r.ingredient.allergenGroups })),
      [] as BrainRows["liked"],
    ),
  ]);
  return { week, dayTarget, pills, todayDishes: dishes.today, recentDishes: dishes.recent, liked };
}
