// The full Numbers screen: 21 levels (22 with phosphorus for kidney conditions),
// the tracked set, saved goals, and pills that count. Pure: callers load the
// days, targets and rows. The older six-level summary in lib/levels.ts is
// untouched and still feeds GET /api/numbers without full=1.
import {
  AREAS,
  LEVELS,
  defaultTracked,
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
  fibre: number;
  /** Null unless every meal that day carries the value. */
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
  tracked: boolean;
  goal: number | null;
}

export interface FullNumbers {
  summary: { fromDate: string; toDate: string; daysCounted: number; enoughLogs: boolean };
  source: "logged" | "answers" | "none";
  calories: { amount: number | null; target: number | null };
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
  macroTargets: { calories: number; protein: number; carbs: number } | null;
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

/** 1 decimal; micrograms under 1 keep 2 so small doses do not vanish. */
export function roundAmount(n: number, unit: LevelUnit): number {
  const places = unit === "mcg" && Math.abs(n) < 1 ? 100 : 10;
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
  const { days, range, macroTargets, person } = input;
  const counted = days.filter((d) => d.meals >= 1);
  const daysCounted = counted.length;
  const enoughLogs = days.filter((d) => d.meals >= ENOUGH_MEALS_PER_DAY).length >= ENOUGH_LOG_DAYS;

  const pills = input.pills.map((p) => ({ contents: parsePillContents(p.contents), estimated: p.estimated }));
  const tracked = new Set(trackedKeys(input.trackedRows, input.conditionNames));
  const goals = new Map(input.trackedRows.map((r) => [r.levelKey, r.goal]));
  const withPhosphorus = showsPhosphorus(input.conditionNames);

  type Food = { values: (number | null)[] };
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
    const word = foodCounted && enoughLogs && amount !== null ? wordFor(def, amount, target) : null;

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
      tracked: tracked.has(def.key),
      goal: goals.get(def.key) ?? null,
    };
  });

  const named = (keys: FullLevelKey[]) =>
    keys.filter((k) => LEVEL_BY_KEY.has(k)).map((k) => ({ key: k, name: LEVEL_BY_KEY.get(k)!.name }));
  const source: FullNumbers["source"] = enoughLogs ? "logged" : input.picture ? "answers" : "none";
  const calAvg = mean(counted.map((d) => d.calories));

  return {
    summary: { fromDate: range.fromDate, toDate: range.toDate, daysCounted, enoughLogs },
    source,
    calories: { amount: calAvg === null ? null : Math.round(calAvg), target: macroTargets?.calories ?? null },
    weight: input.weight,
    levels,
    areas: AREAS.map((a) => ({ key: a.key, name: a.name, uses: [...a.uses] })),
    startingPicture:
      source === "answers" && input.picture
        ? { little: named(input.picture.little), aLot: named(input.picture.aLot) }
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
