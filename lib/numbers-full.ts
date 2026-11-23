// The full Numbers screen: 21 levels (22 with phosphorus for kidney conditions),
// the tracked set, saved goals, and pills that count. Pure: callers load the
// days, targets and rows. The older six-level summary in lib/levels.ts is
// untouched and still feeds GET /api/numbers without full=1.
import {
  AREAS,
  DAY_NEED_KEYS,
  LEVELS,
  defaultTracked,
  loggedShare,
  targetFor,
  wordFor,
  type FullLevelKey,
  type FullLevelWord,
  type LevelDef,
  type LevelDirection,
  type LevelUnit,
  type PillContent,
} from "@/lib/level-catalogue";

export interface FullDay {
  localDate: string;
  meals: number;
  calories: number;
  protein: number;
  carbs: number;
  /** Grams of fat; absent in older callers (then the Macros block has no fat figure). */
  fat?: number;
  /** Null unless every meal that day carries the value (fibre, sodium, saturated fat, added sugar). */
  fibre: number | null;
  sodium: number | null;
  saturatedFat: number | null;
  addedSugar: number | null;
}

export interface FullPill {
  contents: PillContent[];
  estimated: boolean;
}

export interface FullWeight {
  value: number;
  unit: "lbs" | "kg";
  change: number | null;
}

export interface FullLevelRow {
  key: FullLevelKey;
  name: string;
  group: LevelDef["group"];
  direction: LevelDirection;
  unit: LevelUnit;
  target: number;
  upperLimit: number | null;
  amount: number | null;
  pillAmount: number;
  foodCounted: boolean;
  estimate: boolean;
  word: FullLevelWord | null;
  /**
   * What the word was judged against when the logs cover only part of the day
   * (target × the logged share); absent when it is the whole target.
   */
  wordTarget?: number;
  tracked: boolean;
  goal: number | null;
}

export interface FullMacroRow {
  key: "protein" | "carbs" | "fat";
  name: string;
  /** Grams a day, averaged over the days with a meal logged; null with none (or no fat figure). */
  average: number | null;
  /** The day's target in grams, from the same macro split the dishes are sized with; null without one. */
  target: number | null;
  /**
   * What the average is fairly compared with when the logs cover only part of the day
   * (target × `loggedShare`); absent when that is the whole target.
   */
  wordTarget?: number;
  /** Grams logged today; null when nothing is logged today. */
  today: number | null;
  /**
   * The average against what it is fairly compared with: "little" under 70%, "a lot" over 130% for
   * carbohydrate and fat (more protein than the target is on track), else "on track". null with
   * fewer than three logged days, no average or no target.
   */
  word: "little" | "on track" | "a lot" | null;
}
export interface FullMacros {
  /** How much of a day the logs cover, by calories: 0.25 to 1 (1 with no calorie target). What the words are judged against. */
  loggedShare: number;
  /** The same before the floor: a single snack in the week is 0.05, not a quarter. For saying how much was logged. */
  loggedShareRaw: number;
  /** The days the averages are over: those with a meal logged. */
  daysCounted: number;
  rows: FullMacroRow[];
}

export interface FullNumbers {
  summary: { fromDate: string; toDate: string; daysCounted: number; enoughLogs: boolean };
  source: "logged" | "answers" | "none";
  calories: { amount: number | null; target: number | null };
  /** The Macros block of the Numbers tab: protein, carbohydrate and fat, eaten against the day's targets. */
  macros: FullMacros;
  weight: FullWeight | null;
  levels: FullLevelRow[];
  areas: { key: string; name: string; uses: FullLevelKey[] }[];
  startingPicture: {
    little: { key: FullLevelKey; name: string }[];
    aLot: { key: FullLevelKey; name: string }[];
  } | null;
}

export interface FullNumbersInput {
  days: FullDay[];
  range: { fromDate: string; toDate: string };
  macroTargets: { calories: number; protein: number; carbs: number; fat?: number } | null;
  person: { sexAtBirth: "MALE" | "FEMALE" | null; age: number | null };
  conditionNames: string[];
  pills: { contents: unknown; estimated: boolean }[];
  trackedRows: { levelKey: string; tracked: boolean; goal: number | null }[];
  picture: { little: FullLevelKey[]; aLot: FullLevelKey[] } | null;
  weight: FullWeight | null;
}

const ENOUGH_LOG_DAYS = 3;
const ENOUGH_MEALS_PER_DAY = 2;
const MAX_GOAL = 100000;

const LEVEL_BY_KEY = new Map<string, LevelDef>(LEVELS.map((l) => [l.key, l]));
const UNIT_PER_MCG: Record<LevelUnit, number> = { mcg: 1, mg: 1000, g: 1_000_000 };

/** Converts an amount between g, mg and mcg. */
export function convertUnit(amount: number, from: LevelUnit, to: LevelUnit): number {
  return (amount * UNIT_PER_MCG[from]) / UNIT_PER_MCG[to];
}

/** 1 decimal; any amount under 1 keeps 2 so small doses do not vanish. */
export function roundAmount(n: number, unit: LevelUnit): number {
  const places = Math.abs(n) < 1 ? 100 : 10;
  return Math.round(n * places) / places;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Age in whole years on a local date, from a YYYY-MM-DD birthday. */
export function ageOn(birthday: string | null, today: string): number | null {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  let age = Number(today.slice(0, 4)) - Number(birthday.slice(0, 4));
  if (today.slice(5) < birthday.slice(5)) age -= 1;
  return age >= 0 ? age : null;
}

/** Reads a Supplement.contents JSON value defensively; bad entries are dropped. */
export function parsePillContents(raw: unknown): PillContent[] {
  if (!Array.isArray(raw)) return [];
  const out: PillContent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { key, amount, unit } = item as Record<string, unknown>;
    if (typeof key !== "string" || !LEVEL_BY_KEY.has(key)) continue;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
    if (unit !== "g" && unit !== "mg" && unit !== "mcg") continue;
    out.push({ key: key as FullLevelKey, amount, unit });
  }
  return out;
}

/** The set the person tracks: their stored rows when they have any, else the condition defaults. */
export function trackedKeys(
  rows: { levelKey: string; tracked: boolean }[],
  conditionNames: string[],
): FullLevelKey[] {
  if (rows.length === 0) return defaultTracked(conditionNames);
  const on = new Set(rows.filter((r) => r.tracked).map((r) => r.levelKey));
  return LEVELS.map((l) => l.key).filter((k) => on.has(k));
}

export function showsPhosphorus(conditionNames: string[]): boolean {
  return conditionNames.some((n) => n.toLowerCase().includes("kidney"));
}

export function buildFullNumbers(input: FullNumbersInput): FullNumbers {
  const { range, macroTargets, person } = input;
  // A figure that is not a real amount counts as nothing, everywhere on the screen (a negative or
  // NaN protein pulled the levels list and the Macros block apart, review 2026-11-22).
  const real = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const realOrNull = (v: number | null) => (v === null ? null : real(v));
  const days: FullDay[] = input.days.map((d) => ({
    ...d, calories: real(d.calories), protein: real(d.protein), carbs: real(d.carbs),
    ...(d.fat !== undefined ? { fat: real(d.fat) } : {}),
    fibre: realOrNull(d.fibre), sodium: realOrNull(d.sodium), saturatedFat: realOrNull(d.saturatedFat), addedSugar: realOrNull(d.addedSugar),
  }));
  const counted = days.filter((d) => d.meals >= 1);
  const daysCounted = counted.length;
  const enoughLogs = days.filter((d) => d.meals >= ENOUGH_MEALS_PER_DAY).length >= ENOUGH_LOG_DAYS;

  const pills = input.pills.map((p) => ({ contents: parsePillContents(p.contents), estimated: p.estimated }));
  const tracked = new Set(trackedKeys(input.trackedRows, input.conditionNames));
  const goals = new Map(input.trackedRows.map((r) => [r.levelKey, r.goal]));
  const withPhosphorus = showsPhosphorus(input.conditionNames);

  // How much of the day the logs cover (lunch and dinner only is about two thirds).
  const share = loggedShare(mean(counted.map((d) => d.calories)), macroTargets?.calories, mean(counted.map((d) => d.meals)));
  const avgCalories = mean(counted.map((d) => d.calories));
  const rawShare = avgCalories !== null && avgCalories > 0 && macroTargets?.calories && macroTargets.calories > 0
    ? Math.round(Math.min(1, avgCalories / macroTargets.calories) * 100) / 100
    : 1;

  type Food = { values: (number | null)[] };
  // Protein and carbs count on every counted day (a missing figure is 0, as in
  // calories). Fibre, sodium, saturated fat and added sugar count only when
  // every counted day knows them (foodCounted below).
  const foodOf: Partial<Record<FullLevelKey, Food>> = {
    protein: { values: counted.map((d) => d.protein) },
    carbs: { values: counted.map((d) => d.carbs) },
    fibre: { values: counted.map((d) => d.fibre) },
    sodium: { values: counted.map((d) => d.sodium) },
    saturatedFat: { values: counted.map((d) => d.saturatedFat) },
    addedSugar: { values: counted.map((d) => d.addedSugar) },
  };

  const levels: FullLevelRow[] = LEVELS.filter((def) => !def.kidneyOnly || withPhosphorus).map((def) => {
    let target = targetFor(def, person);
    if (macroTargets && def.key === "protein") target = macroTargets.protein;
    if (macroTargets && def.key === "carbs") target = macroTargets.carbs;

    let pillAmount = 0;
    let estimate = false;
    for (const pill of pills) {
      for (const c of pill.contents) {
        if (c.key !== def.key) continue;
        pillAmount += convertUnit(c.amount, c.unit, def.unit);
        if (pill.estimated) estimate = true;
      }
    }

    const food = foodOf[def.key];
    const known = food ? food.values.filter((v): v is number => v !== null) : [];
    const foodCounted = !!food && daysCounted > 0 && known.length === daysCounted;
    const foodAvg = foodCounted ? mean(known) : null;

    const total = (foodAvg ?? 0) + pillAmount;
    const amount = foodCounted ? total : pillAmount > 0 ? pillAmount : null;
    // A whole-day need is judged against the part of the day that was logged.
    const prorated = foodCounted && share < 1 && DAY_NEED_KEYS.has(def.key);
    const wordTarget = prorated ? target * share : target;
    const word = foodCounted && enoughLogs && amount !== null ? wordFor(def, amount, wordTarget) : null;

    return {
      key: def.key,
      name: def.name,
      group: def.group,
      direction: def.direction,
      unit: def.unit,
      target,
      upperLimit: def.upperLimit,
      amount: amount === null ? null : roundAmount(amount, def.unit),
      pillAmount: roundAmount(pillAmount, def.unit),
      foodCounted,
      estimate,
      word,
      ...(prorated ? { wordTarget: roundAmount(wordTarget, def.unit) } : {}),
      tracked: tracked.has(def.key),
      goal: goals.get(def.key) ?? null,
    };
  });

  const named = (keys: FullLevelKey[]) =>
    keys.filter((k) => LEVEL_BY_KEY.has(k)).map((k) => ({ key: k, name: LEVEL_BY_KEY.get(k)!.name }));
  // A picture with both lists empty says nothing: it is no picture.
  const picture = input.picture && (input.picture.little.length > 0 || input.picture.aLot.length > 0) ? input.picture : null;
  const source: FullNumbers["source"] = enoughLogs ? "logged" : picture ? "answers" : "none";
  const calAvg = mean(counted.map((d) => d.calories));
  const todayRow = days.find((d) => d.localDate === range.toDate && d.meals >= 1);
  const macroRow = (key: FullMacroRow["key"], name: string, pickDay: (d: FullDay) => number | undefined, target: number | undefined): FullMacroRow => {
    // A figure that is missing or not a real amount is left out; a negative one counts as nothing.
    const grams = (d: FullDay) => { const v = pickDay(d); return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : undefined; };
    const values = counted.map(grams).filter((v): v is number => v !== undefined);
    const average = values.length > 0 ? mean(values) : null;
    const today = todayRow ? grams(todayRow) : undefined;
    const against = target !== undefined && target > 0 ? target * share : null;
    const ratio = average !== null && against !== null ? average / against : null;
    const word: FullMacroRow["word"] = ratio === null || daysCounted < ENOUGH_LOG_DAYS
      ? null
      // "A lot" is of the whole day's target: a fatty dinner alone is not a lot of fat for the day.
      : ratio < 0.7 ? "little" : key !== "protein" && target !== undefined && average !== null && average > target * 1.3 ? "a lot" : "on track";
    return {
      key, name,
      average: average === null ? null : roundAmount(average, "g"),
      target: target !== undefined && target > 0 ? target : null,
      ...(target !== undefined && target > 0 && share < 1 ? { wordTarget: roundAmount(target * share, "g") } : {}),
      today: today === undefined ? null : roundAmount(today, "g"),
      word,
    };
  };
  const macros: FullMacros = {
    loggedShare: Math.round(share * 100) / 100,
    loggedShareRaw: rawShare,
    daysCounted,
    rows: [
      macroRow("protein", "Protein", (d) => d.protein, macroTargets?.protein),
      macroRow("carbs", "Carbohydrate", (d) => d.carbs, macroTargets?.carbs),
      macroRow("fat", "Fat", (d) => d.fat, macroTargets?.fat),
    ],
  };

  return {
    summary: { fromDate: range.fromDate, toDate: range.toDate, daysCounted, enoughLogs },
    source,
    calories: { amount: calAvg === null ? null : Math.round(calAvg), target: macroTargets?.calories ?? null },
    macros,
    weight: input.weight,
    levels,
    areas: AREAS.map((a) => ({ key: a.key, name: a.name, uses: [...a.uses] })),
    startingPicture:
      source === "answers" && picture
        ? { little: named(picture.little), aLot: named(picture.aLot) }
        : null,
  };
}

// ─── Write bodies ────────────────────────────────────────────────────────────

export type Validated<T> = { ok: true; value: T } | { ok: false; status: 400 | 422; error: string; field?: string };

/** Phosphorus exists only for a person with a kidney condition. */
export function isAvailable(key: string, conditionNames: string[]): boolean {
  const def = LEVEL_BY_KEY.get(key);
  return !!def && (!def.kidneyOnly || showsPhosphorus(conditionNames));
}

export function validateTrackedBody(body: unknown, conditionNames: string[] = []): Validated<FullLevelKey[]> {
  const list = (body as { tracked?: unknown } | null)?.tracked;
  if (!Array.isArray(list)) return { ok: false, status: 400, error: "tracked must be a list of level keys", field: "tracked" };
  const keys = new Set<FullLevelKey>();
  for (const k of list) {
    if (typeof k !== "string" || !LEVEL_BY_KEY.has(k) || !isAvailable(k, conditionNames)) {
      return { ok: false, status: 422, error: `Unknown level: ${String(k)}`, field: "tracked" };
    }
    keys.add(k as FullLevelKey);
  }
  return { ok: true, value: LEVELS.map((l) => l.key).filter((k) => keys.has(k)) };
}

export function validateGoalsBody(
  body: unknown,
  ctx: {
    person: { sexAtBirth: "MALE" | "FEMALE" | null; age: number | null };
    macroTargets: { protein: number; carbs: number } | null;
    conditionNames: string[];
  },
): Validated<{ key: FullLevelKey; amount: number | null }[]> {
  const list = (body as { goals?: unknown } | null)?.goals;
  if (!Array.isArray(list)) return { ok: false, status: 400, error: "goals must be a list", field: "goals" };
  const byKey = new Map<FullLevelKey, number | null>();
  for (const item of list) {
    const { key, amount } = (item ?? {}) as { key?: unknown; amount?: unknown };
    if (typeof key !== "string" || !isAvailable(key, ctx.conditionNames)) {
      return { ok: false, status: 422, error: `Unknown level: ${String(key)}`, field: "key" };
    }
    if (amount === null) {
      byKey.set(key as FullLevelKey, null);
      continue;
    }
    const def = LEVEL_BY_KEY.get(key)!;
    const shown =
      ctx.macroTargets && (def.key === "protein" || def.key === "carbs")
        ? ctx.macroTargets[def.key]
        : targetFor(def, ctx.person);
    const max = Math.min(3 * shown, MAX_GOAL);
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > max) {
      return { ok: false, status: 422, error: `${def.name} goal must be more than 0 and at most ${max}`, field: key };
    }
    byKey.set(key as FullLevelKey, amount);
  }
  return { ok: true, value: Array.from(byKey, ([key, amount]) => ({ key, amount })) };
}

/**
 * Rows to write when a goal is saved. A person with no stored rows is on the
 * condition defaults; writing one row would turn that into "tracks only this",
 * so all 22 rows are written with the defaults first.
 */
export function rowsToMaterialize(
  existing: { levelKey: string }[],
  conditionNames: string[],
): { levelKey: FullLevelKey; tracked: boolean }[] {
  if (existing.length > 0) return [];
  const on = new Set(defaultTracked(conditionNames));
  return LEVELS.filter((l) => !l.kidneyOnly || showsPhosphorus(conditionNames)).map((l) => ({ levelKey: l.key, tracked: on.has(l.key) }));
}
