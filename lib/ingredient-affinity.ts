// DISHES-RETIRED (2026-09-07): the meal-plan builder's ingredient-affinity used
// to be derived from liked *dishes*. It now comes straight from liked
// *ingredients* — a cleaner, direct signal. A flat weight of 1 for each liked
// ingredient is enough; pickByMotivation blends it with motivation/macro scores.

export type AffinityPref = { liked: boolean; ingredient: { name: string } };

export function buildIngredientAffinity(prefs: AffinityPref[] | null | undefined): {
  affinityMap: Record<string, number>;
  seenIngredientNames: Set<string>;
} {
  const affinityMap: Record<string, number> = {};
  const seenIngredientNames = new Set<string>();
  for (const p of prefs ?? []) {
    const name = p.ingredient.name.toLowerCase();
    seenIngredientNames.add(name);
    if (p.liked) affinityMap[name] = 1;
  }
  return { affinityMap, seenIngredientNames };
}
