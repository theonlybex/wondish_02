// Pure transforms over Wondish workbook rows (no I/O, no Prisma).
import { displayDishName } from "@/lib/dish-name";

export type FormRow = { formId: string; canonicalId: string; canonicalName: string; groceryCategory: string; components: string[] };
export type RecipeRow = {
  sourceRow: number; recipeName: string | null; servings: number | null; quantity: number | null; unit: string;
  formId: string; ingredientName: string; instructions: string; calories: number | null;
  sodium: number | null; saturatedFat: number | null; sugars: number | null; addedSugars: number | null;
};
export type WorkbookRecipe = {
  name: string; sourceRow: number; servings: number | null; calories: number | null;
  sodium: number | null; saturatedFat: number | null; sugars: number | null; addedSugars: number | null;
  steps: string[]; ingredients: { formId: string; name: string; quantity: number | null; unit: string }[];
};

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** "1. Heat oil.\r\n2) Add chicken." → ["Heat oil.", "Add chicken."] */
export function splitSteps(instructions: string): string[] {
  return instructions.split(/\r?\n/).map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
}

/** "milk - casein -whey - Milk" → ["milk", "casein", "whey"] */
export function parseComponents(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/\s*-\s*/)) {
    const p = normName(part);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** A row with a Recipe Name starts a recipe; blank-name rows belong to the current one. */
export function groupRecipeRows(rows: RecipeRow[]): WorkbookRecipe[] {
  const out: WorkbookRecipe[] = [];
  let cur: WorkbookRecipe | null = null;
  for (const r of rows) {
    if (r.recipeName) {
      cur = {
        name: r.recipeName.trim(), sourceRow: r.sourceRow, servings: r.servings, calories: r.calories,
        sodium: r.sodium, saturatedFat: r.saturatedFat, sugars: r.sugars, addedSugars: r.addedSugars,
        steps: splitSteps(r.instructions), ingredients: [],
      };
      out.push(cur);
    }
    if (cur && r.formId) cur.ingredients.push({ formId: r.formId, name: r.ingredientName.trim(), quantity: r.quantity, unit: r.unit.trim() });
  }
  return out;
}

/**
 * The DB library stores each workbook recipe as portion variants ("…, V1S- 1
 * egg"). Pick the variant whose calories are closest to the workbook recipe's
 * (ties → same servings); null when no variant is within 35%.
 */
export function matchVariant(
  dbRows: { id: string; name: string; calories: number | null; servings: number | null }[],
  recipe: WorkbookRecipe
): string | null {
  const target = normName(recipe.name);
  const candidates = dbRows.filter((d) => normName(displayDishName(d.name)) === target);
  if (candidates.length === 0) return null;
  if (recipe.calories == null) return candidates[0].id;
  let best: { id: string; diff: number; servings: number | null } | null = null;
  for (const c of candidates) {
    if (c.calories == null) continue;
    const diff = Math.abs(c.calories - recipe.calories) / Math.max(1, recipe.calories);
    if (diff > 0.35) continue;
    if (!best || diff < best.diff || (diff === best.diff && c.servings === recipe.servings && best.servings !== recipe.servings)) {
      best = { id: c.id, diff, servings: c.servings };
    }
  }
  return best?.id ?? null;
}
