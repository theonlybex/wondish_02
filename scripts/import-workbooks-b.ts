// Phase B: library recipes ← Wondish 02 (author steps, quantities, nutrition,
// lineage). Clara-tagged recipes are never touched; calories/macros are never
// overwritten. Dry-run unless `apply`.
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { findWorkbook, readRecipeRows } from "../lib/workbooks/read";
import { groupRecipeRows } from "../lib/workbooks/normalize";
import { planRecipeUpdates } from "../lib/workbooks/recipe-plan";

export async function phaseB(prisma: PrismaClient, apply: boolean): Promise<void> {
  const recipes = groupRecipeRows(readRecipeRows(findWorkbook("Wondish_02")));
  const dbRecipes = await prisma.recipe.findMany({
    where: { isPublic: true },
    select: { id: true, name: true, calories: true, servings: true, tags: true, steps: true, stepsSource: true, ingredients: { select: { ingredientId: true, ingredient: { select: { formId: true } } } } },
  });
  const plan = planRecipeUpdates({
    recipes,
    dbRecipes: dbRecipes.map((d) => ({ ...d, ingredients: d.ingredients.map((i) => ({ ingredientId: i.ingredientId, formId: i.ingredient.formId })) })),
  });
  // Idempotency: rows already stamped from the workbook (sourceRow set) and
  // with author steps are re-planned identically; count what would change.
  const withSteps = plan.update.filter((u) => u.steps).length;
  const qty = plan.update.reduce((s, u) => s + u.quantities.length, 0);
  console.log(`[B] ${apply ? "APPLY" : "DRY RUN"}: matched=${plan.update.length} authorSteps=${withSteps} quantityRows=${qty} unmatched=${plan.unmatched.length} claraSkipped=${plan.skippedClara}`);
  for (const u of plan.unmatched) console.log("  unmatched:", u);
  if (!apply) return;

  const ids = plan.update.map((u) => u.recipeId);
  const before = await prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id: true, steps: true, stepsSource: true, sourceRow: true, sodium: true, saturatedFat: true, sugars: true, addedSugars: true, ingredients: { select: { ingredientId: true, quantity: true, unit: true } } } });
  fs.writeFileSync(`workbooks-rollback-B-${Date.now()}.json`, JSON.stringify(before));

  for (const u of plan.update) {
    await prisma.recipe.update({
      where: { id: u.recipeId },
      data: { sourceRow: u.sourceRow, sodium: u.sodium, saturatedFat: u.saturatedFat, sugars: u.sugars, addedSugars: u.addedSugars, ...(u.steps ? { steps: u.steps, stepsSource: "author" } : {}) },
    });
    for (const q of u.quantities) {
      await prisma.recipeIngredient.update({ where: { recipeId_ingredientId: { recipeId: u.recipeId, ingredientId: q.ingredientId } }, data: { quantity: q.quantity, unit: q.unit || null } });
    }
  }

  // Invariants (relative to the snapshot): nothing that had steps loses them,
  // no ingredient row disappears. Raw items that never had steps stay empty.
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const after = await prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, steps: true, ingredients: { select: { ingredientId: true } } } });
  const broken = after.filter((r) => { const b = beforeById.get(r.id)!; return (b.steps.length > 0 && r.steps.length === 0) || r.ingredients.length !== b.ingredients.length; });
  if (broken.length) throw new Error(`INVARIANT VIOLATED: ${broken.length} recipes lost steps/ingredients (e.g. ${broken[0].name}) — restore from the rollback JSON`);
  console.log(`[B] applied to ${plan.update.length} recipes; invariants OK`);
}
