// Steers a dish by the nutrient levels the Numbers tab shows: what the person got
// little of this week is favoured, what they got a lot of is kept low, and what
// today's logged meals already gave paces the next dish. Pure: no database, no
// model client.
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import type { FullLevelRow } from "@/lib/numbers-full";
import { FIBRE_RICH_EXAMPLES, SODIUM_REASON_MAX_MG } from "@/lib/dish-reasons";
import { computeMealCalories } from "@/lib/caloric-engine";
import type { MealType } from "@/lib/local-date";
import { foodMatches } from "./kept-foods";

export type SteerRow = Pick<FullLevelRow, "key" | "name" | "direction" | "target" | "amount" | "word">;
export interface PictureLevels { little: readonly string[]; aLot: readonly string[] }
/** Today's logged totals. A null field is not known for every meal today. */
export interface TodayTotals {
  meals: number; calories: number; protein: number; carbs: number;
  fibre: number | null; sodium: number | null; saturatedFat: number | null; addedSugar: number | null;
}
export interface LevelSteer {
  key: FullLevelKey; name: string; direction: "more" | "less"; why: "week" | "today" | "answers"; score: number;
}

export const MAX_STEERED_LEVELS = 4;

const DEF = new Map(LEVELS.map((l) => [l.key as string, l]));
const ORDER = new Map(LEVELS.map((l, i) => [l.key as string, i]));

// Share of the day's calories eaten before this meal. The context has no clock;
// the meal asked for stands for the time of day.
function shareBefore(mealType: MealType): number {
  const m = computeMealCalories(1);
  if (mealType === "lunch") return m.breakfast;
  if (mealType === "dinner") return m.breakfast + m.lunch;
  return 0;
}

export function steerLevels(a: {
  mealType: MealType;
  claims: PictureLevels & { source: "week" | "answers" };
  week: readonly SteerRow[];
  picture: PictureLevels | null;
  today: TodayTotals | null;
  sodiumLimitMg: number;
}): LevelSteer[] {
  const best = new Map<string, LevelSteer>();
  const add = (key: string, direction: "more" | "less", why: LevelSteer["why"], score: number) => {
    const def = DEF.get(key);
    if (!def) return;
    const cur = best.get(key);
    if (cur && (cur.score > score || (cur.score === score && cur.direction === "less"))) return;
    best.set(key, { key: def.key, name: def.name.toLowerCase(), direction, why, score });
  };
  const weekRow = new Map(a.week.map((r) => [r.key as string, r]));
  const targetOf = (key: string) => {
    const r = weekRow.get(key);
    return r && r.target > 0 ? r.target : DEF.get(key)!.target;
  };

  if (a.today) {
    const t = a.today;
    const limits: [string, number | null, number][] = [
      ["sodium", t.sodium, a.sodiumLimitMg],
      ["saturatedFat", t.saturatedFat, targetOf("saturatedFat")],
      ["addedSugar", t.addedSugar, targetOf("addedSugar")],
    ];
    for (const [key, amount, limit] of limits) {
      if (amount !== null && limit > 0 && amount >= 0.8 * limit) add(key, "less", "today", 2 + amount / limit);
    }
    const before = shareBefore(a.mealType);
    if (t.meals >= 1 && before > 0) {
      for (const [key, amount] of [["protein", t.protein], ["fibre", t.fibre]] as [string, number | null][]) {
        if (amount === null) continue;
        const expected = targetOf(key) * before;
        if (amount < 0.5 * expected) add(key, "more", "today", 1.5 + (1 - amount / expected));
      }
    }
  }

  const measured = new Set<string>();
  for (const r of a.week) {
    if (!r.word) continue;
    measured.add(r.key);
    if (r.amount === null || !(r.target > 0)) continue;
    if (r.word === "little") add(r.key, "more", "week", 1 + (1 - r.amount / r.target));
    else if (r.word === "a lot" || r.word === "more than needed") add(r.key, "less", "week", 1 + Math.min(1, r.amount / r.target - 1));
  }

  const claimed = new Set<string>([...a.claims.little, ...a.claims.aLot]);
  for (const k of a.claims.little) if (!measured.has(k)) add(k, "more", a.claims.source, 1);
  for (const k of a.claims.aLot) if (!measured.has(k)) add(k, "less", a.claims.source, 1);
  if (a.picture) {
    for (const k of a.picture.little) if (!measured.has(k) && !claimed.has(k)) add(k, "more", "answers", 0.5);
    for (const k of a.picture.aLot) if (!measured.has(k) && !claimed.has(k)) add(k, "less", "answers", 0.5);
  }

  return [...best.values()]
    .sort((x, y) => y.score - x.score || ORDER.get(x.key)! - ORDER.get(y.key)!)
    .slice(0, MAX_STEERED_LEVELS);
}

/** The most a serving may carry, per level. Sodium always; every other level that has an upper limit in LEVELS. */
export function levelCeilings(a: { mealType: MealType; sodiumLimitMg: number; today: TodayTotals | null }): Partial<Record<FullLevelKey, number>> {
  const out: Partial<Record<FullLevelKey, number>> = {};
  const share = computeMealCalories(1)[a.mealType] ?? 0;
  out.sodium = a.today && a.today.sodium !== null
    ? Math.max(a.sodiumLimitMg - a.today.sodium, a.sodiumLimitMg * share)
    : a.sodiumLimitMg;
  for (const l of LEVELS) if (l.upperLimit !== null) out[l.key] = l.upperLimit;
  return out;
}

// Placeholder for clinician review, like the LEVELS targets.
export const RICH_FOODS: Readonly<Record<FullLevelKey, string>> = {
  protein: "meat, fish, eggs, tofu, beans, Greek yogurt",
  carbs: "rice, pasta, bread, potatoes",
  fibre: FIBRE_RICH_EXAMPLES,
  addedSugar: "sugar, honey, syrups, sweetened sauces",
  saturatedFat: "butter, cream, cheese, fatty meat, coconut milk",
  sodium: "salt, soy sauce, stock, cured meats, salted cheese",
  omega3: "salmon, sardines, mackerel, walnuts, chia or flax seeds",
  potassium: "potatoes, sweet potatoes, beans, lentils, spinach, bananas, avocado",
  calcium: "yogurt, milk, cheese, tofu, sardines, kale",
  iron: "lentils, beans, chickpeas, spinach, beef, tofu",
  magnesium: "pumpkin seeds, almonds, spinach, black beans, oats",
  zinc: "beef, chickpeas, lentils, pumpkin seeds, cashews",
  iodine: "white fish, shrimp, eggs, milk, yogurt",
  vitaminA: "sweet potatoes, carrots, spinach, kale, eggs",
  vitaminB6: "chickpeas, salmon, chicken, potatoes, bananas",
  vitaminB12: "fish, beef, eggs, milk, yogurt",
  vitaminC: "bell peppers, broccoli, citrus, tomatoes, kale",
  vitaminD: "salmon, sardines, eggs, mushrooms",
  vitaminE: "almonds, sunflower seeds, avocado, spinach",
  vitaminK: "kale, spinach, broccoli, cabbage",
  folate: "lentils, chickpeas, spinach, asparagus, broccoli",
  phosphorus: "processed meats, processed cheese, cola",
};

const SODIUM_FOODS_OUT = "no soy sauce, stock cubes, bouillon, cured meats, salted cheese or pickles";

/** How the "eat more of it" lines read for a person with foods marked at home. Absent: today's wording, unchanged. */
export interface SteerLineOptions {
  /** Every food they have at home. When an example is one of them, only those are named, and the line says so. */
  atHome?: readonly string[];
  /** false drops that example (a meat or fish the dish may not use). */
  keepExample?: (food: string) => boolean;
  /** The dish already has its base (a chosen protein, or an at-home breakfast or snack): fibre is added to it, not built on. */
  fibreAdded?: boolean;
}

// The examples for an "eat more" line: the allowed ones; of those, the ones at home when any are.
function moreExamples(list: string, o: SteerLineOptions): { text: string; preferring: boolean } {
  const all = list.split(", ").filter((f) => o.keepExample?.(f) ?? true);
  const home = o.atHome ?? [];
  const atHome = all.filter((f) => home.some((h) => foodMatches(f, h)));
  // "Preferring any they have at home" only when one of the examples is.
  return { text: (atHome.length > 0 ? atHome : all).join(", "), preferring: atHome.length > 0 };
}

export function steerLines(levels: readonly LevelSteer[], opts: SteerLineOptions = {}): string[] {
  const examples = (list: string) => {
    const { text, preferring } = moreExamples(list, opts);
    if (text.length === 0) return "";
    return preferring ? `, preferring any they have at home (${text})` : ` (${text})`;
  };
  return levels.map((l) => {
    const answers = l.why === "answers";
    if (l.key === "fibre" && l.direction === "more" && l.why !== "today") {
      return `- ${answers ? "From their answers they probably get little fibre" : "They have had little fibre this week"}: ${opts.fibreAdded ? "include a fibre-rich ingredient in every dish" : "build every dish around a fibre-rich ingredient"}${examples(FIBRE_RICH_EXAMPLES)}.`;
    }
    if (l.key === "sodium" && l.direction === "less") {
      if (l.why === "today") {
        return `- Today's meals have already used most of the day's sodium: keep this serving at or under ${SODIUM_REASON_MAX_MG} mg of sodium — ${SODIUM_FOODS_OUT}, and no added salt.`;
      }
      return `- ${answers ? "From their answers they probably get a lot of sodium" : "They have had a lot of sodium this week"}: keep every serving at or under ${SODIUM_REASON_MAX_MG} mg of sodium — ${SODIUM_FOODS_OUT}, and little or no added salt.`;
    }
    const little = l.direction === "more";
    const opening =
      l.why === "week" ? `They have had ${little ? "little" : "a lot of"} ${l.name} this week`
      : answers ? `From their answers they probably get ${little ? "little" : "a lot of"} ${l.name}`
      : little ? `So far today they are well behind on ${l.name}`
      : `Today's meals have already used most of the day's ${l.name}`;
    return little
      ? `- ${opening}: build the dish on foods rich in it${examples(RICH_FOODS[l.key])}.`
      : `- ${opening}: keep it low in this dish; go easy on ${RICH_FOODS[l.key]}.`;
  });
}
