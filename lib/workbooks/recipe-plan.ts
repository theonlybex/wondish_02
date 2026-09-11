// Phase B planner (pure): map each workbook recipe onto its DB portion
// variant and decide what to write. Clara-tagged rows are never candidates.
import { matchVariant, type WorkbookRecipe } from "./normalize";

export type RecipeUpdate = {
  recipeId: string;
  sourceRow: number;
  steps: string[] | null; // null = keep existing steps
  stepsSource: "author" | null;
  sodium: number | null;
  saturatedFat: number | null;
  sugars: number | null;
  addedSugars: number | null;
  quantities: { ingredientId: string; quantity: number | null; unit: string }[];
};
export type RecipePlan = { update: RecipeUpdate[]; unmatched: string[]; skippedClara: number };

export function planRecipeUpdates(a: {
  recipes: WorkbookRecipe[];
  dbRecipes: { id: string; name: string; calories: number | null; servings: number | null; tags: string[]; steps: string[]; ingredients: { ingredientId: string; formId: string | null }[] }[];
}): RecipePlan {
  const skippedClara = a.dbRecipes.filter((d) => d.tags.includes("clara")).length;
  const pool = a.dbRecipes.filter((d) => !d.tags.includes("clara"));
  const plan: RecipePlan = { update: [], unmatched: [], skippedClara };
  const taken = new Set<string>();
  for (const r of a.recipes) {
    const id = matchVariant(pool.filter((p) => !taken.has(p.id)), r);
    if (!id) { plan.unmatched.push(`${r.name} (row ${r.sourceRow})`); continue; }
    taken.add(id);
    const db = pool.find((p) => p.id === id)!;
    const byForm = new Map(r.ingredients.map((i) => [i.formId, i]));
    const quantities = db.ingredients
      .filter((i) => i.formId && byForm.has(i.formId))
      .map((i) => ({ ingredientId: i.ingredientId, quantity: byForm.get(i.formId!)!.quantity, unit: byForm.get(i.formId!)!.unit }));
    const useAuthor = r.steps.length >= 2;
    plan.update.push({
      recipeId: id, sourceRow: r.sourceRow,
      steps: useAuthor ? r.steps : null, stepsSource: useAuthor ? "author" : null,
      sodium: r.sodium, saturatedFat: r.saturatedFat, sugars: r.sugars, addedSugars: r.addedSugars,
      quantities,
    });
  }
  return plan;
}
