// The diet card (2026-11-20, owner: "share diet button for the personal chefs
// in the house"). What someone who cooks for a person needs to know, in plain
// food words: what never to use, what to leave out, what to go easy on, what
// they like. Built from the same food rules Clara's dishes are checked with
// (lib/food-map.ts), so the chef's page and Clara never disagree.
//
// Health conditions are private by default: the card shows the food rules
// that come from them ("Low salt"), not their names, unless the person
// switched "Show my health conditions" on for the link.
import { CONDITION_GUIDANCE, type FoodMapPatient } from "@/lib/food-map";
import { DAILY_SODIUM_MAX_MG, dailySodiumLimitMg } from "@/lib/sodium-limit";

export interface DietCardGroup {
  /** "Peanuts", "Dairy" */
  name: string;
  /** What that covers in the kitchen: "peanut butter, peanut oil". May be empty. */
  includes: string[];
}

export interface DietCard {
  firstName: string;
  /** "Vegetarian", "Mediterranean": the way they eat. */
  eatingStyle: string[];
  /** Allergies. Never use, not even a trace. */
  never: DietCardGroup[];
  /** Foods they avoid or dislike, and foods left out because of a condition. */
  avoid: string[];
  /** Plain cooking guidance: salt, fat, portions. */
  goEasy: string[];
  likes: string[];
  /** Only when the person chose to show them. */
  conditions?: string[];
  /** Nothing to tell the chef: no rules on file. */
  empty: boolean;
}

export interface DietCardOptions {
  showConditions: boolean;
  /** Ingredient names the person marked as liked. */
  likes?: readonly string[];
}

const clean = (s: string): string => s.trim().replace(/\s+/g, " ");

/** Unique, case-insensitive, in first-seen order, blanks dropped. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = clean(raw);
    const key = n.toLowerCase();
    if (n.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

const sentence = (s: string): string => {
  const t = clean(s).replace(/[.;]+$/, "");
  return t.length === 0 ? "" : `${t[0].toUpperCase()}${t.slice(1)}.`;
};

export function buildDietCard(firstName: string, patient: FoodMapPatient | null | undefined, options: DietCardOptions): DietCard {
  const name = clean(firstName) || "This person";
  if (!patient) return { firstName: name, eatingStyle: [], never: [], avoid: [], goEasy: [], likes: [], empty: true };

  const eatingStyle = uniqueNames([
    ...(patient.mealType ? [patient.mealType.name] : []),
    ...patient.foodPreferences.map((p) => p.food.name),
  ]);

  const never: DietCardGroup[] = [];
  const allergyWords = new Set<string>();
  for (const a of patient.foodAllergies) {
    const group = clean(a.food.name);
    if (group.length === 0 || never.some((g) => g.name.toLowerCase() === group.toLowerCase())) continue;
    const includes = uniqueNames(a.food.bannedIngredients.map((b) => b.name)).filter((n) => n.toLowerCase() !== group.toLowerCase());
    never.push({ name: group, includes });
    allergyWords.add(group.toLowerCase());
    for (const n of includes) allergyWords.add(n.toLowerCase());
  }

  // Everything else that stays out of the dish. An allergy is not repeated here.
  const avoid = uniqueNames([
    ...patient.foodToAvoid.flatMap((f) => [f.food.name, ...(f.food.bannedIngredients ?? []).map((b) => b.name)]),
    ...(patient.ingredientPreferences ?? []).filter((p) => p.liked === false).map((p) => p.ingredient.name),
    ...patient.foodPreferences.flatMap((p) => p.food.bannedIngredients.map((b) => b.name)),
    ...patient.healthConditions.flatMap((c) => c.condition.bannedIngredients.map((b) => b.name)),
  ]).filter((n) => !allergyWords.has(n.toLowerCase()));

  const goEasy: string[] = [];
  const conditionNames = patient.healthConditions.map((c) => c.condition.name);
  const sodium = dailySodiumLimitMg(conditionNames);
  if (sodium < DAILY_SODIUM_MAX_MG) {
    goEasy.push(`Low salt: about ${sodium.toLocaleString("en-US")} mg of sodium a day in all. Season with herbs, citrus and spices; no stock cubes, salty sauces or cured meats.`);
  }
  // A person's own plan note is theirs to share: it is how they asked to be cooked for.
  for (const p of patient.foodPreferences) {
    const note = p.food.guidance?.trim();
    if (note) goEasy.push(sentence(note));
  }
  // Cooking guidance per condition names no condition, but it is specific
  // enough to give one away, so it shows only with the conditions.
  if (options.showConditions) {
    for (const c of patient.healthConditions) {
      const note = c.condition.guidance?.trim() || CONDITION_GUIDANCE[c.condition.name.trim().toLowerCase()];
      if (note) goEasy.push(sentence(note));
    }
  }

  const likes = uniqueNames([...(options.likes ?? [])]).filter((n) => !allergyWords.has(n.toLowerCase()));
  const conditions = options.showConditions ? uniqueNames(conditionNames) : [];
  const card: DietCard = {
    firstName: name,
    eatingStyle,
    never,
    avoid,
    goEasy: uniqueNames(goEasy),
    likes,
    ...(conditions.length > 0 ? { conditions } : {}),
    empty: false,
  };
  card.empty = eatingStyle.length === 0 && never.length === 0 && avoid.length === 0 && card.goEasy.length === 0 && likes.length === 0;
  return card;
}
