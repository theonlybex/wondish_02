// Turns a week of logged meals into "levels" with words. Pure: callers load
// the days and targets. Slice 1 has six levels; only fibre and sodium get words.

import { loggedShare } from "@/lib/level-catalogue";

export type LevelKey = "calories" | "protein" | "carbs" | "fat" | "fibre" | "sodium";
export type LevelWord = "little" | "on track" | "within limit" | "a lot";
export interface LevelRow {
  key: LevelKey;
  name: string;
  direction: "enough" | "under" | "match";
  amount: number | null;
  target: number | null;
  unit: "kcal" | "g" | "mg";
  word: LevelWord | null;
}
export interface LevelDayInput {
  localDate: string;
  meals: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Null unless every meal that day carries a fibre figure (as sodium). */
  fibre: number | null;
  sodium: number | null;
}
export interface LevelSummary {
  fromDate: string;
  toDate: string;
  daysCounted: number;
  enoughLogs: boolean;
  levels: LevelRow[];
  little: LevelKey[];
  aLot: LevelKey[];
}

export const FIBRE_TARGET_G = 28;
export const SODIUM_LIMIT_MG = 2300;

const LITTLE_BELOW = 0.7;
const ENOUGH_LOG_DAYS = 3;
const ENOUGH_MEALS_PER_DAY = 2;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function summarizeLevels(
  days: LevelDayInput[],
  targets: { calories: number; protein: number; carbs: number; fat: number } | null,
  range: { fromDate: string; toDate: string },
  /** Clara's reading: a whole-day need is judged against the part of the day that was logged, as the full Numbers screen does. Off by default so GET /api/numbers without full=1 is unchanged. */
  opts: { byLoggedShare?: boolean } = {},
): LevelSummary {
  const counted = days.filter((d) => d.meals >= 1);
  const enoughLogs = days.filter((d) => d.meals >= ENOUGH_MEALS_PER_DAY).length >= ENOUGH_LOG_DAYS;

  const avg = (pick: (d: LevelDayInput) => number) => mean(counted.map(pick));
  const sodiumAvg = mean(
    counted.map((d) => d.sodium).filter((v): v is number => v !== null),
  );
  // Fibre follows the sodium rule: only days whose fibre is fully known are
  // averaged. A meal with no fibre figure is unknown, not 0 g.
  const fibreAvg = mean(
    counted.map((d) => d.fibre).filter((v): v is number => v !== null),
  );

  // Judged against the part of the day that was logged, as the Numbers screen does (loggedShare).
  const share = opts.byLoggedShare ? loggedShare(avg((d) => d.calories), targets?.calories) : 1;
  const fibreWord: LevelWord | null =
    fibreAvg === null ? null : fibreAvg < FIBRE_TARGET_G * share * LITTLE_BELOW ? "little" : "on track";
  const sodiumWord: LevelWord | null =
    sodiumAvg === null ? null : sodiumAvg > SODIUM_LIMIT_MG ? "a lot" : "within limit";

  const levels: LevelRow[] = [
    { key: "calories", name: "Calories", direction: "match", amount: avg((d) => d.calories), target: targets?.calories ?? null, unit: "kcal", word: null },
    { key: "protein", name: "Protein", direction: "match", amount: avg((d) => d.protein), target: targets?.protein ?? null, unit: "g", word: null },
    { key: "carbs", name: "Carbs", direction: "match", amount: avg((d) => d.carbs), target: targets?.carbs ?? null, unit: "g", word: null },
    { key: "fat", name: "Fat", direction: "match", amount: avg((d) => d.fat), target: targets?.fat ?? null, unit: "g", word: null },
    { key: "fibre", name: "Fibre", direction: "enough", amount: fibreAvg, target: FIBRE_TARGET_G, unit: "g", word: fibreWord },
    { key: "sodium", name: "Sodium", direction: "under", amount: sodiumAvg, target: SODIUM_LIMIT_MG, unit: "mg", word: sodiumWord },
  ];

  return {
    fromDate: range.fromDate,
    toDate: range.toDate,
    daysCounted: counted.length,
    enoughLogs,
    levels,
    little: levels.filter((l) => l.word === "little").map((l) => l.key),
    aLot: levels.filter((l) => l.word === "a lot").map((l) => l.key),
  };
}

/**
 * The summary as Clara may speak from it: the "little / a lot" lists only when
 * the Numbers screen (full=1) would give the same word — enough logs, and the
 * level known on EVERY counted day (fibre and sodium). Levels, amounts and
 * targets are untouched; only the claim lists shrink. Without enough logs there
 * is no claim at all.
 */
export function claimsAsNumbersSays(summary: LevelSummary, days: LevelDayInput[]): LevelSummary {
  if (!summary.enoughLogs) return { ...summary, little: [], aLot: [] };
  const counted = days.filter((d) => d.meals >= 1);
  const known = (k: "fibre" | "sodium") => counted.length > 0 && counted.every((d) => d[k] !== null);
  const keep = (k: LevelKey) => (k === "fibre" || k === "sodium" ? known(k) : true);
  return { ...summary, little: summary.little.filter(keep), aLot: summary.aLot.filter(keep) };
}
