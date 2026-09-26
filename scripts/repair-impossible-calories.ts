/**
 * Dishes whose declared calories no meal has — 0-59 kcal (not a side) or over
 * 1,200 — repriced from their OWN amounts where the pricing table can vouch
 * for them (pricingMayOverwrite: coverage and a sane result).
 *
 *   node --import tsx scripts/repair-impossible-calories.ts            # report
 *   node --import tsx scripts/repair-impossible-calories.ts --apply    # write, after a backup
 *
 * Drinks are left alone: sparkling water and black tea really are ~0 kcal.
 * Anything the table cannot price stays as it is and is listed — the builder
 * already refuses it as a slot's main dish (lib/meal-plan.ts MIN_MEAL_KCAL).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { priceDish, pricingMayOverwrite } from "../lib/staple-density";

const APPLY = process.argv.includes("--apply");
const DRINK = /\b(water|tea|coffee|latte|espresso|cocoa|milk|juice|kombucha|broth)\b/i;

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.recipe.findMany({
    where: { isPublic: true, OR: [{ calories: null }, { calories: { lt: 60 } }, { calories: { gt: 1200 } }] },
    select: {
      id: true, name: true, calories: true, protein: true, carbs: true, fat: true, steps: true,
      dishType: { select: { name: true } },
      ingredients: { select: { quantity: true, unit: true, note: true, ingredient: { select: { name: true } } } },
    },
  });
  const fixes: { id: string; name: string; from: unknown; to: { calories: number; protein: number; carbs: number; fat: number } }[] = [];
  const left: string[] = [];
  for (const r of rows) {
    if (/side/i.test(r.dishType?.name ?? "") && (r.calories ?? 0) < 60) continue;
    if (DRINK.test(r.name) && (r.calories ?? 0) < 60) { left.push(`drink, left as is: ${r.calories} kcal ${r.name}`); continue; }
    const p = priceDish(r.ingredients.map((i) => ({ name: i.ingredient.name, quantity: i.quantity, unit: i.unit, note: i.note })), r.steps);
    // 90, not 60: a condiment priced at exactly 60 ("Homemade Cashew parmesan
    // cheese", 25 → 60 in the first report) would become a servable snack.
    if (p && pricingMayOverwrite(p) && p.calories >= 90 && p.calories <= 1200) {
      fixes.push({ id: r.id, name: r.name, from: { calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat }, to: { calories: Math.round(p.calories), protein: Math.round(p.protein * 10) / 10, carbs: Math.round(p.carbs * 10) / 10, fat: Math.round(p.fat * 10) / 10 } });
    } else {
      left.push(`cannot price${p ? ` (coverage ${Math.round(p.coverage * 100)}%, ${Math.round(p.calories)} kcal)` : ""}: ${r.calories} kcal ${r.name}`);
    }
  }
  console.log(`impossible calories: ${rows.length}  → repriced: ${fixes.length}  left: ${left.length}`);
  console.log(fixes.map((f) => `  ${(f.from as { calories: number | null }).calories} → ${f.to.calories} kcal  ${f.name}`).join("\n"));
  console.log("left:\n" + left.map((l) => "  " + l).join("\n"));
  if (!APPLY) { console.log("report only. Re-run with --apply to write."); await prisma.$disconnect(); return; }
  const backup = `/tmp/wondish-calories-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(fixes, null, 2));
  console.log(`backup written: ${backup}`);
  for (const f of fixes) await prisma.recipe.update({ where: { id: f.id }, data: f.to });
  console.log(`applied: ${fixes.length}`);
  await prisma.$disconnect();
}
main();
