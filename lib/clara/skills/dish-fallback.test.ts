// Fast, always-a-dish: the schema-constrained output reader, the library
// safety net and the time budget (docs/qa/clara-fast-dishes.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDishHandlers, forbiddenWordsForPrompt, dishSystemPrompt, COULDNT_FIT_NOTE, LIBRARY_NOTE, type DishDeps, type DishAsk } from "./dish";
import { DishItemExtractor, toFridgeItem, DISH_OUTPUT_SCHEMA } from "../dish-output";
import { rankLibrary, libraryToFridge, type LibraryRecipe } from "../dish-library";
import { parseFridgeRecipes, type FridgeRecipe } from "@/lib/fridge";
import { summarizeLevels, type LevelSummary } from "@/lib/levels";
import { buildDietMatchers, derivePatientBans, type PatientDietGraph } from "@/lib/diet-match";
import type { ClaraContext } from "../types";

const CTX: ClaraContext = { patientId: "p1", accountId: "a1", firstName: "Sam", isPremium: false, today: "2026-11-12", surface: "ios", disabledSkills: [] };
const NO_LOGS: LevelSummary = summarizeLevels([], null, { fromDate: "2026-11-06", toDate: "2026-11-12" });

function dish(name: string, overrides: Partial<FridgeRecipe> = {}): FridgeRecipe {
  return {
    id: `frg_${name}`,
    name,
    description: name,
    emoji: "",
    usesIngredients: ["red lentils", "spinach", "olive oil"],
    missingIngredients: [],
    steps: ["Simmer the red lentils in water for 15 minutes.", "Stir in the spinach and the olive oil."],
    mealType: "Dinner",
    servings: 1,
    perServing: { calories: 340, protein: 21, carbs: 50, fat: 6, fiber: 9 },
    fitsPlan: true,
    conflicts: [],
    prepMinutes: 5,
    cookMinutes: 20,
    amounts: [
      { name: "red lentils", quantity: 80, unit: "g" },
      { name: "spinach", quantity: 60, unit: "g" },
      { name: "olive oil", quantity: 1, unit: "teaspoon" },
    ],
    ...overrides,
  };
}

function deps(over: Partial<DishDeps>): DishDeps {
  return {
    loadSummary: async () => NO_LOGS,
    loggedMealTypes: async () => [],
    generate: async () => [],
    ...over,
  };
}
const dishOf = (res: any) => res.parts?.find((p: any) => p.kind === "dish");

// ─── the time budget and the library fallback ───────────────────────────────

test("a generated dish wins: served as generated, the library is never shown", async () => {
  const res: any = await makeDishHandlers(deps({ generate: async () => [dish("Model Stew")], library: async () => [dish("Library Stew")] })).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  assert.equal(dishOf(res).name, "Model Stew");
  assert.equal(res.data.dish.source, "generated");
  assert.equal(res.data.dish.note, undefined);
});

for (const [why, generate] of [
  ["returns nothing", async () => []],
  ["throws", async () => { throw new Error("529 overloaded"); }],
  ["returns only dishes the card refuses (too slow)", async () => [dish("Slow Stew", { prepMinutes: 30, cookMinutes: 90 })]],
] as [string, DishDeps["generate"]][]) {
  test(`the model ${why}: the library dish is served through the same card`, async () => {
    const res: any = await makeDishHandlers(deps({ generate, library: async () => [dish("Library Stew")] })).suggest(CTX, { mealType: "dinner", maxMinutes: 45 });
    assert.equal(res.ok, true);
    assert.equal(dishOf(res).name, "Library Stew");
    assert.deepEqual(res.parts.map((p: any) => p.kind), ["dish", "steps"]);
    assert.equal(res.data.dish.source, "library");
    assert.equal(res.data.dish.note, LIBRARY_NOTE);
    assert.match(LIBRARY_NOTE, /never say you made/);
  });
}

test("the model runs past the budget: aborted, and the library dish is served within the budget", async () => {
  let aborted = false;
  const generate: DishDeps["generate"] = (_c, _a, opts) =>
    new Promise((resolve) => {
      opts?.signal?.addEventListener("abort", () => { aborted = true; resolve([]); });
    });
  const t0 = Date.now();
  const res: any = await makeDishHandlers(deps({ generate, library: async () => [dish("Library Stew")], budgetMs: 80 })).suggest(CTX, { mealType: "dinner" });
  assert.equal(aborted, true);
  assert.equal(dishOf(res).name, "Library Stew");
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test("a generator that ignores the abort still cannot hold the person past budget + grace", async () => {
  const generate: DishDeps["generate"] = () => new Promise(() => {});
  const t0 = Date.now();
  const res: any = await makeDishHandlers(deps({ generate, library: async () => [dish("Library Stew")], budgetMs: 50 })).suggest(CTX, { mealType: "dinner" });
  assert.equal(dishOf(res).name, "Library Stew");
  assert.ok(Date.now() - t0 < 1000);
});

test("what the model gated before the deadline still counts", async () => {
  const generate: DishDeps["generate"] = (_c, _a, opts) =>
    new Promise((resolve) => opts?.signal?.addEventListener("abort", () => resolve([dish("Half-Read Stew")])));
  const res: any = await makeDishHandlers(deps({ generate, library: async () => [dish("Library Stew")], budgetMs: 40 })).suggest(CTX, { mealType: "dinner" });
  assert.equal(dishOf(res).name, "Half-Read Stew");
  assert.equal(res.data.dish.source, "generated");
});

test("both empty: the honest couldn't-make-one message, and only then", async () => {
  const res: any = await makeDishHandlers(deps({ generate: async () => [], library: async () => [] })).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, false);
  assert.equal(res.message, COULDNT_FIT_NOTE);
  const failing: any = await makeDishHandlers(deps({ generate: async () => [], library: async () => { throw new Error("db down"); } })).suggest(CTX, { mealType: "dinner" });
  assert.equal(failing.ok, false);
});

test("the generator is handed the card's own test, so it can stop at the first fit", async () => {
  let accept: ((r: FridgeRecipe) => boolean) | undefined;
  await makeDishHandlers(deps({ generate: async (_c, _a, o) => { accept = o?.accept; return []; } })).suggest(CTX, { mealType: "dinner", maxMinutes: 30 });
  assert.ok(accept);
  assert.equal(accept!(dish("Quick")), true);
  assert.equal(accept!(dish("Slow", { prepMinutes: 20, cookMinutes: 60 })), false);
});

test("dish_plan_today: each meal falls back on its own; the plan names nothing it could not fill", async () => {
  const generate: DishDeps["generate"] = async (_c, ask) => (ask.mealType === "breakfast" ? [dish("Model Oats", { mealType: "Breakfast", prepMinutes: 5, cookMinutes: 5 })] : []);
  const library: DishDeps["library"] = async (_c, ask) => (ask.mealType === "lunch" ? [dish("Library Salad", { mealType: "Lunch" })] : []);
  const res: any = await makeDishHandlers(deps({ generate, library })).planToday(CTX, {});
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.dishes.map((d: any) => [d.mealType, d.source]), [["breakfast", "generated"], ["lunch", "library"]]);
  assert.deepEqual(res.data.couldNotFill, ["dinner"]);
  assert.equal(res.data.dishes[1].note, LIBRARY_NOTE);
});

test("dish_plan_today: one ctx object per call, so the person is loaded once for all its dishes", async () => {
  const seen = new Set<ClaraContext>();
  await makeDishHandlers(deps({ generate: async (c) => { seen.add(c); return []; }, library: async (c) => { seen.add(c); return []; } })).planToday(CTX, {});
  assert.equal(seen.size, 1);
  assert.ok(!seen.has(CTX), "never the caller's own ctx: nothing carries over to a later call");
});

// ─── the schema-constrained output ──────────────────────────────────────────

test("DishItemExtractor yields each dish as its closing brace arrives, across any chunking", () => {
  const text = JSON.stringify({ dishes: [{ name: "A {curly} \"quoted\" [x]", steps: ["s}"] }, { name: "B", steps: [] }] });
  for (const size of [1, 3, 7, 1000]) {
    const ex = new DishItemExtractor();
    const got: any[] = [];
    for (let i = 0; i < text.length; i += size) got.push(...ex.push(text.slice(i, i + size)));
    assert.deepEqual(got.map((g) => g.name), ['A {curly} "quoted" [x]', "B"]);
  }
  const cut = new DishItemExtractor();
  assert.deepEqual(cut.push('{"dishes":[{"name":"whole"},{"name":"cut off'), [{ name: "whole" }]);
});

test("toFridgeItem: ingredients carry their own amounts, so every listed ingredient has one", () => {
  const raw = toFridgeItem(
    {
      name: "Lentil Stew", description: "Lentils.", prepMinutes: 5, cookMinutes: 20,
      ingredients: [{ name: " red lentils ", quantity: 80, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" }],
      steps: ["Simmer the red lentils for 20 minutes.", "Stir in the olive oil."],
      perServing: { calories: 330, protein: 20, carbs: 50, fat: 6, fiber: 9 },
    },
    "Dinner",
    4,
  );
  const [r] = parseFridgeRecipes([raw], 1, "Dinner")!;
  assert.deepEqual(r.usesIngredients, ["red lentils", "olive oil"]);
  assert.deepEqual(r.amounts, [{ name: "red lentils", quantity: 80, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" }]);
  assert.equal(r.mealType, "Dinner");
  assert.equal(r.servings, 4);
  assert.equal(toFridgeItem("not an object", "Dinner", 1), null);
});

test("the output schema is strict: every object closes and requires all of its keys", () => {
  const walk = (node: any): void => {
    if (node?.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node?.type === "array") walk(node.items);
  };
  walk(DISH_OUTPUT_SCHEMA);
});

// ─── forbidden words in the prompt ──────────────────────────────────────────

const graph = (over: Partial<PatientDietGraph>): PatientDietGraph =>
  ({ foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [], ...over }) as PatientDietGraph;

test("forbidden words come from the same ban data as the gate, and the prompt rules out plant versions", () => {
  const bans = derivePatientBans(graph({ foodAllergies: [{ food: { name: "Dairy", bannedIngredients: [{ name: "milk" }, { name: "butter" }, { name: "cream" }] } }] } as any));
  const words = forbiddenWordsForPrompt(bans, buildDietMatchers(bans));
  for (const w of ["milk", "butter", "cream"]) assert.ok(words.includes(w), w);
  const prompt = dishSystemPrompt({ ask: { mealType: "dinner", summary: NO_LOGS } as DishAsk, foodMapText: "", bannedNames: words, proteinOptions: [], sodiumLimitMg: 2300 });
  assert.match(prompt, /FORBIDDEN WORDS/);
  assert.match(prompt, /"coconut milk"/);
  assert.match(prompt, /milk, butter, cream/);
});

// ─── the library ranking ────────────────────────────────────────────────────

function lib(id: string, names: [string, string[]?][], over: Partial<LibraryRecipe> = {}): LibraryRecipe {
  return {
    id, name: `Recipe ${id}`, steps: ["Cook the food for 10 minutes.", "Serve."],
    calories: 400, protein: 25, carbs: 45, fat: 12, fiber: 6, sodium: null, prepTime: 10, cookTime: 15, servings: 1,
    ingredients: names.map(([name, allergenGroups]) => ({ quantity: 50, unit: "g", ingredient: { name, allergenGroups: allergenGroups ?? [] } })),
    ...over,
  };
}
const NONE = { recipeIds: new Set<string>(), names: new Set<string>() };
const noAmounts = () => false;

test("rankLibrary applies the planner's rule filter: banned names AND stored allergen groups are out", () => {
  const bans = derivePatientBans(graph({ foodAllergies: [{ food: { name: "Dairy", bannedIngredients: [{ name: "milk" }] } }] } as any));
  const pool = [
    lib("named", [["whole milk"], ["oats"]]),
    lib("grouped", [["ghee", ["BIG9-COW-MILK"]], ["rice"]]),
    lib("ok", [["oats"], ["blueberries"]]),
  ];
  const ranked = rankLibrary(pool, { mealType: "dinner", little: [], aLot: [] }, { patient: {} as any, matchers: buildDietMatchers(bans), seed: "s" }, NONE, noAmounts);
  assert.deepEqual(ranked.map((r) => r.id), ["ok"]);
});

test("rankLibrary drops disliked, recent, incomplete (no amount, no or impossible fibre figure) recipes", () => {
  const m = buildDietMatchers(derivePatientBans(graph({})));
  const pool = [
    lib("disliked", [["oats"], ["pear"]]),
    lib("recent", [["oats"], ["pear"]]),
    lib("noqty", [["oats"], ["pear"]], { ingredients: [{ quantity: null, unit: null, ingredient: { name: "oats" } }, { quantity: 1, unit: "", ingredient: { name: "pear" } }] }),
    lib("nofibre", [["oats"], ["pear"]], { fiber: null }),
    lib("fibre above carbs", [["oats"], ["pear"]], { fiber: 90 }),
    lib("keep", [["oats"], ["pear"]]),
  ];
  const ranked = rankLibrary(pool, { mealType: "dinner", little: [], aLot: [] }, { patient: { dishPreferences: [{ recipeId: "disliked" }] } as any, matchers: m, seed: "s" }, { recipeIds: new Set(["recent"]), names: new Set() }, noAmounts);
  assert.deepEqual(ranked.map((r) => r.id), ["keep"]);
});

test("rankLibrary prefers a fibre-rich dish when they get little fibre, and steps without amounts for several people", () => {
  const m = buildDietMatchers(derivePatientBans(graph({})));
  const pool = [lib("plain", [["chicken breast"], ["white rice"]]), lib("lentil", [["lentils"], ["spinach"]])];
  const fibre = rankLibrary(pool, { mealType: "dinner", little: ["fibre"], aLot: [] }, { patient: {} as any, matchers: m, seed: "s" }, NONE, noAmounts);
  assert.equal(fibre[0].id, "lentil");
  const withAmounts = lib("amounts", [["lentils"], ["spinach"]], { steps: ["Add 80 g lentils.", "Serve."] });
  const guests = rankLibrary([withAmounts, lib("clean", [["chicken breast"], ["rice"]])], { mealType: "dinner", servings: 6, little: ["fibre"], aLot: [] }, { patient: {} as any, matchers: m, seed: "s" }, NONE, (s) => /\d+ g/.test(s));
  assert.equal(guests[0].id, "clean");
});

test("libraryToFridge: per-serving amounts from the stored rows, the stored steps and macros", () => {
  const r = libraryToFridge(lib("two", [["lentils"], ["spinach"]], { servings: 2, calories: 800, fiber: 12 }), "Dinner", 1, "frg_x");
  assert.deepEqual(r.amounts, [{ name: "lentils", quantity: 25, unit: "g" }, { name: "spinach", quantity: 25, unit: "g" }]);
  assert.equal(r.perServing.calories, 400);
  assert.equal(r.perServing.fiber, 6);
  assert.deepEqual(r.steps, ["Cook the food for 10 minutes.", "Serve."]);
  assert.equal(r.id, "frg_x");
});

// I1: a multi-serving recipe's steps state WHOLE-recipe amounts ("add 1 teaspoon salt"); the card lists one
// serving (¼ teaspoon). Served to one person, the steps and the card would disagree — in cook mode too.
test("rankLibrary never offers one person a multi-serving recipe whose steps state amounts", () => {
  const m = buildDietMatchers(derivePatientBans(graph({})));
  const statesAmount = (s: string) => /\d+ (teaspoon|g)\b/.test(s);
  const four = (id: string, steps: string[]) => lib(id, [["lentils"], ["spinach"]], { servings: 4, calories: 1600, carbs: 180, fiber: 24, steps });
  const pool = [
    four("amounts", ["Simmer 200 g lentils for 20 minutes.", "Add 1 teaspoon salt."]),
    four("no amounts", ["Simmer the lentils for 20 minutes.", "Stir in the spinach."]),
  ];
  const one = rankLibrary(pool, { mealType: "dinner", little: [], aLot: [] }, { patient: {} as any, matchers: m, seed: "s" }, NONE, statesAmount);
  assert.deepEqual(one.map((r) => r.id), ["no amounts"]);
  const six = rankLibrary(pool, { mealType: "dinner", servings: 6, little: [], aLot: [] }, { patient: {} as any, matchers: m, seed: "s" }, NONE, statesAmount);
  assert.deepEqual(six.map((r) => r.id), ["no amounts"], "for several people, steps never state amounts");
  const single = lib("one serving", [["lentils"], ["spinach"]], { steps: ["Simmer 50 g lentils for 20 minutes.", "Serve."] });
  assert.deepEqual(rankLibrary([single], { mealType: "dinner", little: [], aLot: [] }, { patient: {} as any, matchers: m, seed: "s" }, NONE, statesAmount).map((r) => r.id), ["one serving"], "a one-serving recipe's amounts are per serving: fine for one");
});

test("once a generated dish is served, the library's signal fires (no more library work)", async () => {
  let librarySignal: AbortSignal | undefined;
  const res: any = await makeDishHandlers(deps({
    generate: async () => [dish("Model Stew")],
    library: async (_c, _a, signal) => { librarySignal = signal; return [dish("Library Stew")]; },
  })).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.data.dish.source, "generated");
  assert.equal(librarySignal?.aborted, true);
});

test("when the library dish is served, its signal never fired", async () => {
  let librarySignal: AbortSignal | undefined;
  await makeDishHandlers(deps({ generate: async () => [], library: async (_c, _a, signal) => { librarySignal = signal; return [dish("Library Stew")]; } })).suggest(CTX, { mealType: "dinner" });
  assert.equal(librarySignal?.aborted, false);
});
