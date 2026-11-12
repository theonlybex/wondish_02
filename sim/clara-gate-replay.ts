// Offline replay of recorded live dish-model outputs (sim/.snapshot/clara-live-raw.json,
// written by sim/clara-live.sim.ts) through the product's dish gates, stage by
// stage, to say WHICH gate drops each candidate. No model call, no database.
//
//   node --experimental-test-module-mocks --import tsx sim/clara-gate-replay.ts [file]
import "./setup";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snap } from "./setup";
import { makePatient, type RuleKey } from "./profiles";
import { LIVE_PEOPLE } from "./clara-live-people";

(async () => {
  const fridge = await import("@/lib/fridge");
  const dish = await import("@/lib/clara/skills/dish");
  const gen = await import("@/lib/clara/recipe-generation");
  const pl = await import("@/lib/dish-plausibility");
  const { specifyCookingOil, oilAllowedBy } = await import("@/lib/clara/oil");
  const { loadIngredientGroups } = await import("@/lib/ingredient-catalog-db");
  const { derivePatientBans, buildDietMatchers } = await import("@/lib/diet-match");
  const { dailySodiumLimitMg } = await import("@/lib/sodium-limit");
  const file = process.argv[2] ?? join(__dirname, ".snapshot", "clara-live-raw.json");
  const runs: { person: string; servings: number; stop: string | null; output: any }[] = JSON.parse(readFileSync(file, "utf8"));
  const tokens = pl.catalogFoodVocabulary(snap.ingredients.map((i) => i.name));
  for (const run of runs) {
    const who = LIVE_PEOPLE.find((p) => p.id === run.person)!;
    const patient = makePatient(snap, { id: who.id, tier: "curated", rules: who.rules as RuleKey[] });
    const matchers = buildDietMatchers(derivePatientBans(patient as any));
    const sodiumLimitMg = dailySodiumLimitMg(patient.healthConditions.map((h: any) => h.condition.name));
    let recipesRaw = run.output?.recipes;
    const wasString = typeof recipesRaw === "string";
    const parsedAll = fridge.parseFridgeRecipes(recipesRaw, 3, "Dinner");
    console.log(`   parseFridgeRecipes → ${parsedAll === null ? "null (unusable)" : `${parsedAll.length} candidate(s)`}${wasString ? " — the model sent recipes as a JSON string" : ""}`);
    if (wasString) { try { recipesRaw = JSON.parse(recipesRaw); } catch { /* shown below */ } }
    console.log(`\n## ${run.person} (stop_reason ${run.stop}; recipes is ${Array.isArray(recipesRaw) ? `an array of ${recipesRaw.length}` : typeof recipesRaw})`);
    if (!Array.isArray(recipesRaw)) { console.log("   raw:", JSON.stringify(run.output).slice(0, 600)); continue; }
    for (const [i, item] of recipesRaw.entries()) {
      const name = item?.name ?? `#${i}`;
      const parsed = fridge.parseFridgeRecipes([item], 3, "Dinner") ?? [];
      if (parsed.length === 0) {
        const why = typeof item?.fitsPlan !== "boolean" ? `fitsPlan is ${JSON.stringify(item?.fitsPlan)}` : !Array.isArray(item?.steps) ? "steps not a list" : typeof item?.perServing !== "object" ? "perServing missing" : "other";
        console.log(`   ✗ ${name}: PARSE (${why}); keys ${Object.keys(item ?? {}).join(",")}`);
        continue;
      }
      const r0 = specifyCookingOil(parsed[0], oilAllowedBy(matchers));
      const groupsOf = await loadIngredientGroups([...r0.usesIngredients, ...r0.missingIngredients]);
      const stage = (() => {
        if (fridge.applyAllergenFilter([r0], matchers, groupsOf).length === 0) {
          const { evaluateDishAgainstProfile } = require("@/lib/diet-match");
          const v = evaluateDishAgainstProfile(r0.usesIngredients, matchers, r0.usesIngredients.map((n: string) => [...groupsOf(n)]));
          return `SAFETY (allergen/diet filter: ${v.violations.map((x: any) => `${x.ingredient}→${x.term}`).join(", ") || "text match in name/steps"})`;
        }
        if (!gen.passesSanity(r0)) {
          const p = r0.perServing; const d = p.protein * 4 + p.carbs * 4 + p.fat * 9;
          return `passesSanity (kcal ${p.calories}, 4/4/9 ${Math.round(d)} = ${Math.round((d / p.calories) * 100)}%, ${r0.usesIngredients.length} ingredients)`;
        }
        if ((r0.mealType ?? "").toLowerCase() !== "dinner") return `mealType "${r0.mealType}"`;
        const seen = new Set<string>();
        const prosed0 = gen.repairProse(r0, tokens, seen);
        if (!prosed0) return "repairProse (prose names a food not in the list)";
        const salted = pl.clampAddedSalt(prosed0.amounts ?? [], prosed0.perServing?.calories, sodiumLimitMg);
        const fatted = pl.clampCookingFat(salted.ingredients, prosed0.steps, prosed0.perServing?.calories);
        const r = salted.changed || fatted.changed ? { ...prosed0, amounts: fatted.ingredients } : prosed0;
        const cand = gen.toPlausibleDish(r, "Dinner");
        const priced = gen.pricedMacros(r);
        if (priced) { cand.macros = { protein: priced.protein, carbs: priced.carbs, fat: priced.fat }; cand.calories = priced.calories; }
        const prob = pl.dishProblem(cand, tokens);
        if (prob) return `dishProblem: ${prob}${priced ? ` (priced ${Math.round(priced.calories)} kcal vs stated ${r.perServing.calories})` : ""}`;
        if (gen.cooksWithUnlistedFat(r)) return "cooksWithUnlistedFat";
        const pd = gen.toPlausibleDish(r, "Dinner");
        const noQty = pd.ingredients.filter((x) => x.quantity == null).map((x) => x.name);
        if (noQty.length) return `ingredient without quantity: ${noQty.join(", ")}`;
        const badUnit = pd.ingredients.filter((x) => !gen.unitIsUsable(x.name, x.unit)).map((x) => `${x.name} [${x.unit}]`);
        if (badUnit.length) return `unit not usable: ${badUnit.join(", ")}`;
        if (run.servings > 1 && r.steps.some(dish.stepStatesAmount)) return `pickDish: a step states an amount (${r.steps.filter(dish.stepStatesAmount)[0]})`;
        return null;
      })();
      console.log(stage ? `   ✗ ${name}: ${stage}` : `   ✓ ${name}: passes every gate`);
    }
  }
})();
