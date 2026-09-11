import { BASKET_STAPLES } from "@/lib/basket-coverage";
// Pure ranking for the "What to buy" smart-stocking list. The route diet-filters
// recipes first (only eatable dishes reach here), then this module counts how
// many dishes each ingredient unlocks and orders: favorites first, then by
// dish-count descending. Pantry items (already owned) and trivial staples are
// dropped.

export type RankRecipe = { ingredients: { ingredientId: string; name: string }[] };
export type ToBuyItem = {
  ingredientId: string;
  name: string;
  dishCount: number; // total eatable dishes that use this ingredient
  marginal: number; // dishes this one purchase unlocks NOW (only missing ingredient)
  favorite: boolean;
};

// One staple list for the whole basket model (lib/basket-coverage): the
// shorter local list here let "tap water · 1 fl oz" reach What-to-buy.
export const STAPLE_NAMES: Set<string> = BASKET_STAPLES;

// For each recipe that is exactly ONE ingredient short of the basket (staples
// free), that missing ingredient "unlocks" the recipe. Returns marginal unlock
// counts keyed by ingredientId — the "add X → unlocks N more dishes" number.
export function computeMarginalUnlocks(
  recipes: RankRecipe[],
  basket: Set<string>,
  staples: Set<string> = STAPLE_NAMES
): Map<string, number> {
  const marginal = new Map<string, number>();
  for (const r of recipes) {
    const missing = r.ingredients.filter(
      (ing) => !basket.has(ing.ingredientId) && !staples.has(ing.name.trim().toLowerCase())
    );
    if (missing.length === 1) {
      const id = missing[0].ingredientId;
      marginal.set(id, (marginal.get(id) ?? 0) + 1);
    }
  }
  return marginal;
}

export function computeIngredientDishCounts(
  recipes: RankRecipe[]
): Map<string, { name: string; count: number }> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const r of recipes) {
    // A dish counts once per ingredient even if it appears twice in the row set.
    const seen = new Set<string>();
    for (const ing of r.ingredients) {
      if (seen.has(ing.ingredientId)) continue;
      seen.add(ing.ingredientId);
      const cur = counts.get(ing.ingredientId);
      if (cur) cur.count += 1;
      else counts.set(ing.ingredientId, { name: ing.name, count: 1 });
    }
  }
  return counts;
}

export function rankToBuy(params: {
  recipes: RankRecipe[];
  pantry: Set<string>; // ingredientIds already owned
  liked: Set<string>; // ingredientIds marked favorite
  staples?: Set<string>; // lowercased names to skip
  cap?: number;
}): ToBuyItem[] {
  const { recipes, pantry, liked } = params;
  const staples = params.staples ?? STAPLE_NAMES;
  const cap = params.cap ?? 50;

  const counts = computeIngredientDishCounts(recipes);
  const marginal = computeMarginalUnlocks(recipes, pantry, staples);
  const items: ToBuyItem[] = [];
  for (const [ingredientId, { name, count }] of counts) {
    if (pantry.has(ingredientId)) continue;
    if (staples.has(name.trim().toLowerCase())) continue;
    items.push({
      ingredientId,
      name,
      dishCount: count,
      marginal: marginal.get(ingredientId) ?? 0,
      favorite: liked.has(ingredientId),
    });
  }

  // Favorites first; then what unlocks the most dishes RIGHT NOW (marginal);
  // then overall usefulness (absolute) so a fresh/empty basket still ranks well.
  items.sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      b.marginal - a.marginal ||
      b.dishCount - a.dishCount ||
      a.name.localeCompare(b.name)
  );
  return items.slice(0, cap);
}
