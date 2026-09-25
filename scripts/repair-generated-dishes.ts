// Repair the generated dishes already in the catalog.
//
//   npx tsx scripts/repair-generated-dishes.ts            # report only
//   npx tsx scripts/repair-generated-dishes.ts --apply     # write, after a backup
//
// lib/dish-plausibility.ts stops bad dishes from being SELECTED, and
// reconcileCalories stops bad numbers from being WRITTEN. Neither fixes the
// rows already in the table, and there are enough of them to matter: 63 dishes
// carry a seasoning-sized link to a food (the "Bell peppers — 0.1 teaspoon"
// class) and 495 of 806 generated dishes overstate their calories against
// their own macro rows by more than 5%.
//
// Scoped to CLARA-tagged rows on purpose. The curated library disagrees with
// 4/4/9 in the other direction — 108 of 350 rows sit more than 5% BELOW their
// macros, which is what real nutrition data looks like once fibre (~2 kcal/g),
// rounding and sugar alcohols are involved. Rewriting those would be replacing
// measured values with an approximation.
//
// Every change is dumped to a timestamped JSON file before it is applied, so a
// bad run can be undone by hand.
//
// This is a BACKFILL, not a dependency. Two things make the catalog correct
// without it: generation prices every dish from its own amounts at the write
// point, and selection refuses any priceable dish whose stored numbers
// disagree with the arithmetic (lib/dish-plausibility.ts). So a stale row is
// never served — it is simply never selected. Running this returns those rows
// to the pool instead of leaving them stranded, which matters for variety, and
// it uses the SAME threshold the runtime gate uses so the two cannot drift.
// QA flagged an earlier version where they differed (gate 25%, script 5%): the
// dishes in between shipped wrong until someone remembered to type --apply.
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ingredientTokens } from "../lib/basket-match";
import { priceDish, PRICING_COVERAGE_MIN, macrosDisagreeWithPricing } from "../lib/staple-density";
import { BASKET_STAPLES } from "../lib/basket-coverage";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");
const TOLERANCE = 0.05;
const SEASONING_UNIT = /\b(tsp|teaspoons?|pinch|pinches|dash(es)?)\b/i;
const TABLESPOON = /\b(tbsp|tablespoons?)\b/i;
const PANTRY_MARKER =
  /\b(seasoning|blend|flakes?|powder|ground|dried|spice|mix|rub|extract|essence|sauce|paste|vinegar|syrup|juice|zest|oil|salt)\b/i;

const eq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((t) => b.has(t));
const subset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));

/** The same narrow rule as lib/dish-plausibility.ts seasoningQuantityOnFood. */
function isSeasoningOnFood(name: string, quantity: number | null, unit: string | null): boolean {
  const sized =
    (SEASONING_UNIT.test(unit ?? "") && (quantity ?? 0) <= 1) ||
    (TABLESPOON.test(unit ?? "") && (quantity ?? 0) < 1);
  if (!sized) return false;
  const lowered = name.trim().toLowerCase();
  if (PANTRY_MARKER.test(lowered)) return false;
  const tokens = ingredientTokens(lowered);
  if (tokens.size === 0) return false;
  for (const st of BASKET_STAPLES) {
    if (eq(ingredientTokens(st), tokens)) return false; // it IS the staple
  }
  for (const st of BASKET_STAPLES) {
    const stt = ingredientTokens(st);
    if (stt.size > 0 && stt.size < tokens.size && subset(stt, tokens)) return true;
  }
  return false;
}

async function main() {
  const prisma = new PrismaClient();

  const generated = await prisma.recipe.findMany({
    where: { isPublic: true, tags: { hasSome: ["clara", "clara-swap"] } },
    select: {
      id: true, name: true, calories: true, protein: true, carbs: true, fat: true,
      steps: true,
    ingredients: { select: { ingredientId: true, quantity: true, unit: true, ingredient: { select: { name: true } } } },
    },
  });

  const calorieFixes: { id: string; name: string; from: number; to: number }[] = [];
  // Whole-dish repricing: where the table can price every macro-bearing
  // ingredient, the dish's own amounts decide its nutrition. reconcileCalories
  // (below) only made the numbers agree with EACH OTHER, which is why QA still
  // found a lunch declaring 82 g of carbohydrate over ~11 g of vegetables and
  // two oat breakfasts declaring double their oats: consistent, and wrong.
  const macroFixes: {
    id: string; name: string;
    from: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
    to: { calories: number; protein: number; carbs: number; fat: number };
  }[] = [];
  const linkDrops: { recipeId: string; name: string; ingredientId: string; ingredient: string; quantity: number | null; unit: string | null }[] = [];

  for (const r of generated) {
    const priced = priceDish(
      r.ingredients.map((ri) => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit })),
      r.steps
    );
    if (
      priced &&
      priced.coverage >= PRICING_COVERAGE_MIN &&
      priced.calories >= 80 &&
      priced.calories <= 1400 &&
      r.calories &&
      // Same threshold the runtime gate uses, and the same per-macro check —
      // not a fifth of it. QA named the gap between the two as the defect: the
      // gate tolerated 25% while this script corrected at 5%, so the dishes in
      // between were repaired only when a person remembered to run --apply,
      // and 95 needed it in a single observed run.
      macrosDisagreeWithPricing(
        { calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat },
        r.ingredients.map((ri) => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit })),
        r.steps
      ) !== null
    ) {
      macroFixes.push({
        id: r.id, name: r.name,
        from: { calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat },
        to: priced,
      });
      continue; // repriced in full; no need to reconcile calories separately
    }
    const derived = (r.protein ?? 0) * 4 + (r.carbs ?? 0) * 4 + (r.fat ?? 0) * 9;
    if (r.calories && derived > 0 && Math.abs(derived - r.calories) > r.calories * TOLERANCE) {
      const to = Math.round(derived);
      if (to >= 80 && to <= 1400) calorieFixes.push({ id: r.id, name: r.name, from: r.calories, to });
    }
    for (const ri of r.ingredients) {
      if (isSeasoningOnFood(ri.ingredient.name, ri.quantity, ri.unit)) {
        linkDrops.push({
          recipeId: r.id, name: r.name, ingredientId: ri.ingredientId,
          ingredient: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit,
        });
      }
    }
  }

  console.log(`generated dishes: ${generated.length}`);
  console.log(`dishes to reprice from their amounts: ${macroFixes.length}`);
  for (const f of macroFixes.slice(0, 8)) {
    console.log(`  ${f.from.calories}→${f.to.calories} kcal, C${f.from.carbs}→${f.to.carbs} P${f.from.protein}→${f.to.protein} F${f.from.fat}→${f.to.fat}  ${f.name}`);
  }
  console.log(`calories to reconcile (not priceable): ${calorieFixes.length}`);
  for (const f of calorieFixes.slice(0, 8)) {
    console.log(`  ${f.from} → ${f.to}  (${((f.from - f.to) / f.from * 100).toFixed(1)}% over)  ${f.name}`);
  }
  console.log(`seasoning-on-food links to drop: ${linkDrops.length}`);
  for (const d of linkDrops.slice(0, 8)) {
    console.log(`  ${d.ingredient} ${d.quantity} ${d.unit}  in  ${d.name}`);
  }

  if (!APPLY) {
    console.log("\nreport only — pass --apply to write");
    await prisma.$disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `/tmp/wondish-dish-repair-${stamp}.json`;
  writeFileSync(backup, JSON.stringify({ macroFixes, calorieFixes, linkDrops }, null, 2));
  console.log(`\nbackup written: ${backup}`);

  let repriced = 0;
  for (const f of macroFixes) {
    await prisma.recipe.update({
      where: { id: f.id },
      data: { calories: f.to.calories, protein: f.to.protein, carbs: f.to.carbs, fat: f.to.fat },
    });
    repriced++;
  }
  let cal = 0;
  for (const f of calorieFixes) {
    await prisma.recipe.update({ where: { id: f.id }, data: { calories: f.to } });
    cal++;
  }
  let dropped = 0;
  for (const d of linkDrops) {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: d.recipeId, ingredientId: d.ingredientId } });
    dropped++;
  }
  console.log(`applied: ${repriced} dishes repriced from their amounts, ${cal} calorie rows reconciled, ${dropped} bogus ingredient links removed`);
  await prisma.$disconnect();

}

main();
