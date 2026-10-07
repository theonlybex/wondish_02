// Targeted simulation checks for every change shipped on 2026-10-07, against
// the read-only snapshot (so the DATA fixes are checked as they now stand in
// the shared DB) and the real code. Complements rules.sim.ts, which sweeps
// every rule combination; these pin each addition by name.
//
//   npm run sim:rules   (runs both files; re-run npm run sim:snapshot first)
import "./setup"; // mocks + snapshot + fake Prisma — must load before any service
import { test } from "node:test";
import assert from "node:assert/strict";
import { snap, state, ingByName } from "./setup";
import { buildProfiles, makePatient, ruleUniverse, type Profile, type RuleKey } from "./profiles";

const profile = (rules: RuleKey[]): Profile => ({ id: `add:${rules.join("+").replace(/[^a-z0-9+]+/gi, "_")}`, tier: "curated", rules });
const asDiner = (rules: RuleKey[]) => {
  const p = makePatient(snap, profile(rules));
  state.patient = p;
  return p;
};
const json = async (res: Response) => {
  assert.ok(res.ok, `HTTP ${res.status}`);
  return res.json();
};
const quietly = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const { log, warn, info } = console;
  console.log = console.warn = console.info = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, warn, info }); }
};
// Every profile that is not a pair: each rule alone, real users, heavy combos, everything.
const PROFILES = buildProfiles(snap, { pairs: false });

// ── 1. What to buy + Banned ingredients panel ────────────────────────────────
test("1 · Banned-ingredients panel never lies: hidden ⇔ engine bans it, every reason names one of the diner's rules", async () => {
  const catalog = await import("@/app/api/pantry/catalog/route");
  const { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile } = await import("@/lib/diet-match");
  for (const p of PROFILES) {
    const patient = asDiner(p.rules);
    const { categories, bans } = await quietly(async () => json(await catalog.GET()));
    const matchers = buildDietMatchers(derivePatientBans(patient as any));
    const labels = new Set([...bans.rules.map((r: any) => r.label), "Your profile"]);
    for (const it of categories.flatMap((c: any) => c.items)) {
      const engineBans = !evaluateDishAgainstProfile([it.name], matchers, [ingByName.get(it.name.toLowerCase())?.allergenGroups ?? []]).passed;
      assert.equal(Boolean(it.bannedBy), engineBans, `${p.id}: "${it.name}" hidden=${Boolean(it.bannedBy)} but engine says ${engineBans}`);
      for (const why of it.bannedBy ?? []) assert.ok(labels.has(why), `${p.id}: reason "${why}" is not one of the diner's rules`);
    }
  }
});

test("1 · a vegetarian's What-to-buy (all three lenses) offers no meat or fish", async () => {
  const catalog = await import("@/app/api/pantry/catalog/route");
  const toBuy = await import("@/app/api/pantry/to-buy/route");
  const { buildCuisineChecklists } = await import("@/lib/cuisine-ingredients");
  asDiner(["diet:Vegetarian"]);
  const { categories, bans } = await quietly(async () => json(await catalog.GET()));
  const proteins = categories.find((c: any) => c.key === "proteins").items.filter((i: any) => !i.bannedBy).map((i: any) => i.name);
  assert.deepEqual(proteins, ["Extra-firm tofu"]);
  const staples = buildCuisineChecklists([], new Set(Object.keys(bans.cuisineStaples))).flatMap((c) => c.staples.map((s) => s.name));
  for (const meat of ["chicken", "beef", "fish sauce"]) assert.ok(!staples.includes(meat), `cuisine lens offers ${meat}`);
  state.pantryIds = [];
  const { items } = await quietly(async () => json(await toBuy.GET()));
  const meaty = items.map((i: any) => i.name).filter((n: string) => /\b(chicken|beef|pork|bacon|salmon|tuna|shrimp|turkey|steak)\b/i.test(n));
  assert.deepEqual(meaty, []);
});

// ── 2/3. Allergen groups everywhere; diets imply groups ──────────────────────
test("2 · component bans reach the planner's gates: wheat allergy never gets oats, vegan never gets egg-made meatless strips", async () => {
  const mealPlan = await import("@/lib/meal-plan");
  const fake = (globalThis as any).prisma;
  const library = await fake.recipe.findMany({ where: { isPublic: true } });
  const cases: [RuleKey, string][] = [["allergy:Wheat", "Rolled oats"], ["diet:Vegan", "meatless beef strips"], ["condition:Celiac Disease", "whole grain cracker crumbs"]];
  for (const [rule, item] of cases) {
    const patient = asDiner([rule]);
    const withItem = library.filter((r: any) => r.ingredients.some((ri: any) => ri.ingredient.name.toLowerCase() === item.toLowerCase()));
    assert.ok(withItem.length > 0, `library has no dish with ${item} — case is vacuous`);
    const accepted = withItem.filter((r: any) => mealPlan.validateSwapCandidate(patient as any, { mealTypeId: r.mealTypeId }, r, []).ok);
    assert.deepEqual(accepted.map((r: any) => r.name), [], `${rule}: swap gate accepts dishes with ${item}`);
  }
});

// ── 3. Clara's post-filter: groups + grain rule + Paleo ──────────────────────
test("3 · Clara's post-filter drops group-tagged and grain-rule items (the 333-violation classes)", async () => {
  const { applyAllergenFilter } = await import("@/lib/fridge");
  const { loadIngredientGroups } = await import("@/lib/ingredient-catalog-db");
  const { derivePatientBans, buildDietMatchers } = await import("@/lib/diet-match");
  const dish = (ing: string) => ({ id: ing, name: "Chef's bowl", description: "", emoji: "", usesIngredients: [ing], missingIngredients: [], steps: ["Cook."], mealType: "Lunch", servings: 1, perServing: { calories: 400, protein: 20, carbs: 40, fat: 10 }, fitsPlan: true, conflicts: [] });
  const cases: [RuleKey, string][] = [
    ["diet:Keto", "gluten-free bread"], ["diet:Paleo", "Potato & tapioca gluten-free crackers"],
    ["condition:Celiac Disease", "Orzo pasta"], ["allergy:Soy", "Mayonnaise"], ["allergy:Wheat", "Rolled oats"], ["diet:Vegan", "meatless beef strips"],
  ];
  for (const [rule, ing] of cases) {
    const matchers = buildDietMatchers(derivePatientBans(asDiner([rule]) as any));
    const survivors = applyAllergenFilter([dish(ing)] as any, matchers, await loadIngredientGroups([ing]));
    assert.equal(survivors.length, 0, `${rule}: Clara dish with "${ing}" survived`);
  }
});

// ── 4. Cooking oil ───────────────────────────────────────────────────────────
test("4 · the library no longer says 'cooking oil' (backfill applied)", () => {
  const generic = new Set(["cooking oil", "oil", "cooking spray", "nonstick cooking spray", "oil spray"]);
  const genericIds = new Set(snap.ingredients.filter((i) => generic.has(i.name.trim().toLowerCase())).map((i) => i.id));
  const linked = snap.recipes.filter((r) => r.ingredients.some((ri) => genericIds.has(ri.ingredientId)));
  assert.equal(linked.length, 0, `${linked.length} dishes still list a generic oil, e.g. ${linked.slice(0, 3).map((r) => r.name).join(", ")}`);
  const said = snap.recipes.filter((r) => /\bcooking oil\b|\bcooking spray\b/i.test([...(r.steps ?? []), r.description ?? ""].join(" ")));
  assert.equal(said.length, 0, `${said.length} dishes still say cooking oil/spray, e.g. ${said.slice(0, 3).map((r) => r.name).join(", ")}`);
});

test("4 · the oil the repair picks is allowed for every diner, and Clara is never offered 'cooking oil'", async () => {
  const { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile } = await import("@/lib/diet-match");
  const { freeStaplesFor } = await import("@/lib/clara/recipe-generation");
  for (const p of PROFILES) {
    const matchers = buildDietMatchers(derivePatientBans(makePatient(snap, p) as any));
    for (const oil of ["Extra virgin olive oil", "Avocado oil", "olive oil", "avocado oil"]) {
      // "everything" bans whatever any list bans — only flag oils a real rule set forbids.
      if (p.tier === "everything") continue;
      assert.ok(evaluateDishAgainstProfile([oil], matchers, [ingByName.get(oil.toLowerCase())?.allergenGroups ?? []]).passed, `${p.id}: repair would inject banned "${oil}"`);
    }
    assert.ok(!freeStaplesFor(matchers).includes("cooking oil"));
  }
});

// ── 5. Ingredient tag fixes ──────────────────────────────────────────────────
test("5 · crushed tomatoes are soy-free and offered to a soy allergy; soy sauce is wheat-tagged and hidden from wheat/celiac", async () => {
  assert.deepEqual(ingByName.get("crushed tomatoes")?.allergenGroups, []);
  assert.ok(ingByName.get("soy sauce")?.allergenGroups.includes("BIG9-WHEAT"));
  const catalog = await import("@/app/api/pantry/catalog/route");
  const item = async (rules: RuleKey[], name: string) => {
    asDiner(rules);
    const { categories } = await quietly(async () => json(await catalog.GET()));
    return categories.flatMap((c: any) => c.items).find((i: any) => i.name === name);
  };
  assert.equal((await item(["allergy:Soy"], "Crushed tomatoes")).bannedBy, undefined);
  assert.ok((await item(["allergy:Wheat"], "Soy sauce")).bannedBy?.length);
  assert.ok((await item(["condition:Celiac Disease"], "Soy sauce")).bannedBy?.length);
});

// ── 6. Researched condition ban lists ────────────────────────────────────────
test("6 · the three researched ban lists are in the DB and enforced", async () => {
  const cond = (n: string) => snap.rules.conditions.find((c) => c.name === n)!;
  assert.ok(cond("Cancer – during treatment").bannedIngredients.length >= 17);
  assert.ok(cond("IBD – active").bannedIngredients.length >= 24);
  assert.ok(cond("Chronic Diarrhea").bannedIngredients.length >= 6);
  const catalog = await import("@/app/api/pantry/catalog/route");
  asDiner(["condition:IBD – active"]);
  const { categories } = await quietly(async () => json(await catalog.GET()));
  const hidden = categories.flatMap((c: any) => c.items).filter((i: any) => i.bannedBy).map((i: any) => i.name);
  for (const n of ["Walnuts", "Sesame seeds", "Chia seeds", "Raisins"]) assert.ok(hidden.includes(n), `IBD – active still offers ${n}`);
  const { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile } = await import("@/lib/diet-match");
  const chemo = buildDietMatchers(derivePatientBans(asDiner(["condition:Cancer – during treatment"]) as any));
  for (const n of ["salmon sushi", "smoked salmon", "raw milk", "alfalfa sprouts", "sliced deli turkey"]) assert.ok(!evaluateDishAgainstProfile([n], chemo).passed, `chemo diner allowed "${n}"`);
  const diarrhea = buildDietMatchers(derivePatientBans(asDiner(["condition:Chronic Diarrhea"]) as any));
  for (const n of ["sorbitol", "sugar-free gum"]) assert.ok(!evaluateDishAgainstProfile([n], diarrhea).passed);
});

// ── 7. AERD and Rosacea trials ───────────────────────────────────────────────
test("7 · AERD and Rosacea have their trigger rules, and an enforced cinnamon trial removes cinnamon everywhere", async () => {
  const { TRIGGER_CATEGORY_TERMS } = await import("@/lib/trials/category-terms");
  const rules = (name: string) => snap.rules.triggerRules.filter((r) => r.condition.name === name).map((r) => r.category).sort();
  assert.deepEqual(rules("Aspirin-Exacerbated Respiratory Disease (AERD)"), ["ALCOHOL"]);
  assert.deepEqual(rules("Rosacea"), ["ACIDIC_CITRUS", "ACIDIC_TOMATO", "ALCOHOL", "CHOCOLATE", "CINNAMALDEHYDE", "HISTAMINE_TYRAMINE_RICH", "SPICY"]);
  for (const r of snap.rules.triggerRules) assert.ok(TRIGGER_CATEGORY_TERMS[r.category]?.terms.length, `${r.code}: category ${r.category} has no terms`);

  const catalog = await import("@/app/api/pantry/catalog/route");
  const mealPlan = await import("@/lib/meal-plan");
  const patient = asDiner(["condition:Rosacea", "trial:CINNAMALDEHYDE"]);
  const { categories } = await quietly(async () => json(await catalog.GET()));
  assert.ok(categories.flatMap((c: any) => c.items).find((i: any) => i.name === "Ground cinnamon")?.bannedBy?.length);
  const out = await quietly(() => mealPlan.buildMealPlanMenus(patient.id, new Date("2026-10-05T00:00:00"), 1, { windowDays: 7 }));
  const cinnamon = snap.recipes.filter((r) => out.rows.some((row: any) => row.recipeId === r.id) && r.ingredients.some((ri) => /cinnamon/i.test(snap.ingredients.find((i) => i.id === ri.ingredientId)?.name ?? "")));
  assert.deepEqual(cinnamon.map((r) => r.name), []);
});

// ── 8. Profile condition groups ──────────────────────────────────────────────
test("8 · every live condition appears in a named profile group (none in Other, none twice)", async () => {
  const { groupConditions, OTHER_GROUP_TITLE } = await import("@/lib/condition-groups");
  const groups = groupConditions(snap.rules.conditions.map((c, i) => ({ id: String(i), name: c.name })));
  assert.deepEqual(groups.find((g) => g.title === OTHER_GROUP_TITLE)?.options.map((o) => o.name) ?? [], []);
  assert.equal(groups.flatMap((g) => g.options).length, snap.rules.conditions.length);
});

// ── 9. Condition guidance (Stroke + fixed keys) ──────────────────────────────
test("9 · every guidance entry reaches Clara's prompt for its live condition, Stroke included", async () => {
  const { CONDITION_GUIDANCE, buildFoodMapText } = await import("@/lib/food-map");
  const live = new Map(snap.rules.conditions.map((c) => [c.name.trim().toLowerCase(), c.name]));
  for (const [key, text] of Object.entries(CONDITION_GUIDANCE)) {
    const name = live.get(key);
    assert.ok(name, `guidance key "${key}" matches no live condition — it would never reach Clara`);
    const prompt = buildFoodMapText({ ...makePatient(snap, profile([`condition:${name}` as RuleKey])), mealType: null } as any);
    assert.ok(prompt.includes(text), `${name}: guidance missing from the prompt`);
  }
  assert.match(CONDITION_GUIDANCE["stroke"], /Mediterranean/);
  // The universe the main sweep uses still sees every rule.
  assert.ok(ruleUniverse(snap).all.includes("condition:Stroke"));
});

// ── 10. Live trials: blocked exactly in the enforced phases ──────────────────
// The sweep models a finished trial ("likely trigger", always enforced). A
// running trial moves BASELINE → ELIMINATION → EVALUATION → REINTRODUCTION →
// WASHOUT → FINAL; the food must be off the list exactly when the phase is
// enforced and back on during baseline and the reintroduction challenge.
test("10 · an active trial blocks its food in exactly the enforced phases (shopping catalog and the engine every service uses)", async () => {
  const { phaseFor, isEnforced, PHASE_ORDER, addDays } = await import("@/lib/trials/schedule");
  const catalog = await import("@/app/api/pantry/catalog/route");
  const { derivePatientBans, buildDietMatchers, evaluateDishAgainstProfile } = await import("@/lib/diet-match");
  const cases: { condition: RuleKey; category: string; item: string }[] = [
    { condition: "condition:Rosacea", category: "CINNAMALDEHYDE", item: "Ground cinnamon" },
    { condition: "condition:IBS-D", category: "FODMAP_FRUCTANS", item: "Garlic" },
    { condition: "condition:Migraine", category: "AGED_CHEESE", item: "Grated parmesan" },
  ];
  const today = new Date();
  for (const c of cases) {
    const rule = snap.rules.triggerRules.find((r) => r.category === c.category && r.condition.name === c.condition.slice("condition:".length)) ?? snap.rules.triggerRules.find((r) => r.category === c.category)!;
    const seen = new Set<string>();
    for (let offset = -10; offset <= 60; offset++) {
      const startDate = addDays(today, -offset);
      const { phase } = phaseFor(rule, startDate, today);
      if (seen.has(phase)) continue;
      seen.add(phase);
      const patient = { ...makePatient(snap, profile([c.condition])), triggerTrials: [{ status: "ACTIVE" as const, classification: null, startDate, rule }] };
      state.patient = patient;
      const { categories } = await quietly(async () => json(await catalog.GET()));
      const hit = categories.flatMap((x: any) => x.items).find((i: any) => i.name === c.item);
      assert.ok(hit, `${c.item} not in the catalog — case is vacuous`);
      const blocked = Boolean(hit.bannedBy?.length);
      assert.equal(blocked, isEnforced(phase), `${c.category} in ${phase}: "${c.item}" blocked=${blocked}, enforced=${isEnforced(phase)}`);
      const engineBlocks = !evaluateDishAgainstProfile([c.item], buildDietMatchers(derivePatientBans(patient as any, today)), [ingByName.get(c.item.toLowerCase())?.allergenGroups ?? []]).passed;
      assert.equal(engineBlocks, isEnforced(phase), `${c.category} in ${phase}: engine disagrees`);
    }
    assert.deepEqual([...seen].sort(), [...PHASE_ORDER].sort(), `${c.category}: not every phase was reached`);
  }
  // A STOPPED trial bans nothing.
  const stopped = { ...makePatient(snap, profile(["condition:Rosacea"])), triggerTrials: [{ status: "STOPPED" as const, classification: null, startDate: addDays(today, -10), rule: snap.rules.triggerRules.find((r) => r.category === "CINNAMALDEHYDE")! }] };
  assert.ok(evaluateDishAgainstProfile(["Ground cinnamon"], buildDietMatchers(derivePatientBans(stopped as any, today))).passed);
});

// ── 11. Custom conditions ────────────────────────────────────────────────────
test("11 · a user's own condition: its avoid list is enforced everywhere, its note reaches Clara, its trial behaves like a built-in", async () => {
  const catalog = await import("@/app/api/pantry/catalog/route");
  const cookable = await import("@/app/api/pantry/cookable/route");
  const mealPlan = await import("@/lib/meal-plan");
  const { buildFoodMapText } = await import("@/lib/food-map");
  const { customTriggerRuleData } = await import("@/lib/custom-conditions");
  const { addDays } = await import("@/lib/trials/schedule");
  const custom = { condition: { name: "My gut thing", ownerPatientId: "sim-owner", guidance: "no mushrooms, please", bannedIngredients: [{ name: "mushrooms" }] } };
  // Elimination: day 3 of a custom SPICY trial (custom rules use the workbook schedule).
  const spicy = { ...customTriggerRuleData("SPICY", ["Heartburn"]), code: "CUST-TR-sim" };
  const base = makePatient(snap, profile(["goal:Eat healthier"]));
  const patient = { ...base, healthConditions: [...base.healthConditions, custom], triggerTrials: [{ status: "ACTIVE" as const, classification: null, startDate: addDays(new Date(), -2), rule: spicy }] };
  state.patient = patient;

  const { categories, bans } = await quietly(async () => json(await catalog.GET()));
  const items = categories.flatMap((c: any) => c.items);
  assert.deepEqual(items.find((i: any) => i.name === "Mushrooms")?.bannedBy, ["My gut thing"]);
  assert.ok(items.find((i: any) => i.name === "Jalapeño peppers")?.bannedBy?.length, "custom SPICY trial not enforced");
  assert.ok(bans.rules.some((r: any) => r.label === "My gut thing" && r.terms.includes("mushrooms")));

  state.pantryIds = snap.ingredients.map((i) => i.id);
  const ck = await quietly(async () => json(await cookable.GET()));
  state.pantryIds = [];
  const served = [...ck.ready, ...ck.almost].map((d: any) => d.id);
  const week = await quietly(() => mealPlan.buildMealPlanMenus(patient.id, new Date("2026-10-05T00:00:00"), 1, { windowDays: 7 }));
  const ids = new Set([...served, ...week.rows.map((r: any) => r.recipeId)]);
  const withMushrooms = snap.recipes.filter((r) => ids.has(r.id) && r.ingredients.some((ri) => /mushroom/i.test(snap.ingredients.find((i) => i.id === ri.ingredientId)?.name ?? "")));
  assert.deepEqual(withMushrooms.map((r) => r.name), []);

  const prompt = buildFoodMapText({ ...patient, mealType: null } as any);
  assert.match(prompt, /My gut thing \(the diner's own note\): "no mushrooms, please"/);
});
