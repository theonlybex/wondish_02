// Pure ranking for the "What to buy" smart-stocking list. The route diet-filters
// recipes first (only eatable dishes reach here), then this module counts how
// many dishes each ingredient unlocks and orders: favorites first, then by
// dish-count descending. Pantry items (already owned) and trivial staples are
// dropped.

export type RankRecipe = { ingredients: { ingredientId: string; name: string }[] };
export type ToBuyItem = { ingredientId: string; name: string; dishCount: number; favorite: boolean };

export const STAPLE_NAMES = new Set(["salt", "pepper", "black pepper", "water"]);

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
  const items: ToBuyItem[] = [];
  for (const [ingredientId, { name, count }] of counts) {
    if (pantry.has(ingredientId)) continue;
    if (staples.has(name.trim().toLowerCase())) continue;
    items.push({ ingredientId, name, dishCount: count, favorite: liked.has(ingredientId) });
  }

  items.sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      b.dishCount - a.dishCount ||
      a.name.localeCompare(b.name)
  );
  return items.slice(0, cap);
}
