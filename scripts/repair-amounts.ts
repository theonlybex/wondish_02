/**
 * Make every stored amount something a person can measure.
 *
 *   node --import tsx scripts/repair-amounts.ts            # report only
 *   node --import tsx scripts/repair-amounts.ts --apply    # write, after a backup
 *
 * QA reported "0.37 tablespoons" in cycles 13, 14 and 15. Each fix landed in
 * the GENERATOR — `measurableAmount`, reached only from inside the cooking-fat
 * clamp — so the rows a user actually reads never changed, and the defect was
 * reported fixed twice while still on screen. 1,847 of 16,420 stored rows ask
 * for an amount no kitchen can produce.
 *
 * The rule itself lives in lib/dish-plausibility.ts (`repairAmount`), so the
 * generator and this backfill cannot drift apart — the shape that produced six
 * separate plural-trap bugs across four modules.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not round pinch-sized seasoning UP. 1,340 rows ask for 1/16 tsp
 *     of salt or pepper; the old floor of 1/8 tsp would have doubled every one
 *     of them, and sodium is the rail QA already caught reading green while it
 *     was wrong. A pinch is its own unit and lib/staple-density.ts already
 *     prices it at 1/16 tsp, so the conversion moves no sodium at all.
 *   - It does not touch a row that is already measurable. A third of a cup and
 *     a quarter of a lemon are amounts; an earlier version of the predicate
 *     condemned 525 of them, which would have been this script doing damage.
 *
 * Amounts feed nutrition, so CLARA-generated dishes are repriced from their
 * repaired rows afterwards. Curated library rows keep their measured macros:
 * the amount change is a rounding, and their numbers came from a source this
 * table does not get to overrule (see the removed calorie rewrite in
 * scripts/repair-generated-dishes.ts).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { repairAmount } from "../lib/dish-plausibility";
import { priceDish, PRICING_COVERAGE_MIN } from "../lib/staple-density";

const APPLY = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient();

  const rows = await prisma.recipeIngredient.findMany({
    where: { quantity: { not: null } },
    select: {
      recipeId: true,
      ingredientId: true,
      quantity: true,
      unit: true,
      ingredient: { select: { name: true } },
      recipe: { select: { name: true, tags: true } },
    },
  });

  type Fix = {
    recipeId: string;
    ingredientId: string;
    recipe: string;
    ingredient: string;
    from: { quantity: number; unit: string | null };
    to: { quantity: number; unit: string | null };
  };
  const fixes: Fix[] = [];
  for (const r of rows) {
    const repaired = repairAmount(r.quantity!, r.unit, r.ingredient.name);
    if (!repaired) continue;
    fixes.push({
      recipeId: r.recipeId,
      ingredientId: r.ingredientId,
      recipe: r.recipe.name,
      ingredient: r.ingredient.name,
      from: { quantity: r.quantity!, unit: r.unit },
      to: repaired,
    });
  }

  const toPinch = fixes.filter((f) => f.to.unit === "pinch").length;
  const reunit = fixes.filter((f) => f.to.unit !== f.from.unit && f.to.unit !== "pinch").length;
  console.log(`rows with a quantity:      ${rows.length}`);
  console.log(`unmeasurable:              ${fixes.length}`);
  console.log(`  → a pinch (unit change): ${toPinch}`);
  console.log(`  → another unit:          ${reunit}`);
  console.log(`  → snapped in place:      ${fixes.length - toPinch - reunit}`);
  console.log(`recipes touched:           ${new Set(fixes.map((f) => f.recipeId)).size}`);
  console.log(
    "\nsample:\n" +
      fixes
        .slice(0, 12)
        .map(
          (f) =>
            `  ${f.from.quantity} ${f.from.unit ?? ""} → ${f.to.quantity} ${f.to.unit ?? ""}  ${f.ingredient}  (${f.recipe})`
        )
        .join("\n")
  );

  if (!APPLY) {
    console.log("\nreport only. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `/tmp/wondish-amount-repair-${stamp}.json`;
  writeFileSync(backup, JSON.stringify(fixes, null, 2));
  console.log(`\nbackup written: ${backup}`);

  let written = 0;
  for (const f of fixes) {
    await prisma.recipeIngredient.update({
      where: { recipeId_ingredientId: { recipeId: f.recipeId, ingredientId: f.ingredientId } },
      data: { quantity: f.to.quantity, unit: f.to.unit },
    });
    written++;
  }

  // ── Reprice what the amounts changed ───────────────────────────────────────
  // Only Clara's rows: her numbers are computed from amounts in the first
  // place, so leaving them stale would reintroduce the "declared vs priced"
  // gap cycles 5-9 closed. A curated row's macros were measured, not derived.
  const touched = new Set(fixes.map((f) => f.recipeId));
  const generated = await prisma.recipe.findMany({
    where: { id: { in: [...touched] }, tags: { hasSome: ["clara", "clara-swap"] } },
    select: {
      id: true, name: true, calories: true, protein: true, carbs: true, fat: true, steps: true,
      ingredients: { select: { quantity: true, unit: true, note: true, ingredient: { select: { name: true } } } },
    },
  });
  let repriced = 0;
  for (const r of generated) {
    const priced = priceDish(
      r.ingredients.map((ri) => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit, note: ri.note })),
      r.steps
    );
    if (!priced || priced.coverage < PRICING_COVERAGE_MIN) continue;
    if (priced.calories < 80 || priced.calories > 1400) continue;
    await prisma.recipe.update({
      where: { id: r.id },
      data: {
        calories: priced.calories,
        protein: priced.protein,
        carbs: priced.carbs,
        fat: priced.fat,
      },
    });
    repriced++;
  }

  console.log(`\napplied: ${written} amounts repaired, ${repriced} generated dishes repriced from them`);
  await prisma.$disconnect();
}

main();
