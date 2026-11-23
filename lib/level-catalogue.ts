// The full list of nutrient "levels" shown on the Numbers screen, with
// targets, directions, words and the tables that hang off them.
// Pure data and functions. The older six-level model in lib/levels.ts is
// untouched; the types here are named FullLevelKey / FullLevelWord to avoid a clash.
//
// Targets are the mockup's reference values. Upper limits are NIH adult
// tolerable upper intake levels. Placeholder for clinician review.

export type FullLevelKey =
  | "protein" | "carbs" | "fibre" | "addedSugar" | "saturatedFat" | "sodium"
  | "omega3" | "potassium" | "calcium" | "iron" | "magnesium" | "zinc" | "iodine"
  | "vitaminA" | "vitaminB6" | "vitaminB12" | "vitaminC" | "vitaminD" | "vitaminE"
  | "vitaminK" | "folate" | "phosphorus";

export type FullLevelWord = "little" | "on track" | "within limit" | "a lot" | "more than needed";
export type LevelUnit = "g" | "mg" | "mcg";
export type LevelDirection = "enough" | "under" | "match";

export interface LevelDef {
  key: FullLevelKey;
  name: string;
  group: "food" | "minerals" | "vitamins";
  unit: LevelUnit;
  direction: LevelDirection;
  target: number;
  upperLimit: number | null;
  kidneyOnly?: true;
}

export const LEVELS: readonly LevelDef[] = [
  { key: "protein", name: "Protein", group: "food", unit: "g", direction: "enough", target: 50, upperLimit: null },
  { key: "carbs", name: "Carbohydrate", group: "food", unit: "g", direction: "match", target: 275, upperLimit: null },
  { key: "fibre", name: "Fibre", group: "food", unit: "g", direction: "enough", target: 28, upperLimit: null },
  { key: "addedSugar", name: "Added sugar", group: "food", unit: "g", direction: "under", target: 50, upperLimit: null },
  { key: "saturatedFat", name: "Saturated fat", group: "food", unit: "g", direction: "under", target: 20, upperLimit: null },
  { key: "sodium", name: "Sodium", group: "food", unit: "mg", direction: "under", target: 2300, upperLimit: null },
  { key: "omega3", name: "Omega-3", group: "food", unit: "mg", direction: "enough", target: 250, upperLimit: null },
  { key: "potassium", name: "Potassium", group: "minerals", unit: "mg", direction: "enough", target: 4700, upperLimit: null },
  { key: "calcium", name: "Calcium", group: "minerals", unit: "mg", direction: "enough", target: 1300, upperLimit: 2500 },
  { key: "iron", name: "Iron", group: "minerals", unit: "mg", direction: "enough", target: 18, upperLimit: 45 },
  { key: "magnesium", name: "Magnesium", group: "minerals", unit: "mg", direction: "enough", target: 420, upperLimit: null },
  { key: "zinc", name: "Zinc", group: "minerals", unit: "mg", direction: "enough", target: 11, upperLimit: 40 },
  { key: "iodine", name: "Iodine", group: "minerals", unit: "mcg", direction: "enough", target: 150, upperLimit: 1100 },
  { key: "vitaminA", name: "Vitamin A", group: "vitamins", unit: "mcg", direction: "enough", target: 900, upperLimit: 3000 },
  { key: "vitaminB6", name: "Vitamin B6", group: "vitamins", unit: "mg", direction: "enough", target: 1.7, upperLimit: 100 },
  { key: "vitaminB12", name: "Vitamin B12", group: "vitamins", unit: "mcg", direction: "enough", target: 2.4, upperLimit: null },
  { key: "vitaminC", name: "Vitamin C", group: "vitamins", unit: "mg", direction: "enough", target: 90, upperLimit: 2000 },
  { key: "vitaminD", name: "Vitamin D", group: "vitamins", unit: "mcg", direction: "enough", target: 20, upperLimit: 100 },
  { key: "vitaminE", name: "Vitamin E", group: "vitamins", unit: "mg", direction: "enough", target: 15, upperLimit: 1000 },
  { key: "vitaminK", name: "Vitamin K", group: "vitamins", unit: "mcg", direction: "enough", target: 120, upperLimit: null },
  { key: "folate", name: "Folate", group: "vitamins", unit: "mcg", direction: "enough", target: 400, upperLimit: 1000 },
  { key: "phosphorus", name: "Phosphorus", group: "minerals", unit: "mg", direction: "under", target: 1250, upperLimit: null, kidneyOnly: true },
];

/**
 * How much of a day the logs cover, by calories: 1 when the logged days average the calorie target
 * or more, never under a quarter (a dinner alone is 30% of a day; a floor of a half told someone
 * who logs only Clara's dinners they get little protein, review 2026-11-22). A need for the whole day ("enough protein") is compared with this
 * share of its target, so someone who logs lunch and dinner is not told "little protein" for the
 * breakfast and snack they did not log (owner, 2026-11-22: "if user protein goal is satisfied with
 * dishes from clara then it should say enough of protein in numbers"). 1 with no calorie target.
 */
export const MIN_LOGGED_SHARE = 0.25;
/**
 * `avgMeals` (meals logged a day) tells logging part of the day from eating little: three meals a
 * day is the whole day however few the calories (someone who logs three meals and 500 kcal is
 * eating little, not logging little), two meals is at least half a day, one at least a quarter.
 */
export function loggedShare(avgCalories: number | null, calorieTarget: number | null | undefined, avgMeals?: number | null): number {
  if (avgCalories === null || !calorieTarget || !(calorieTarget > 0) || !(avgCalories > 0)) return 1;
  if (typeof avgMeals === "number" && avgMeals >= 3) return 1;
  const floor = typeof avgMeals === "number" && avgMeals >= 2 ? 0.5 : MIN_LOGGED_SHARE;
  return Math.min(1, Math.max(floor, avgCalories / calorieTarget));
}
/** The levels that are a need of the whole day counted from logged food: these are compared with the logged share. */
export const DAY_NEED_KEYS: ReadonlySet<FullLevelKey> = new Set<FullLevelKey>(["protein", "carbs", "fibre"]);

export function targetFor(
  def: LevelDef,
  person: { sexAtBirth: "MALE" | "FEMALE" | null; age: number | null },
): number {
  if (def.key === "iron") {
    if (person.sexAtBirth === "MALE") return 8;
    if (person.sexAtBirth === "FEMALE" && person.age != null && person.age > 50) return 8;
  }
  return def.target;
}

export function wordFor(def: LevelDef, amount: number, target: number): FullLevelWord | null {
  if (!(target > 0) || !Number.isFinite(amount)) return null;
  const pct = amount / target;
  if (def.direction === "under") return pct <= 1 ? "within limit" : "a lot";
  if (def.direction === "match") {
    if (pct < 0.7) return "little";
    return pct <= 1.3 ? "on track" : "a lot";
  }
  if (pct < 0.7) return "little";
  if (def.upperLimit != null && amount > def.upperLimit) return "more than needed";
  return "on track";
}

export const AREAS: readonly { key: string; name: string; uses: FullLevelKey[] }[] = [
  { key: "energy", name: "Energy", uses: ["iron", "vitaminB12", "folate", "magnesium", "vitaminC", "iodine"] },
  { key: "mood", name: "Mood", uses: ["magnesium", "vitaminB12", "folate", "vitaminC"] },
  { key: "muscles", name: "Muscles", uses: ["protein", "magnesium", "potassium", "calcium", "vitaminD"] },
  { key: "heart", name: "Heart", uses: ["sodium", "saturatedFat", "potassium", "omega3", "fibre"] },
  { key: "bloodSugar", name: "Blood sugar", uses: ["carbs", "fibre", "addedSugar"] },
  { key: "digestion", name: "Digestion", uses: ["fibre"] },
];

const DEFAULT_TRACKED: FullLevelKey[] = ["protein", "fibre", "addedSugar", "sodium", "iron", "vitaminD"];

// Research doc docs/research/nutrient-levels-2026-11-11.md. Calories are not a
// level here, so "calories" entries in the doc are dropped.
const CONDITION_ROWS: { match: RegExp; keys: FullLevelKey[] }[] = [
  { match: /blood pressure|hypertension/, keys: ["sodium", "potassium", "fibre", "saturatedFat"] },
  { match: /diabet/, keys: ["carbs", "fibre", "addedSugar", "saturatedFat"] },
  { match: /cholesterol|heart/, keys: ["saturatedFat", "fibre", "omega3", "sodium"] },
  { match: /kidney/, keys: ["sodium", "potassium", "phosphorus", "protein"] },
  { match: /pcos|polycystic|fatty liver/, keys: ["addedSugar", "fibre", "saturatedFat"] },
  { match: /celiac|coeliac/, keys: ["iron", "folate", "vitaminB12", "calcium", "vitaminD"] },
  { match: /pregnan/, keys: ["folate", "iron", "iodine", "calcium"] },
];

export function defaultTracked(conditionNames: string[]): FullLevelKey[] {
  const hit = new Set<FullLevelKey>();
  for (const raw of conditionNames) {
    const name = raw.toLowerCase();
    for (const row of CONDITION_ROWS) if (row.match.test(name)) row.keys.forEach((k) => hit.add(k));
  }
  if (hit.size === 0) return [...DEFAULT_TRACKED];
  return LEVELS.map((l) => l.key).filter((k) => hit.has(k));
}

export type PillName =
  | "Vitamin D" | "Vitamin B12" | "Multivitamin" | "Omega-3" | "Magnesium" | "Iron" | "Calcium";

export interface PillContent { key: FullLevelKey; amount: number; unit: LevelUnit }

const multiOf = (key: FullLevelKey): PillContent => {
  const d = LEVELS.find((l) => l.key === key)!;
  return { key, amount: d.target, unit: d.unit };
};

// Typical doses. Always shown to people as "An estimate".
export const TYPICAL_PILLS: Record<PillName, PillContent[]> = {
  "Vitamin D": [{ key: "vitaminD", amount: 25, unit: "mcg" }],
  "Vitamin B12": [{ key: "vitaminB12", amount: 250, unit: "mcg" }],
  "Omega-3": [{ key: "omega3", amount: 300, unit: "mg" }],
  Magnesium: [{ key: "magnesium", amount: 250, unit: "mg" }],
  Iron: [{ key: "iron", amount: 18, unit: "mg" }],
  Calcium: [{ key: "calcium", amount: 500, unit: "mg" }],
  Multivitamin: [
    ...(["vitaminA", "vitaminB6", "vitaminB12", "vitaminC", "vitaminD", "vitaminE", "vitaminK", "folate"] as FullLevelKey[]).map(multiOf),
    { key: "zinc", amount: 11, unit: "mg" },
    { key: "iodine", amount: 150, unit: "mcg" },
  ],
};
