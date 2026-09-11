// Phase A planner (pure): which DB ingredients get a Wondish form id, which
// forms need a new Ingredient row, which conversions apply, and what must NOT
// be touched (an ingredient already carrying a different formId).
import { normName, type FormRow, type RecipeRow } from "./normalize";
import type { Big9Row, ConversionRow } from "./read";

export type IngredientAttrs = { formId: string; canonicalId: string; groceryCategory: string; components: string[]; allergenGroups: string[] };
export type IngredientPlan = {
  attach: ({ ingredientId: string } & IngredientAttrs)[];
  create: ({ name: string } & IngredientAttrs)[];
  conversions: ConversionRow[];
  conflicts: { formId: string; reason: string }[];
};

export function planIngredientUpdates(a: {
  forms: FormRow[];
  recipeRows: RecipeRow[];
  big9: Big9Row[];
  conversions: ConversionRow[];
  dbIngredients: { id: string; name: string; formId: string | null }[];
  aliases: Record<string, string | null>;
}): IngredientPlan {
  const formById = new Map(a.forms.map((f) => [f.formId, f]));
  const groupsByForm = new Map<string, string[]>();
  for (const b of a.big9) {
    const g = groupsByForm.get(b.formId) ?? [];
    if (!g.includes(b.allergenGroup)) g.push(b.allergenGroup);
    groupsByForm.set(b.formId, g);
  }
  const dbByName = new Map(a.dbIngredients.map((d) => [normName(d.name), d]));
  const plan: IngredientPlan = { attach: [], create: [], conversions: [], conflicts: [] };

  // The name 02 used for each form (first occurrence wins).
  const nameByForm = new Map<string, string>();
  for (const r of a.recipeRows) if (r.formId && !nameByForm.has(r.formId)) nameByForm.set(r.formId, r.ingredientName);

  const claimed = new Set<string>(); // DB ingredient ids already planned (two forms → same name)
  for (const [formId, usedName] of nameByForm) {
    const form = formById.get(formId);
    if (!form) { plan.conflicts.push({ formId, reason: "not in Wondish 01" }); continue; }
    const attrs: IngredientAttrs = { formId, canonicalId: form.canonicalId, groceryCategory: form.groceryCategory, components: form.components, allergenGroups: groupsByForm.get(formId) ?? [] };
    // Resolution order: the name 02 used → its alias-map target → 01's canonical name.
    const candidates = [usedName, a.aliases[normName(usedName)] ?? "", form.canonicalName].map(normName).filter(Boolean);
    const hit = candidates.map((c) => dbByName.get(c)).find(Boolean);
    if (hit) {
      if (hit.formId && hit.formId !== formId) plan.conflicts.push({ formId, reason: `${hit.name} already has formId ${hit.formId}` });
      else if (claimed.has(hit.id)) plan.conflicts.push({ formId, reason: `${hit.name} already claimed by another form in this run` });
      else if (!hit.formId) { claimed.add(hit.id); plan.attach.push({ ingredientId: hit.id, ...attrs }); }
      // hit.formId === formId → already imported; nothing to do (idempotent).
    } else {
      plan.create.push({ name: form.canonicalName, ...attrs });
    }
  }
  const wanted = new Set(nameByForm.keys());
  plan.conversions = a.conversions.filter((c) => wanted.has(c.formId));
  return plan;
}
