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
import {
  SNACK_MAX_MINUTES, BREAKFAST_MAX_MINUTES, SMALL_DISH_KCAL, breakfastLooksLikeBreakfast,
  catalogFoodVocabulary, phrasePromisesMissingFood, truthfulDishName,
  saltRowTsp, addedSaltCapTsp, countUnitFor,
} from "../lib/dish-plausibility";
import { displayDishName } from "../lib/dish-name";

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

    // ── Fill NULL macros, on any row ──────────────────────────────────────────
  //
  // 599 public dishes carry a null protein, carb or fat — mostly curated
  // library portion rows — and a dish with a null protein silently under-counts
  // the protein ring of every day it appears in. Two QA reports found the same
  // thing from opposite ends: a "Scrambled Eggs, V1S- 1 egg" side showing 102
  // kcal with no protein figure, and a day's ring missing the ~6.5 g it
  // contributes.
  //
  // Filling a null is not the same as rewriting a measured value, so unlike the
  // repricing below this runs on library rows too: where the ingredients can be
  // priced, the gap is filled from them; where they cannot, the row is left
  // alone and lib/dish-plausibility.ts refuses it at selection instead.
  const nullMacroRows = await prisma.recipe.findMany({
    where: { isPublic: true, OR: [{ protein: null }, { carbs: null }, { fat: null }] },
    select: {
      id: true, name: true, calories: true, protein: true, carbs: true, fat: true, steps: true,
      ingredients: { select: { quantity: true, unit: true, note: true, ingredient: { select: { name: true } } } },
    },
  });
  const macroFills: { id: string; name: string; to: { protein: number; carbs: number; fat: number } }[] = [];
  for (const r of nullMacroRows) {
    const priced = priceDish(
      r.ingredients.map((ri) => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit, note: ri.note })),
      r.steps
    );
    if (!priced || priced.coverage < PRICING_COVERAGE_MIN) continue;
    macroFills.push({ id: r.id, name: r.name, to: { protein: priced.protein, carbs: priced.carbs, fat: priced.fat } });
  }
  console.log(`null-macro rows: ${nullMacroRows.length}; fillable from their amounts: ${macroFills.length}`);

  // ── Correct macro sets that contradict their own calorie figure ────────────
  //
  // Filling nulls is not enough. An earlier run of this script priced a row
  // marked "cooked" as dry and wrote 108 g of carbohydrate onto a 125 kcal
  // dish; separately, a library row declares 37 kcal for two eggs and a
  // teaspoon of oil (~180). Both are self-consistent at 4/4/9 or close to it in
  // one field and nonsense in another, so no runtime check catches them.
  //
  // This runs on ANY row, library included — a macro set that cannot be
  // reconciled with the row's own calories is not measured data, it is broken
  // data, and the ingredients are the only available arbiter.
  const allRows = await prisma.recipe.findMany({
    where: { isPublic: true, calories: { not: null }, protein: { not: null }, carbs: { not: null }, fat: { not: null } },
    select: {
      id: true, name: true, calories: true, protein: true, carbs: true, fat: true, steps: true,
      ingredients: { select: { quantity: true, unit: true, note: true, ingredient: { select: { name: true } } } },
    },
  });
  const macroCorrections: typeof macroFills = [];
  for (const r of allRows) {
    const ownDerived = (r.protein ?? 0) * 4 + (r.carbs ?? 0) * 4 + (r.fat ?? 0) * 9;
    if (!r.calories || ownDerived <= 0) continue;
    if (Math.abs(ownDerived - r.calories) / r.calories <= 0.25) continue; // internally coherent
    const priced = priceDish(
      r.ingredients.map((ri) => ({ name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit, note: ri.note })),
      r.steps
    );
    if (!priced || priced.coverage < PRICING_COVERAGE_MIN) continue;
    // The row's CALORIE figure is the measured anchor; the split is what is
    // broken. So the priced macros are scaled to reconcile with it, rather than
    // replacing it. That leaves the number the library measured intact and
    // makes 4/4/9 land on it — and it avoids chasing cooked-versus-dry cup
    // weights through the density table, which is where the last attempt at
    // this row ended up 31% out instead of 312%.
    const pricedKcal = priced.protein * 4 + priced.carbs * 4 + priced.fat * 9;
    if (pricedKcal <= 0) continue;
    const scale = r.calories / pricedKcal;
    // A scale that far from 1 means the ingredients and the calorie figure
    // disagree about the dish itself, not just its split. Leave it alone.
    if (scale < 0.4 || scale > 2.5) continue;
    macroCorrections.push({
      id: r.id,
      name: r.name,
      to: {
        protein: Math.round(priced.protein * scale * 10) / 10,
        carbs: Math.round(priced.carbs * scale * 10) / 10,
        fat: Math.round(priced.fat * scale * 10) / 10,
      },
    });
  }
  console.log(`macro sets contradicting their own calories, and priceable: ${macroCorrections.length}`);

  // A calorie-rewrite step was written here and deliberately removed.
  //
  // It targeted rows whose stated calories differ from the priced figure by
  // more than a factor of two — the case QA found was a library row declaring
  // 37 kcal for two eggs and a teaspoon of oil. It flagged 84 rows, and reading
  // them stopped the idea: "Scrambled Egg Whites with Fine Herbs", 36 kcal,
  // priced at 218, because this table maps every `egg` to a whole egg at 143
  // kcal/100 g when whites are ~52. Overwriting 84 measured figures with a
  // table that does not know egg whites, lean cuts or portion conventions would
  // cause more damage than it repairs.
  //
  // Egg whites are now in the table. The remaining wrong calorie figures in the
  // library are a data question for a human, not something this script should
  // guess at: the macro-set correction above is safe precisely because it
  // anchors to the measured calorie value instead of replacing it.


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

  // ── Move dishes whose slot label their own numbers contradict ─────────────
  //
  // 155 rows sit under Snack and take longer than 20 minutes; 54 sit under
  // Breakfast and take longer than 30. These are not broken dishes and they are
  // not bad snacks — they are dinners with the wrong label: "Ground Beef and
  // Celery with Brown Rice", 40 minutes, 503 kcal, filed as a Snack. Two QA
  // reports found them from opposite ends — /pantry offering a 772 kcal braise
  // as Breakfast and 20 rice dinners as Snack — and the plan builder found them
  // too, as an absence: it filters candidates by `recipe.mealTypeId`, so a
  // mislabelled dinner is invisible to the dinner slot AND rejected from the
  // snack slot by the timing gate. 209 usable dishes, in the pool for nothing.
  //
  // The destination comes from the row's own figures, not from a guess: over
  // 450 kcal it is a dinner, otherwise it goes to the fastest slot its timing
  // fits. Timing and calories are what the slot MEANS (a snack is small and
  // quick), so this is reading the label off the dish rather than assigning one.
  //
  // A destination is only used if the row would SURVIVE there. The first draft
  // sent "Chicken Breast with Zucchini and Roma Tomato Skewers" (27 min) from
  // Snack to Breakfast, where the breakfast-food rule drops it — that is not a
  // repair, it is moving a dish from one gate to another. So Breakfast is
  // offered only to rows breakfastLooksLikeBreakfast accepts, called from the
  // same module the runtime calls, and the rest fall through to Lunch (which
  // the Dinner slot also draws from).
  //
  // Nothing here widens what a slot accepts — the gates are unchanged. It only
  // stops 209 dishes being filed under a slot that then refuses them.
  const mealTypes = await prisma.mealType.findMany({ select: { id: true, name: true } });
  const idOf = (n: string) => mealTypes.find((m) => m.name.toLowerCase() === n.toLowerCase())?.id ?? null;
  const slotRows = await prisma.recipe.findMany({
    where: { isPublic: true, mealTypeId: { not: null } },
    select: {
      id: true, name: true, mealTypeId: true, calories: true, prepTime: true, cookTime: true,
      description: true, tags: true, steps: true, protein: true, carbs: true, fat: true,
      ingredients: { select: { quantity: true, unit: true, note: true, ingredient: { select: { name: true, groceryCategory: true } } } },
    },
  });
  const slotMoves: { id: string; name: string; from: string; to: string; toId: string; minutes: number }[] = [];
  for (const r of slotRows) {
    const from = mealTypes.find((m) => m.id === r.mealTypeId)?.name ?? "";
    const minutes = (r.prepTime ?? 0) + (r.cookTime ?? 0);
    if (minutes === 0) continue; // no timing on file: nothing to contradict
    const tooSlowForSnack = from.toLowerCase() === "snack" && minutes > SNACK_MAX_MINUTES;
    const tooSlowForBreakfast = from.toLowerCase() === "breakfast" && minutes > BREAKFAST_MAX_MINUTES;
    if (!tooSlowForSnack && !tooSlowForBreakfast) continue;
    const asBreakfast = {
      name: r.name,
      description: r.description,
      steps: r.steps,
      mealTypeName: "Breakfast",
      prepMinutes: r.prepTime,
      cookMinutes: r.cookTime,
      calories: r.calories,
      macros: { protein: r.protein, carbs: r.carbs, fat: r.fat },
      generated: (r.tags ?? []).some((t) => /clara/i.test(t)),
      ingredients: r.ingredients.map((ri) => ({
        name: ri.ingredient.name, quantity: ri.quantity, unit: ri.unit, note: ri.note,
        category: ri.ingredient.groceryCategory,
      })),
    };
    const to =
      r.calories != null && r.calories >= SMALL_DISH_KCAL
        ? "Dinner"
        : tooSlowForSnack && minutes <= BREAKFAST_MAX_MINUTES && breakfastLooksLikeBreakfast(asBreakfast)
          ? "Breakfast"
          : "Lunch";
    const toId = idOf(to);
    if (!toId || toId === r.mealTypeId) continue;
    slotMoves.push({ id: r.id, name: r.name, from, to, toId, minutes });
  }
  const moveTally: Record<string, number> = {};
  for (const m of slotMoves) moveTally[`${m.from}→${m.to}`] = (moveTally[`${m.from}→${m.to}`] ?? 0) + 1;
  console.log(`slot labels contradicted by the row's own timing: ${slotMoves.length} ${JSON.stringify(moveTally)}`);
  for (const m of slotMoves.slice(0, 5)) {
    console.log(`  ${m.from} → ${m.to} (${m.minutes} min) — ${m.name}`);
  }

  // ── Rename generated rows whose own name promises food they don't contain ──
  //
  // The same repair generation now does at the write point (repairProse), for
  // the rows written before it existed. 134 generated dishes carry a name or
  // description that names food they do not list, and selection refuses every
  // one — including 22 of the ~75 snacks in the catalog, which is why a QA week
  // served the same snack four times.
  //
  // Renaming is not cosmetic here: the name is the claim a reader shops from.
  // "Ground Beef with Bell Peppers and Brown Rice" made with jasmine rice sends
  // someone to buy brown rice for a dish that never uses it. The ingredient
  // list is the truth, so the name is rebuilt from it, re-checked by the
  // predicate that condemned the old one, and left alone when no honest name
  // can be formed (that row stays out of the pool, correctly).
  //
  // CLARA-tagged rows only. A curated name is editorial and measured; this
  // script has no business rewriting one.
  const vocabulary = catalogFoodVocabulary(
    (await prisma.ingredient.findMany({ select: { name: true } })).map((i) => i.name)
  );
  const takenNames = new Set(
    (await prisma.recipe.findMany({ select: { name: true } })).map((r) => r.name.trim().toLowerCase())
  );
  const proseRows = await prisma.recipe.findMany({
    where: { isPublic: true, tags: { hasSome: ["clara", "Clara", "clara-generated"] } },
    select: {
      id: true, name: true, description: true,
      ingredients: { select: { ingredient: { select: { name: true } } } },
    },
  });
  const renames: { id: string; from: string; to: string; lied: string; description: string | null }[] = [];
  for (const r of proseRows) {
    const names = r.ingredients.map((ri) => ri.ingredient.name);
    const nameLie = phrasePromisesMissingFood(displayDishName(r.name), names, vocabulary);
    const descLie = r.description ? phrasePromisesMissingFood(r.description, names, vocabulary) : null;
    if (!nameLie && !descLie) continue;
    let to = r.name;
    if (nameLie) {
      const honest = truthfulDishName(names, vocabulary, takenNames);
      if (!honest) continue;
      to = honest;
      takenNames.delete(r.name.trim().toLowerCase());
      takenNames.add(honest.trim().toLowerCase());
    }
    renames.push({ id: r.id, from: r.name, to, lied: nameLie ?? descLie ?? "", description: to });
  }
  const titleFixes = renames.filter((r) => r.to !== r.from);
  console.log(
    `generated rows whose prose names absent food: ${renames.length} repairable ` +
      `(${titleFixes.length} renamed, ${renames.length - titleFixes.length} description-only)`
  );
  for (const r of titleFixes.slice(0, Number(process.env.SHOW ?? 5))) console.log(`  "${r.from}" (no ${r.lied}) → "${r.to}"`);

  // ── Clamp added salt to a seasoning amount ────────────────────────────────
  //
  // 983 of 1,040 generated salt rows are above an eighth of a teaspoon, 290 of
  // them at a half. Each is under the per-dish ceiling and three of them are a
  // day: a profile with NO conditions came out over the 2,300 mg guideline on 6
  // days of 7, once at 3,023 mg, with every dish passing every gate. A per-dish
  // rule cannot see a day, so the amount is clamped (see SEASONING_SALT_TSP).
  //
  // Generated rows only, as with the renames — a curated row's amount is
  // editorial. Safe to rewrite because the steps say "season with salt" and do
  // not repeat the figure.
  const saltRows = await prisma.recipeIngredient.findMany({
    where: {
      ingredient: { name: { contains: "salt", mode: "insensitive" } },
      recipe: { tags: { hasSome: ["clara", "Clara", "clara-generated"] } },
    },
    select: {
      recipeId: true, ingredientId: true, quantity: true, unit: true,
      ingredient: { select: { name: true } },
      recipe: { select: { name: true, calories: true } },
    },
  });
  const saltClamps: { recipeId: string; ingredientId: string; dish: string; from: string; toTsp: number }[] = [];
  let mgSaved = 0;
  for (const row of saltRows) {
    const tsp = saltRowTsp(row.quantity, row.unit);
    const cap = addedSaltCapTsp(row.recipe.calories);
    if (tsp === null || tsp <= cap) continue;
    mgSaved += (tsp - cap) * 2325;
    saltClamps.push({
      recipeId: row.recipeId, ingredientId: row.ingredientId, dish: row.recipe.name,
      from: `${row.quantity} ${row.unit ?? ""}`.trim(), toTsp: cap,
    });
  }
  console.log(
    `salt rows above a seasoning amount: ${saltClamps.length} of ${saltRows.length} ` +
      `(${Math.round(mgSaved).toLocaleString()} mg of sodium across the catalog)`
  );
  for (const c of saltClamps.slice(0, 3)) console.log(`  ${c.from} → ${c.toTsp} tsp — ${c.dish}`);

  // ── Name the unit on a bare count ─────────────────────────────────────────
  //
  // QA read the rendered DOM of a fresh week and found 14 rows that say
  // "Sliced bread 1", "Large eggs 2", "Roma tomatoes 2" — a quantity with no
  // unit — on 6 of 7 days. countUnitFor() is correct and the dishes generated
  // after it shipped all carry units; the gap is that it runs only at
  // GENERATION, and the builder keeps serving rows written before it existed.
  // Two earlier cycles reported this and both times the fix went to the write
  // point only. It is the first thing a tester sees on opening a dish to cook.
  //
  // Only for foods whose bare count IS a measurement (an egg, a slice of
  // bread), which is the same set lib/staple-density.ts can price. A bare count
  // on anything else is not a missing word, it is a missing amount, and
  // dishProblem refuses those at selection.
  const countRows = await prisma.recipeIngredient.findMany({
    where: { quantity: { not: null }, OR: [{ unit: null }, { unit: "" }] },
    select: { recipeId: true, ingredientId: true, quantity: true, ingredient: { select: { name: true } }, recipe: { select: { name: true } } },
  });
  const unitFills: { recipeId: string; ingredientId: string; name: string; dish: string; quantity: number | null; unit: string }[] = [];
  for (const row of countRows) {
    const unit = countUnitFor(row.ingredient.name);
    if (!unit) continue;
    unitFills.push({
      recipeId: row.recipeId, ingredientId: row.ingredientId,
      name: row.ingredient.name, dish: row.recipe.name, quantity: row.quantity, unit,
    });
  }
  console.log(`unitless count rows: ${countRows.length}; nameable: ${unitFills.length}`);
  for (const u of unitFills.slice(0, 4)) console.log(`  "${u.name} ${u.quantity}" → "${u.quantity} ${u.unit}" — ${u.dish}`);

  if (!APPLY) {
    console.log("\nreport only — pass --apply to write");
    await prisma.$disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `/tmp/wondish-dish-repair-${stamp}.json`;
  writeFileSync(backup, JSON.stringify({ macroFills, macroCorrections, macroFixes, calorieFixes, linkDrops, slotMoves, renames, saltClamps, unitFills }, null, 2));
  console.log(`\nbackup written: ${backup}`);

  let filled = 0;
  for (const f of macroFills) {
    await prisma.recipe.update({ where: { id: f.id }, data: { protein: f.to.protein, carbs: f.to.carbs, fat: f.to.fat } });
    filled++;
  }
  let corrected = 0;
  for (const f of macroCorrections) {
    await prisma.recipe.update({ where: { id: f.id }, data: { protein: f.to.protein, carbs: f.to.carbs, fat: f.to.fat } });
    corrected++;
  }
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
  let unitsNamed = 0;
  for (const u of unitFills) {
    await prisma.recipeIngredient.updateMany({
      where: { recipeId: u.recipeId, ingredientId: u.ingredientId },
      data: { unit: u.unit },
    });
    unitsNamed++;
  }
  let clamped = 0;
  for (const c of saltClamps) {
    await prisma.recipeIngredient.updateMany({
      where: { recipeId: c.recipeId, ingredientId: c.ingredientId },
      data: { quantity: c.toTsp, unit: "teaspoon" },
    });
    clamped++;
  }
  let renamed = 0;
  for (const r of renames) {
    await prisma.recipe.update({ where: { id: r.id }, data: { name: r.to, description: r.description } });
    renamed++;
  }
  let moved = 0;
  for (const m of slotMoves) {
    await prisma.recipe.update({ where: { id: m.id }, data: { mealTypeId: m.toId } });
    moved++;
  }
  console.log(`applied: ${unitsNamed} bare counts given their unit, ${clamped} salt amounts clamped to a seasoning, ${renamed} dishes renamed from their ingredients, ${moved} dishes moved to the slot their timing fits, ${filled} null-macro rows filled, ${corrected} contradictory macro sets corrected, ${repriced} dishes repriced from their amounts, ${cal} calorie rows reconciled, ${dropped} bogus ingredient links removed`);
  await prisma.$disconnect();

}

main();
