/**
 * "Cooking oil" → the oil to actually use, in stored dishes.
 *
 *   node --env-file=.env.local --import tsx scripts/repair-cooking-oil-2026-10-07.ts            # report only
 *   node --env-file=.env.local --import tsx scripts/repair-cooking-oil-2026-10-07.ts --apply    # write, after a backup
 *
 * 344 public dishes list "cooking oil" and 433 tell the cook to heat "cooking
 * oil" / "cooking spray" — Clara's prompt offered the staple by that name.
 * The rule lives in lib/clara/oil.ts (generation now uses it too): the dish's
 * own specific oil if it has one, avocado oil for high-heat methods, olive
 * oil otherwise. Links move to the catalog rows ("Extra virgin olive oil",
 * "Avocado oil") so What to buy names a real bottle; a dish that already
 * links the chosen oil keeps one link, quantities summed when units agree.
 * Idempotent: a second run finds nothing.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { chooseOil, specifyCookingOil } from "../lib/clara/oil";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const GENERIC = ["oil", "cooking oil", "cooking spray", "nonstick cooking spray", "non-stick cooking spray", "oil spray"];
const PHRASE = /\b(?:cooking oil|(?:non-?stick )?cooking spray)\b/i;

(async () => {
  const generic = await prisma.ingredient.findMany({ where: { name: { in: GENERIC, mode: "insensitive" } }, select: { id: true, name: true } });
  const genericIds = new Set(generic.map((g) => g.id));
  const catalogRow = async (name: string) => {
    const r = await prisma.ingredient.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true }, orderBy: { id: "asc" } });
    if (!r) throw new Error(`catalog row "${name}" missing — stop`);
    return r;
  };
  const target = { "olive oil": await catalogRow("Extra virgin olive oil"), "avocado oil": await catalogRow("Avocado oil") } as Record<string, { id: string; name: string }>;

  const recipes = await prisma.recipe.findMany({
    where: { OR: [{ ingredients: { some: { ingredientId: { in: Array.from(genericIds) } } } }, { steps: { isEmpty: false } }, { description: { not: null } }] },
    select: { id: true, name: true, description: true, steps: true, ingredients: { select: { ingredientId: true, quantity: true, unit: true, note: true, ingredient: { select: { name: true } } } } },
  });

  type Plan = {
    id: string; name: string; oil: string; to: { id: string; name: string } | null;
    before: { steps: string[]; description: string | null; links: { ingredientId: string; quantity: number | null; unit: string | null; note: string | null }[] };
    steps: string[]; description: string | null; relink: { from: string; quantity: number | null; unit: string | null; note: string | null; merge: boolean }[];
  };
  const plans: Plan[] = [];
  for (const r of recipes) {
    const genericLinks = r.ingredients.filter((l) => genericIds.has(l.ingredientId));
    const textHit = r.steps.some((s) => PHRASE.test(s)) || PHRASE.test(r.description ?? "");
    if (genericLinks.length === 0 && !textHit) continue;

    const names = r.ingredients.map((l) => l.ingredient.name);
    const dish = { name: r.name, usesIngredients: names, missingIngredients: [], steps: r.steps };
    const oil = chooseOil(dish);
    // Catalog row for olive/avocado oil; otherwise the dish's own specific oil link.
    const own = r.ingredients.find((l) => l.ingredient.name.toLowerCase() === oil.toLowerCase());
    const to = target[oil.toLowerCase()] ?? (own ? { id: own.ingredientId, name: own.ingredient.name } : null);
    const steps = specifyCookingOil(dish).steps;
    const description = r.description ? specifyCookingOil({ ...dish, steps: [r.description] }).steps[0] : r.description;
    const relink = to
      ? genericLinks.map((l) => ({ from: l.ingredientId, quantity: l.quantity, unit: l.unit, note: l.note, merge: r.ingredients.some((x) => x.ingredientId === to.id) }))
      : [];
    plans.push({
      id: r.id, name: r.name, oil, to,
      before: { steps: r.steps, description: r.description, links: r.ingredients.map(({ ingredientId, quantity, unit, note }) => ({ ingredientId, quantity, unit, note })) },
      steps, description, relink,
    });
  }

  const by = (f: (p: Plan) => string) => plans.reduce<Record<string, number>>((m, p) => ((m[f(p)] = (m[f(p)] ?? 0) + 1), m), {});
  console.log(`${apply ? "APPLY" : "REPORT ONLY"}: ${plans.length} dishes to repair`);
  console.log("  oil chosen:", JSON.stringify(by((p) => p.to?.name ?? p.oil)));
  console.log("  links moved:", plans.reduce((n, p) => n + p.relink.length, 0), "· merged into an existing link:", plans.reduce((n, p) => n + p.relink.filter((x) => x.merge).length, 0));
  console.log("  steps rewritten:", plans.filter((p) => p.steps.join("\n") !== p.before.steps.join("\n")).length, "· descriptions rewritten:", plans.filter((p) => p.description !== p.before.description).length);
  const unresolved = plans.filter((p) => p.relink.length === 0 && p.before.links.some((l) => genericIds.has(l.ingredientId)));
  if (unresolved.length) console.log("  ! generic link with no target row:", unresolved.map((p) => `${p.name} → ${p.oil}`).slice(0, 10).join(" | "));
  for (const p of plans.slice(0, 6)) {
    const i = p.before.steps.findIndex((s) => PHRASE.test(s));
    console.log(`  · ${p.name} → ${p.to?.name ?? p.oil}${i >= 0 ? `\n      "${p.before.steps[i]}"\n    → "${p.steps[i]}"` : ""}`);
  }
  if (!apply) {
    console.log("Report only. Re-run with --apply to write (a backup is written first).");
    return prisma.$disconnect();
  }

  const backup = `/tmp/repair-cooking-oil-backup-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(plans.map((p) => ({ id: p.id, ...p.before }))));
  console.log(`backup → ${backup}`);
  for (const p of plans) {
    await prisma.$transaction(async (tx) => {
      for (const l of p.relink) {
        await tx.recipeIngredient.delete({ where: { recipeId_ingredientId: { recipeId: p.id, ingredientId: l.from } } });
        // Checked at write time: two generic links on one dish land on the same row.
        const cur = await tx.recipeIngredient.findUnique({ where: { recipeId_ingredientId: { recipeId: p.id, ingredientId: p.to!.id } } });
        if (cur) {
          if (cur.unit === l.unit && cur.quantity != null && l.quantity != null) {
            await tx.recipeIngredient.update({ where: { recipeId_ingredientId: { recipeId: p.id, ingredientId: p.to!.id } }, data: { quantity: cur.quantity + l.quantity } });
          }
        } else {
          await tx.recipeIngredient.create({ data: { recipeId: p.id, ingredientId: p.to!.id, quantity: l.quantity, unit: l.unit, note: l.note } });
        }
      }
      await tx.recipe.update({ where: { id: p.id }, data: { steps: p.steps, description: p.description } });
    });
  }
  console.log(`Applied: ${plans.length} dishes.`);
  await prisma.$disconnect();
})();
