// Fast, always-a-dish: the schema-constrained output reader, the library
// safety net and the time budget (docs/qa/clara-fast-dishes.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDishHandlers, forbiddenWordsForPrompt, dishSystemPrompt, COULDNT_FIT_NOTE, LIBRARY_NOTE, requestAnsweredNote, couldntMakeRequestNote, type DishDeps, type DishAsk } from "./dish";
import { DishItemExtractor, toFridgeItem, DISH_OUTPUT_SCHEMA } from "../dish-output";
import { rankLibrary, libraryToFridge, matchesRequest, requestNamedIn, type LibraryRecipe } from "../dish-library";
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

// ─── wants: the library serves a requested dish only when it matches ────────

test("matchesRequest: every content word of the request is in the name or the ingredients", () => {
  assert.equal(matchesRequest("eggs", "Soft Scrambled Egg on Toast", ["bread"]), true, "plural/singular");
  assert.equal(matchesRequest("eggs", "Spinach Frittata", ["eggs", "spinach"]), true, "in the ingredients");
  assert.equal(matchesRequest("eggs", "Roasted Eggplant", ["eggplant", "olive oil"]), false, "eggplant is not egg");
  assert.equal(matchesRequest("scrambled eggs", "Egg Fried Rice", ["eggs", "rice"]), false, "every word, not any word");
  assert.equal(matchesRequest("a chicken stir-fry", "Stir-Fried Chicken with Broccoli", ["chicken breast", "broccoli"]), true);
  assert.equal(matchesRequest("help me make some pancakes please", "Buckwheat Pancake Stack", ["buckwheat flour"]), true, "filler words do not count");
  assert.equal(matchesRequest("lentil soup", "Red Lentil and Spinach Stew", ["red lentils", "spinach"]), false);
  assert.equal(matchesRequest("salmon", "Red Lentil and Spinach Stew", ["red lentils", "spinach"]), false);
  assert.equal(matchesRequest("something quick", "Red Lentil and Spinach Stew", ["red lentils"]), true, "a request that names no food rules nothing out");
  assert.equal(requestNamedIn("eggs", "Spinach Frittata"), false);
  assert.equal(requestNamedIn("eggs", "Baked Eggs with Tomato"), true);
});

test("rankLibrary with wants: only recipes that match the request, name matches first; none matching → nothing", () => {
  const m = buildDietMatchers(derivePatientBans(graph({})));
  const pool = [
    lib("stew", [["lentils"], ["spinach"]], { name: "Lentil Stew" }),
    lib("muffin", [["eggs"], ["oats"]], { name: "Oat Muffins" }),
    lib("scramble", [["eggs"], ["spinach"]], { name: "Scrambled Eggs with Spinach" }),
  ];
  const person = { patient: {} as any, matchers: m, seed: "s" };
  const eggs = rankLibrary(pool, { mealType: "dinner", little: [], aLot: [], wants: "eggs" }, person, NONE, noAmounts);
  assert.deepEqual(eggs.map((r) => r.id), ["scramble", "muffin"]);
  assert.deepEqual(rankLibrary(pool, { mealType: "dinner", little: [], aLot: [], wants: "salmon" }, person, NONE, noAmounts), []);
  // No wants: the whole pool, exactly as before.
  assert.equal(rankLibrary(pool, { mealType: "dinner", little: [], aLot: [] }, person, NONE, noAmounts).length, 3);
});

test("rankLibrary with wants never relaxes the rule filter: a matching recipe with a banned ingredient stays out", () => {
  const bans = derivePatientBans(graph({ foodAllergies: [{ food: { name: "Dairy", bannedIngredients: [{ name: "milk" }] } }] } as any));
  const pool = [lib("milky", [["whole milk"], ["oats"]], { name: "Oat Porridge" }), lib("plain", [["oats"], ["blueberries"]], { name: "Oat Bowl" })];
  const ranked = rankLibrary(pool, { mealType: "breakfast", little: [], aLot: [], wants: "oats" }, { patient: {} as any, matchers: buildDietMatchers(bans), seed: "s" }, NONE, noAmounts);
  assert.deepEqual(ranked.map((r) => r.id), ["plain"]);
});

test("wants + the model serves nothing: a library dish that matches the request is served, as a library dish", async () => {
  const library: DishDeps["library"] = async () => [dish("Chicken Rice Bowl"), dish("Red Lentil Stew")];
  const res: any = await makeDishHandlers(deps({ library })).suggest(CTX, { mealType: "dinner", wants: "lentil stew" });
  assert.equal(res.ok, true);
  assert.equal(dishOf(res).name, "Red Lentil Stew", "the unrelated first library dish is skipped");
  assert.equal(res.data.dish.source, "library");
  assert.equal(res.data.dish.note, LIBRARY_NOTE);
  assert.equal(res.data.dish.answersRequest, true);
  assert.equal(res.data.request, requestAnsweredNote("lentil stew"));
});

test("wants + the model serves nothing + no library recipe matches: no unrelated dish, the couldn't-make-that result", async () => {
  const library: DishDeps["library"] = async () => [dish("Library Stew")];
  const res: any = await makeDishHandlers(deps({ library })).suggest(CTX, { mealType: "dinner", wants: "pancakes" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "FAILED");
  assert.equal(res.message, couldntMakeRequestNote("pancakes"));
  assert.equal(res.parts, undefined);
  // The same library, asked without wants, still serves its dish (unchanged).
  const plain: any = await makeDishHandlers(deps({ library })).suggest(CTX, { mealType: "dinner" });
  assert.equal(dishOf(plain).name, "Library Stew");
  assert.equal(plain.data.request, undefined);
});

test("wants reaches the library with the ask", async () => {
  let asked: DishAsk | undefined;
  await makeDishHandlers(deps({ library: async (_c, a) => { asked = a; return []; } })).suggest(CTX, { mealType: "dinner", wants: "eggs" });
  assert.equal(asked?.wants, "eggs");
});

// A gate can rename a dish from its ingredients (repairProse), losing the word they asked for
// ("Almond Flour Pancakes" → "Eggs with Greek Yogurt and Almond Flour", seen live). The pick
// prefers a dish that still says the request; nothing is relaxed for it.
test("wants: a generated dish that says the request is preferred over an earlier one that does not", async () => {
  const generate: DishDeps["generate"] = async () => [dish("Eggs with Yogurt and Almond Flour"), dish("Almond Flour Pancakes")];
  const res: any = await makeDishHandlers(deps({ generate })).suggest(CTX, { mealType: "dinner", wants: "pancakes" });
  assert.equal(dishOf(res).name, "Almond Flour Pancakes");
  assert.equal(res.data.dish.source, "generated");
  assert.equal(res.data.dish.answersRequest, true);
  // Without wants the first fitting dish is served, as before.
  const plain: any = await makeDishHandlers(deps({ generate })).suggest(CTX, { mealType: "dinner" });
  assert.equal(dishOf(plain).name, "Eggs with Yogurt and Almond Flour");
});

test("wants: the generator's early-stop test only accepts a dish that says the request", async () => {
  let accept: ((r: FridgeRecipe) => boolean) | undefined;
  await makeDishHandlers(deps({ generate: async (_c, _a, o) => { accept = o?.accept; return []; } })).suggest(CTX, { mealType: "dinner", wants: "pancakes", maxMinutes: 30 });
  assert.equal(accept!(dish("Almond Flour Pancakes")), true);
  assert.equal(accept!(dish("Lentil Stew")), false, "keeps reading for a dish that is what they asked for");
  assert.equal(accept!(dish("Slow Pancakes", { prepMinutes: 20, cookMinutes: 60 })), false, "the card's own test still applies");
});

test("wants: no generated dish says the request → a matching library recipe comes before it; with neither, the generated dish is served and flagged", async () => {
  const generate: DishDeps["generate"] = async () => [dish("Eggs with Yogurt and Almond Flour")];
  const withLib: any = await makeDishHandlers(deps({ generate, library: async () => [dish("Buckwheat Pancakes")] })).suggest(CTX, { mealType: "dinner", wants: "pancakes" });
  assert.equal(dishOf(withLib).name, "Buckwheat Pancakes");
  assert.equal(withLib.data.dish.source, "library");
  assert.equal(withLib.data.dish.answersRequest, true);
  const without: any = await makeDishHandlers(deps({ generate, library: async () => [dish("Library Stew")] })).suggest(CTX, { mealType: "dinner", wants: "pancakes" });
  assert.equal(dishOf(without).name, "Eggs with Yogurt and Almond Flour");
  assert.equal(without.data.dish.source, "generated");
  assert.equal(without.data.dish.answersRequest, false);
  assert.match(without.data.request, /never present it as "pancakes"/);
});

// ─── the ladder (dish brain, "Always answers") ──────────────────────────────

const verdict = (level: "pass" | "relaxed") => ({ level, reasons: level === "pass" ? [] : ["size:too-large"], builtOn: "salmon" });
const relaxed = (recipe: FridgeRecipe) => ({ recipe, verdict: verdict("relaxed"), fromHome: null });
const suggest = (over: Partial<DishDeps>, input: object = {}) => makeDishHandlers(deps(over)).suggest(CTX, { mealType: "dinner", ...input }) as Promise<any>;

test("ladder step 2: no full pass → the relaxed dish is served as generated, before any stored recipe", async () => {
  const res = await suggest({ generate: async (_c, _a, o) => { o?.judged?.(relaxed(dish("Big Salmon Bowl"))); return []; }, library: async () => [dish("Library Stew")] });
  assert.deepEqual([dishOf(res).name, res.data.dish.source, res.data.dish.note], ["Big Salmon Bowl", "generated", undefined]);
});
test("ladder: a full pass beats a relaxed dish that arrived first; a relaxed dish the card refuses is not served", async () => {
  const first = await suggest({ generate: async (_c, _a, o) => { o?.judged?.(relaxed(dish("Big Salmon Bowl"))); return [dish("Right-Sized Salmon")]; } });
  assert.equal(dishOf(first).name, "Right-Sized Salmon");
  const slow = dish("Slow Big Bowl", { prepMinutes: 30, cookMinutes: 90 });
  const res = await suggest({ generate: async (_c, _a, o) => { o?.judged?.(relaxed(slow)); return []; }, library: async () => [dish("Library Stew")] }, { maxMinutes: 45 });
  assert.deepEqual([dishOf(res).name, res.data.dish.source], ["Library Stew", "library"]);
});
test("ladder step 3 and the end of it: a stored recipe, else the honest message (Review Focus 5)", async () => {
  assert.equal((await suggest({ generate: async () => [], library: async () => [dish("Library Stew")] })).data.dish.source, "library");
  const none = await suggest({ generate: async () => [], library: async () => [] });
  assert.deepEqual([none.ok, none.message], [false, COULDNT_FIT_NOTE]);
});
test("ladder with a request: full match → relaxed match → library match", async () => {
  const library = async () => [dish("Library Egg Bake")];
  const a = await suggest({ generate: async (_c, _a, o) => { o?.judged?.(relaxed(dish("Big Egg Scramble"))); return [dish("Lentil Stew")]; }, library }, { wants: "eggs" });
  assert.equal(dishOf(a).name, "Big Egg Scramble");
  const b = await suggest({ generate: async () => [dish("Lentil Stew")], library }, { wants: "eggs" });
  assert.equal(dishOf(b).name, "Library Egg Bake");
});
test("fromHome rides on the dish part when the judge gives one, and is absent otherwise", async () => {
  const fromHome = { text: "From your kitchen: Salmon fillets, Spinach.", foods: ["Salmon fillets", "Spinach"] };
  const r = dish("Salmon and Spinach");
  const j = { recipe: r, verdict: verdict("pass"), fromHome };
  assert.deepEqual(dishOf(await suggest({ generate: async (_c, _a, o) => { o?.judged?.(j); return [r]; } })).fromHome, fromHome);
  assert.deepEqual(dishOf(await suggest({ generate: async () => [], library: async (_c, _a, _s, judged) => { judged?.(j); return [r]; } })).fromHome, fromHome);
  assert.ok(!("fromHome" in dishOf(await suggest({ generate: async () => [dish("Model Stew")] }))));
});
