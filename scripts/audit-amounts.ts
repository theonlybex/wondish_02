import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { isMeasurableAmount } from "../lib/dish-plausibility";

/**
 * What the catalog asks a person to measure.
 *
 * QA reported "0.37 tablespoons" three cycles running, each time against a fix
 * that had only ever touched the generator. This counts the STORED rows,
 * because that is what a user reads. Run it before and after any amount
 * backfill.
 *
 * The predicate below was itself wrong on its first run, in the direction four
 * earlier thresholds were wrong: it condemned `0.33 cup` and `0.25 medium
 * Lemons`. A third of a cup is a cup in the measuring set, and a quarter of a
 * lemon is a knife cut. Measurable means "a kitchen can produce it", not
 * "the number is round".
 *
 *   node --import tsx scripts/audit-amounts.ts
 */

const prisma = new PrismaClient();

const VOLUME = /^\s*(tsp|teaspoons?|tbsp|tablespoons?|cups?)\s*$/i;

// The predicate is lib/dish-plausibility.ts's, not a second copy of it.
//
// This file DID carry its own, and the two disagreed in the way that matters:
// the local one kept three-eighths in its fraction set, so "0.37 tablespoon" —
// the exact amount QA reported three cycles running — read as already fine. A
// second implementation of a rule is a second place for the rule to be wrong,
// which is how the same plural bug reached four modules.
const unmeasurable = (q: number, u: string | null) => !isMeasurableAmount(q, u);

async function main() {
  const rows = await prisma.recipeIngredient.findMany({
    where: { quantity: { not: null } },
    select: {
      quantity: true,
      unit: true,
      ingredient: { select: { name: true } },
      recipe: { select: { id: true, name: true } },
    },
  });

  const bad = rows.filter((r) => unmeasurable(r.quantity!, r.unit));
  console.log(`rows with a quantity: ${rows.length}`);
  console.log(`unmeasurable:         ${bad.length} (${((bad.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`recipes affected:     ${new Set(bad.map((r) => r.recipe.id)).size}`);

  const byUnit = new Map<string, { n: number; sample: string[] }>();
  for (const r of bad) {
    const u = (r.unit ?? "(none)").toLowerCase();
    const e = byUnit.get(u) ?? { n: 0, sample: [] };
    e.n++;
    if (e.sample.length < 4) e.sample.push(`${r.quantity} ${r.unit ?? ""} ${r.ingredient.name}`);
    byUnit.set(u, e);
  }
  console.log("\nby unit:");
  for (const [u, e] of [...byUnit.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(5)}  ${u.padEnd(12)} e.g. ${e.sample.join(" | ")}`);
  }

  const bySub = new Map<string, number>();
  for (const r of bad.filter((r) => VOLUME.test(r.unit ?? "") && r.quantity! < 0.125)) {
    bySub.set(r.ingredient.name, (bySub.get(r.ingredient.name) ?? 0) + 1);
  }
  console.log(`\npinch-sized (< 1/8 tsp): ${[...bySub.values()].reduce((a, b) => a + b, 0)}`);
  console.log(
    "  " +
      [...bySub.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([n, c]) => `${n}×${c}`)
        .join(", ")
  );

  await prisma.$disconnect();
}

main();
