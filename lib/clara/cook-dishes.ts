// The dishes a chat has started cooking, as the conversation's `recipe` (Json)
// column holds them. Pure: no database. Shared by the cook service and the
// conversation list (?cook=1), so both read the column the same way.
//
// Shape: `{ [dishId]: { name, recipe, startedAt, cookedAt } }`. "Plan today's
// dishes" puts up to three cookable dishes in one chat, and each one keeps its
// own recipe so an earlier dish can still be logged after a later one started.
//
// Builds before this stored ONE recipe per chat (the recipe object itself,
// with `steps` at the top level). That value is read as a single dish under
// LEGACY_DISH_ID, named and dated by the chat's dishName / cookedAt columns.

/** The key of a dish stored by a build that kept one recipe per chat. Real dishIds are never empty. */
export const LEGACY_DISH_ID = "";

export interface CookDish {
  /** The dish name as the chat shows it (60-char title cap). */
  name: string;
  /** The recipe as validated at start; re-validated before it is logged. */
  recipe: unknown;
  /** ISO time the dish was started; null for a legacy dish (oldest). */
  startedAt: string | null;
  /** ISO time cooking finished; null until "Done cooking". */
  cookedAt: string | null;
}

/** A Map, not a plain object, so a dishId such as "__proto__" is only ever a key. */
export type CookDishes = Map<string, CookDish>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** True for the old single-recipe value (a recipe object, `steps` at the top). */
export function isLegacyRecipe(raw: unknown): boolean {
  return isObj(raw) && Array.isArray(raw.steps);
}

/**
 * Reads the stored column into a map. Entries that are not objects with a
 * name are skipped; anything else malformed is left for the recipe check.
 */
export function readCookDishes(raw: unknown, columns: { dishName: string | null; cookedAt: Date | null }): CookDishes {
  if (isLegacyRecipe(raw)) {
    const out: CookDishes = new Map();
    if (columns.dishName) {
      out.set(LEGACY_DISH_ID, {
        name: columns.dishName,
        recipe: raw,
        startedAt: null,
        cookedAt: columns.cookedAt ? columns.cookedAt.toISOString() : null,
      });
    }
    return out;
  }
  const out: CookDishes = new Map();
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!isObj(v) || typeof v.name !== "string" || v.name.length === 0) continue;
    out.set(id, { name: v.name, recipe: v.recipe, startedAt: isoOrNull(v.startedAt), cookedAt: isoOrNull(v.cookedAt) });
  }
  return out;
}

/** The value written back to the column (own data properties only). */
export function cookDishesJson(dishes: CookDishes): Record<string, CookDish> {
  return Object.fromEntries(dishes);
}

/** The most recently started dish (a legacy dish counts as the oldest), or null. */
export function latestCookDish(dishes: CookDishes): { dishId: string; dish: CookDish } | null {
  let best: { dishId: string; dish: CookDish } | null = null;
  for (const [dishId, dish] of dishes) {
    if (!best || (dish.startedAt ?? "") > (best.dish.startedAt ?? "")) best = { dishId, dish };
  }
  return best;
}

/** Steps in the most recently started dish's recipe; anything malformed counts as none. */
export function latestStepCount(raw: unknown): number {
  const recipe = isLegacyRecipe(raw) ? raw : latestCookDish(readCookDishes(raw, { dishName: null, cookedAt: null }))?.dish.recipe;
  const steps = isObj(recipe) ? recipe.steps : null;
  return Array.isArray(steps) ? steps.length : 0;
}
