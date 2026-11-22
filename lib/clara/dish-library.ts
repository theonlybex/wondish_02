// The dish tools' instant safety net: a rule-compliant dish from the public
// recipe LIBRARY, chosen while the model is still generating. It is served
// only when no generated dish survives the gates, or the model call fails or
// runs out of time (lib/clara/skills/dish.ts generateOne).
//
// Safety is never relaxed for it. A library recipe must pass, in order:
//   1. the meal planner's own rule filter (lib/meal-plan.ts buildMealPlanMenus
//      and findAlternatives): not disliked, and evaluateDishAgainstProfile
//      over its catalog ingredient names AND their stored allergen groups;
//   2. then, as a FridgeRecipe, every gate a generated dish passes
//      (gateGeneratedDishes: the allergen filter over the name, ingredients
//      and every step, salt and fat clamps, sanity, plausibility, units).
// So the fallback is held to the stricter of both paths.
//
// Pure: the pool, the recent dishes and the gate are passed in.
import { dislikedRecipeIds, evaluateDishAgainstProfile, hasAnyBan, ingredientGroupsOf, type DietMatchers, type PatientDietGraph } from "@/lib/diet-match";
import { fibreRichIngredient, SODIUM_REASON_MAX_MG } from "@/lib/dish-reasons";
import { BREAKFAST_MAX_MINUTES, SNACK_MAX_MINUTES } from "@/lib/dish-plausibility";
import type { FridgeRecipe } from "@/lib/fridge";
import { breaksProteinRule, foodMatches, NO_KEPT_FOODS, proteinRuleOn, type KeptFoods } from "./kept-foods";

/** A public library recipe as the pool query selects it. */
export interface LibraryRecipe {
  id: string;
  name: string;
  steps: unknown;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sodium: number | null;
  prepTime: number | null;
  cookTime: number | null;
  servings: number | null;
  ingredients: { quantity: number | null; unit: string | null; ingredient: { name: string; allergenGroups?: string[] | null } }[];
}

/** What the person has had lately: library recipe ids, and dish names (lowercased) of any source. */
export interface RecentDishes {
  recipeIds: ReadonlySet<string>;
  names: ReadonlySet<string>;
}

export interface LibraryAsk {
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  maxMinutes?: number;
  servings?: number;
  /** The levels the dish may lean into (the claimable summary, or the answers' picture). */
  little: readonly string[];
  aLot: readonly string[];
  /** What they asked to cook ("eggs"). Set → only recipes that match it (matchesRequest). */
  wants?: string;
}

// ─── "does this dish answer what they asked to cook?" ───────────────────────

/** Words in a request that name no food: "help me make some pancakes please" is about pancakes. */
const REQUEST_FILLER = new Set([
  "a", "an", "the", "some", "any", "with", "and", "or", "of", "for", "in", "on", "to", "me", "my", "i", "we", "us", "our",
  "please", "help", "want", "like", "how", "do", "can", "could", "would", "cook", "cooking", "make", "making", "made", "prepare",
  "dish", "dishes", "meal", "meals", "recipe", "recipes", "food", "something", "anything", "quick", "easy", "simple", "fast",
  "healthy", "good", "nice", "tasty", "delicious", "breakfast", "lunch", "dinner", "snack", "style", "way", "tonight", "today", "now",
]);

/** A small stem so "eggs" meets "egg", "stir-fried" meets "stir-fry", "scrambled" meets "scramble". Same on both sides. */
function requestStem(word: string): string {
  let w = word;
  const cut = (suffix: string, add = "") => {
    if (w.endsWith(suffix) && w.length - suffix.length + add.length >= 3) {
      w = w.slice(0, w.length - suffix.length) + add;
      return true;
    }
    return false;
  };
  if (!(cut("ies", "y") || cut("ied", "y") || cut("oes", "o") || (/(?:s|x|z|ch|sh)es$/.test(w) && cut("es")))) {
    if (!w.endsWith("ss")) cut("s");
  }
  if (!cut("ing")) cut("ed");
  cut("e");
  return w;
}

const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 0);

/** The stems of the words in a request that name food. Empty when it names none ("something quick"). */
export function requestWords(wants: string): string[] {
  return [...new Set(wordsOf(wants).filter((w) => !REQUEST_FILLER.has(w)).map(requestStem))];
}

/** Is every food word of the request in this dish's name? */
export function requestNamedIn(wants: string, name: string): boolean {
  const have = new Set(wordsOf(name).map(requestStem));
  return requestWords(wants).every((w) => have.has(w));
}

/**
 * Does this dish answer what they asked to cook? A whole-word match: EVERY
 * food word of the request ("scrambled eggs" → scrambl, egg) must be in the
 * dish's name or its ingredient names. Whole words, so "eggplant" is not
 * "egg". A request that names no food at all rules nothing out.
 */
export function matchesRequest(wants: string, name: string, ingredientNames: readonly string[]): boolean {
  const have = new Set([name, ...ingredientNames].flatMap(wordsOf).map(requestStem));
  return requestWords(wants).every((w) => have.has(w));
}

const SALTY_NAME = /\b(salt|soy sauce|tamari|fish sauce|broths?|stocks?|bouillon|bacon|ham|salami|prosciutto|sausages?|olives?|capers?|pickles?|feta|parmesan|cheese|miso|teriyaki|hoisin|oyster sauce)\b/i;

function stepsOf(r: LibraryRecipe): string[] {
  return Array.isArray(r.steps) ? r.steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()) : [];
}

/** Small, stable hash: the same person, day and meal see the same order; another day, another dish. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Library recipes this person may be shown, best first. Hard filters: the
 * planner's rule filter (disliked recipes out; every ingredient name and
 * stored allergen group judged by evaluateDishAgainstProfile), complete data
 * (every amount, steps, a fibre figure — the card logs fibre, and 0 would be
 * a false number), and not one of their recent dishes. Then a score: a
 * fibre-rich ingredient when they get little fibre; nothing salty when they
 * get a lot of sodium; the asked time. Steps that state amounts are allowed
 * only for a one-serving recipe asked for one person (the app scales the
 * card's per-serving amounts). Ties break by a hash of person, day and meal.
 * With `ask.wants` (they asked to cook something particular) only recipes
 * that match it are kept, on top of every filter above; without it nothing
 * here changes.
 * With `person.kept` (what they keep at home and love): when the protein rule
 * is on (`person.proteinRule`, default proteinRuleOn(kept, ask.wants)) a recipe
 * with a meat or fish they do not keep at home is dropped, with the other hard
 * filters. Scores: +1 per distinct at-home food the recipe uses (at most +2),
 * +3 when it uses a favourite. Without `kept` nothing here changes.
 */
export function rankLibrary(
  pool: readonly LibraryRecipe[],
  ask: LibraryAsk,
  person: { patient: Pick<PatientDietGraph, "dishPreferences" | "journalEntries">; matchers: DietMatchers; seed: string; kept?: KeptFoods; proteinRule?: boolean },
  recent: RecentDishes,
  stepStatesAmount: (step: string) => boolean,
): LibraryRecipe[] {
  const disliked = dislikedRecipeIds(person.patient);
  const banned = hasAnyBan(person.matchers);
  const multi = (ask.servings ?? 1) > 1;
  const limit = ask.maxMinutes ?? (ask.mealType === "breakfast" ? BREAKFAST_MAX_MINUTES : ask.mealType === "snack" ? SNACK_MAX_MINUTES : undefined);
  const kept = person.kept ?? NO_KEPT_FOODS;
  const ruleOn = person.proteinRule ?? proteinRuleOn(kept, ask.wants);
  const uses = (food: string, names: readonly string[]) => names.some((n) => foodMatches(food, n));
  const scored: { r: LibraryRecipe; score: number; tie: number }[] = [];
  for (const r of pool) {
    if (disliked.has(r.id) || recent.recipeIds.has(r.id) || recent.names.has(r.name.trim().toLowerCase())) continue;
    if (r.ingredients.length < 2 || r.ingredients.some((ri) => ri.quantity == null || !(ri.quantity > 0))) continue;
    if (r.fiber == null || stepsOf(r).length === 0) continue;
    // The card logs this fibre figure: one above the carbs is a data error, not a dish.
    if (r.carbs == null || r.fiber > r.carbs) continue;
    // A few stored names carry editing notes ("Caribbean Casserole , V2S- 1/3 cup black beans"): not a card title.
    if (/\d/.test(r.name)) continue;
    const names = r.ingredients.map((ri) => ri.ingredient.name);
    if (banned && !evaluateDishAgainstProfile(names, person.matchers, ingredientGroupsOf(r.ingredients)).passed) continue;
    // They asked to cook something particular: a recipe that is not that is never the answer.
    if (ask.wants !== undefined && !matchesRequest(ask.wants, r.name, names)) continue;
    if (ruleOn && breaksProteinRule(names, kept)) continue;

    const per = r.servings && r.servings > 0 ? r.servings : 1;
    // The card (and the cook-mode recipe sent back from it) lists ONE serving and the app scales it.
    // Steps that state amounts are only right when they are already one serving's amounts: a
    // one-serving recipe, for one person. Anything else is out, not just ranked lower.
    if ((multi || per !== 1) && stepsOf(r).some(stepStatesAmount)) continue;
    let score = 0;
    if (ask.little.includes("fibre")) {
      if (fibreRichIngredient(names)) score += 3;
      if (r.fiber / per >= 6) score += 1;
    }
    if (ask.aLot.includes("sodium")) {
      if (r.sodium != null && r.sodium / per <= SODIUM_REASON_MAX_MG) score += 2;
      if (!names.some((n) => SALTY_NAME.test(n))) score += 1;
    }
    const minutes = (r.prepTime ?? 0) + (r.cookTime ?? 0);
    if (limit !== undefined && minutes > 0 && minutes <= limit) score += 2;
    if (multi) score += 3;
    score += Math.min(2, new Set(kept.atHome.filter((f) => uses(f, names))).size);
    if (kept.favorites.some((f) => uses(f, names))) score += 3;
    // A recipe NAMED for what they asked comes before one that only contains it (eggs in a muffin).
    if (ask.wants !== undefined && requestNamedIn(ask.wants, r.name)) score += 10;
    scored.push({ r, score, tie: hash(`${person.seed}|${r.id}`) });
  }
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return scored.map((s) => s.r);
}

/**
 * A library recipe in the generator's shape, per serving, so it goes through
 * the very same gates and card as a generated dish: its own catalog
 * ingredients, stored amounts divided by its servings, its stored steps and
 * macros. The description is the name (the library's own convention; the
 * card does not show it). `id` is fresh per card, like a generated dish's.
 */
export function libraryToFridge(r: LibraryRecipe, mealName: string, servings: number, id: string): FridgeRecipe {
  const per = r.servings && r.servings > 0 ? r.servings : 1;
  const n = (v: number | null) => (v != null && Number.isFinite(v) ? v / per : 0);
  const amounts = r.ingredients.map((ri) => ({
    name: ri.ingredient.name.trim(),
    quantity: Math.round(((ri.quantity ?? 0) / per) * 1000) / 1000,
    unit: (ri.unit ?? "").trim().toLowerCase(),
  }));
  return {
    id,
    name: r.name.trim(),
    description: r.name.trim(),
    emoji: "",
    usesIngredients: amounts.map((a) => a.name),
    missingIngredients: [],
    steps: stepsOf(r),
    mealType: mealName,
    servings,
    perServing: { calories: n(r.calories), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat), fiber: n(r.fiber) },
    fitsPlan: true,
    conflicts: [],
    ...(r.prepTime != null ? { prepMinutes: r.prepTime } : {}),
    ...(r.cookTime != null ? { cookMinutes: r.cookTime } : {}),
    amounts,
  };
}

// ─── the meal notification's dish ───────────────────────────────────────────

/** A notification title has room for a short name only. */
export const SUGGESTION_NAME_MAX = 40;

/**
 * The dish a meal notification names ("How does <dish> sound for lunch?"):
 * the best ranked library recipe whose name is short enough to read on a
 * lock screen. Only the NAME leaves the server; when the person says yes the
 * dish is made through the normal dish tool and all of its gates.
 */
export function suggestionName(ranked: readonly Pick<LibraryRecipe, "name">[]): string | null {
  for (const r of ranked) {
    const name = r.name.trim();
    if (name.length > 0 && name.length <= SUGGESTION_NAME_MAX) return name;
  }
  return null;
}
