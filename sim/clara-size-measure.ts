// How big are Clara's dishes against what she was asked for? Offline: reads the
// model's recorded dinner candidates (sim/.snapshot/clara-live-raw.json, written
// by `SIM_LIVE=1 npm run sim:clara-live`) and prices each one as the card does.
// No model call, no database.
//
//   npm run sim:clara-size [file]
//
// For every candidate: the size the prompt SAID (meal-target.ts MAIN_SAID_AIM
// over the real target), the real target, what the model declared, what the
// card would show, and where the card's calories come from. The prompt asks
// for more than the target because the model's figures ran above the food
// table's; this says whether that margin still fits the table as it is now.
import "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(async () => {
  const fridge = await import("@/lib/fridge");
  const dish = await import("@/lib/clara/skills/dish");
  const gen = await import("@/lib/clara/recipe-generation");
  const { toFridgeItem } = await import("@/lib/clara/dish-output");
  const { MAIN_SAID_AIM, MAIN_SIZE_BAND } = await import("@/lib/clara/meal-target");
  const file = process.argv[2] ?? join(__dirname, ".snapshot", "clara-live-raw.json");
  const runs: { person: string; servings: number; system: string; output: unknown }[] = JSON.parse(readFileSync(file, "utf8"));
  const all: { said: number; target: number; declared: number; card: number; from: string }[] = [];
  console.log(`MAIN_SAID_AIM is ${MAIN_SAID_AIM}; the judge's band is ${MAIN_SIZE_BAND.min}–${MAIN_SIZE_BAND.max} of the target.\n`);
  console.log("| person | dish | said | target | declared | card | card/declared | card/target | calories from |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const run of runs) {
    const size = /should be about (\d+) kcal per serving[\s\S]*?no less than (\d+) kcal/.exec(run.system);
    const said = size ? Number(size[1]) : NaN;
    const target = size ? Number(size[2]) : NaN;
    let items: unknown[] = [];
    try {
      const parsed = typeof run.output === "string" ? JSON.parse(run.output) : run.output;
      const p = parsed as { dishes?: unknown; recipes?: unknown };
      items = Array.isArray(p?.dishes) ? p.dishes : Array.isArray(p?.recipes) ? p.recipes : [];
    } catch {
      /* an answer cut short: no candidates to price */
    }
    if (items.length === 0) console.log(`| ${run.person} | (no readable candidates) | ${said} | ${target} | | | | | |`);
    for (const item of items) {
      const raw = toFridgeItem(item, "Dinner", run.servings ?? 1);
      const r = raw ? (fridge.parseFridgeRecipes([raw], 1, "Dinner") ?? [])[0] : undefined;
      if (!r) {
        console.log(`| ${run.person} | ${(item as { name?: string })?.name ?? "?"} (did not parse) | ${said} | ${target} | | | | | |`);
        continue;
      }
      const declared = Math.round(r.perServing.calories);
      const priced = gen.pricedMacros(r);
      const card = Math.round(priced?.calories ?? gen.reconcileCalories(r) ?? r.perServing.calories);
      const from = dish.caloriesFrom(r);
      if (Number.isFinite(target)) all.push({ said, target, declared, card, from });
      console.log(`| ${run.person} | ${r.name} | ${said} | ${target} | ${declared} | ${card} | ${(card / declared).toFixed(2)} | ${Number.isFinite(target) ? (card / target).toFixed(2) : "?"} | ${from} |`);
    }
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const amounts = all.filter((x) => x.from === "amounts");
  console.log(`\nCandidates with a size line: ${all.length}; priced from their amounts: ${amounts.length}; from re-added macros: ${all.filter((x) => x.from === "macros").length}; the model's own figure: ${all.filter((x) => x.from === "declared").length}`);
  console.log(`card / declared, all: average ${avg(all.map((x) => x.card / x.declared)).toFixed(3)}, lowest ${Math.min(...all.map((x) => x.card / x.declared)).toFixed(2)}, highest ${Math.max(...all.map((x) => x.card / x.declared)).toFixed(2)}`);
  if (amounts.length) console.log(`card / declared, priced from amounts only: average ${avg(amounts.map((x) => x.card / x.declared)).toFixed(3)}`);
  console.log(`declared / said (does the model aim where it is told?): average ${avg(all.map((x) => x.declared / x.said)).toFixed(3)}`);
  console.log(`card / target: average ${avg(all.map((x) => x.card / x.target)).toFixed(3)}, lowest ${Math.min(...all.map((x) => x.card / x.target)).toFixed(2)}, highest ${Math.max(...all.map((x) => x.card / x.target)).toFixed(2)}`);
  console.log(`under the target: ${all.filter((x) => x.card < x.target).length}/${all.length}; under the band's floor (${MAIN_SIZE_BAND.min}): ${all.filter((x) => x.card < x.target * MAIN_SIZE_BAND.min).length}; over its ceiling (${MAIN_SIZE_BAND.max}): ${all.filter((x) => x.card > x.target * MAIN_SIZE_BAND.max).length}`);
  process.exit(0);
})();
