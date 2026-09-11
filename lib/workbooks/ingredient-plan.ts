// Phase A planner (pure): which DB ingredients get a Wondish form id, which
// forms need a new Ingredient row, which conversions apply, and what must NOT
// be touched (an ingredient already carrying a different formId).
import { normName, type FormRow, type RecipeRow } from "./normalize";
import type { Big9Row, ConversionRow } from "./read";

export type IngredientAttrs = { formId: string; canonicalId: string; groceryCategory: string; components: string[]; allergenGroups: string[] };
export type DbIngredient = { id: string; name: string; formId: string | null; uses: number };
export type IngredientPlan = {
  attach: ({ ingredientId: string } & IngredientAttrs)[];
  // The form sits on an orphan row (no recipe uses it) while a row recipes DO
  // use has the same name: detach from the orphan, attach to the used row.
  move: ({ fromIngredientId: string; ingredientId: string } & IngredientAttrs)[];
  create: ({ name: string } & IngredientAttrs)[];
  conversions: ConversionRow[];
  conflicts: { formId: string; reason: string }[];
};

export function planIngredientUpdates(a: {
  forms: FormRow[];
  recipeRows: RecipeRow[];
  big9: Big9Row[];
  conversions: ConversionRow[];
  dbIngredients: DbIngredient[];
  aliases: Record<string, string | null>;
}): IngredientPlan {
  const formById = new Map(a.forms.map((f) => [f.formId, f]));
  const groupsByForm = new Map<string, string[]>();
  for (const b of a.big9) {
    const g = groupsByForm.get(b.formId) ?? [];
    if (!g.includes(b.allergenGroup)) g.push(b.allergenGroup);
    groupsByForm.set(b.formId, g);
  }
  // Several DB rows can share a normalised name ("Green cabbage" / "green
  // cabbage" — Clara creates lowercase rows). Keep them all.
  const dbByName = new Map<string, DbIngredient[]>();
  for (const d of [...a.dbIngredients].sort((x, y) => x.id.localeCompare(y.id))) {
    const k = normName(d.name);
    dbByName.set(k, [...(dbByName.get(k) ?? []), d]);
  }
  const plan: IngredientPlan = { attach: [], move: [], create: [], conversions: [], conflicts: [] };

  // The name 02 used for each form (first occurrence wins).
  const nameByForm = new Map<string, string>();
  for (const r of a.recipeRows) if (r.formId && !nameByForm.has(r.formId)) nameByForm.set(r.formId, r.ingredientName);

  const claimed = new Set<string>();
  for (const [formId, usedName] of nameByForm) {
    const form = formById.get(formId);
    if (!form) { plan.conflicts.push({ formId, reason: "not in Wondish 01" }); continue; }
    const attrs: IngredientAttrs = { formId, canonicalId: form.canonicalId, groceryCategory: form.groceryCategory, components: form.components, allergenGroups: groupsByForm.get(formId) ?? [] };
    // Candidates: the alias-map target FIRST (that's the catalog row recipes
    // point at after the remap), then the name 02 used, then 01's canonical.
    const candidates = [a.aliases[normName(usedName)] ?? "", usedName, form.canonicalName].map(normName).filter(Boolean);
    const hits = candidates.flatMap((c) => dbByName.get(c) ?? []).filter((h, i, arr) => arr.findIndex((x) => x.id === h.id) === i);
    if (hits.length === 0) { plan.create.push({ name: form.canonicalName, ...attrs }); continue; }

    const holder = hits.find((h) => h.formId === formId);
    // Prefer the row recipes actually use; ties → first candidate order.
    const free = hits.filter((h) => !h.formId && !claimed.has(h.id)).sort((x, y) => y.uses - x.uses)[0];
    if (holder) {
      if (holder.uses === 0 && free && free.uses > 0) { claimed.add(free.id); plan.move.push({ fromIngredientId: holder.id, ingredientId: free.id, ...attrs }); }
      continue; // otherwise already imported (idempotent)
    }
    if (free) { claimed.add(free.id); plan.attach.push({ ingredientId: free.id, ...attrs }); continue; }
    const busy = hits.find((h) => h.formId && h.formId !== formId);
    if (busy) plan.conflicts.push({ formId, reason: `${busy.name} already has formId ${busy.formId}` });
    else plan.conflicts.push({ formId, reason: `${hits[0].name} already claimed by another form in this run` });
  }
  const wanted = new Set(nameByForm.keys());
  plan.conversions = a.conversions.filter((c) => wanted.has(c.formId));
  return plan;
}
