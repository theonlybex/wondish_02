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
 * get a lot of sodium; the asked time; for several servings, steps that state
 * no amount (the app scales per-serving amounts). Ties break by a hash of
 * person, day and meal.
 */
export function rankLibrary(
  pool: readonly LibraryRecipe[],
  ask: LibraryAsk,
  person: { patient: Pick<PatientDietGraph, "dishPreferences" | "journalEntries">; matchers: DietMatchers; seed: string },
  recent: RecentDishes,
  stepStatesAmount: (step: string) => boolean,
): LibraryRecipe[] {
  const disliked = dislikedRecipeIds(person.patient);
  const banned = hasAnyBan(person.matchers);
  const multi = (ask.servings ?? 1) > 1;
  const limit = ask.maxMinutes ?? (ask.mealType === "breakfast" ? BREAKFAST_MAX_MINUTES : ask.mealType === "snack" ? SNACK_MAX_MINUTES : undefined);
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

    const per = r.servings && r.servings > 0 ? r.servings : 1;
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
    if (multi) score += stepsOf(r).some(stepStatesAmount) ? -10 : 3;
    // Per-serving steps are only right for a one-serving recipe when one serving is asked.
    if (!multi && per !== 1 && stepsOf(r).some(stepStatesAmount)) score -= 10;
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
