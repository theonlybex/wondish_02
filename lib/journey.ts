import { JourneyStats } from "@/types";

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
