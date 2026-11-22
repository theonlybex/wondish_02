// The REAL dish generator and library paths (createLiveDishDeps) against a
// small in-memory Prisma and a fake model stream: the actual allergen filter,
// planner rule filter and gates decide — nothing here is stubbed but the IO.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { summarizeLevels } from "@/lib/levels";
import type { ClaraContext } from "../types";

const PEANUT = "BIG9-PEANUT";
const CATALOG: { name: string; allergenGroups: string[] }[] = [
  { name: "red lentils", allergenGroups: [] },
  { name: "spinach", allergenGroups: [] },
  { name: "yellow onion", allergenGroups: [] },
  { name: "olive oil", allergenGroups: [] },
  { name: "salt", allergenGroups: [] },
  { name: "groundnut oil", allergenGroups: [PEANUT] }, // a peanut product whose NAME says nothing
  { name: "peanut butter", allergenGroups: [PEANUT] },
  { name: "brown rice", allergenGroups: [] },
  // Catalog proteins (INGREDIENT_CATALOG names, lower case) for the at-home tests.
  { name: "salmon fillets", allergenGroups: [] },
  { name: "ground chicken", allergenGroups: [] },
  { name: "boneless chicken breasts", allergenGroups: [] },
];
const ing = (name: string, quantity: number, unit: string) => ({
  quantity, unit, ingredient: { name, allergenGroups: CATALOG.find((c) => c.name === name)?.allergenGroups ?? [] },
});
const STEW_STEPS = [
  "Heat the olive oil in a pot and cook the yellow onion for 5 minutes.",
  "Add the red lentils and water and simmer for 20 minutes.",
  "Stir in the spinach and cook for 2 minutes.",
  "Season with the salt and serve.",
];
const libRecipe = (id: string, name: string, oil: string, steps: string[]) => ({
  id, name, steps, calories: 400, protein: 22, carbs: 60, fat: 7, fiber: 12, sodium: null, prepTime: 10, cookTime: 25, servings: 1,
  isPublic: true, mealTypeId: "mt-dinner",
  ingredients: [ing("red lentils", 80, "g"), ing("spinach", 60, "g"), ing("yellow onion", 80, "g"), ing(oil, 1, "teaspoon"), ing("salt", 0.125, "teaspoon")],
});
const LIBRARY = [
  // Allergen only in the stored group of an ingredient: the planner's rule filter must drop it.
  libRecipe("grouped", "Red Lentil and Spinach Stew with Onion", "groundnut oil", STEW_STEPS.map((s) => s.replace("olive oil", "groundnut oil"))),
  // Allergen only in a STEP: the allergen filter scans every step.
  libRecipe("step", "Red Lentil Stew with Spinach", "olive oil", [...STEW_STEPS.slice(0, 3), "Top with chopped peanuts and serve."]),
  // Clean.
  libRecipe("clean", "Red Lentil and Spinach Stew", "olive oil", STEW_STEPS),
];

// Lunch: a library of chicken recipes only (the at-home fallback test).
const CHICKEN_STEPS = [
  "Heat the olive oil in a pan and cook the boneless chicken breasts for 8 minutes on each side.",
  "Simmer the brown rice in water for 25 minutes.",
  "Stir the spinach into the rice and cook for 2 minutes.",
  "Season with the salt and serve the chicken over the rice.",
];
const CHICKEN_LIBRARY = [{
  id: "chicken", name: "Chicken Breast with Spinach Rice", steps: CHICKEN_STEPS,
  calories: 480, protein: 42, carbs: 48, fat: 10, fiber: 4, sodium: null, prepTime: 10, cookTime: 30, servings: 1,
  isPublic: true, mealTypeId: "mt-lunch",
  ingredients: [ing("boneless chicken breasts", 140, "g"), ing("brown rice", 60, "g"), ing("spinach", 60, "g"), ing("olive oil", 1, "teaspoon"), ing("salt", 0.125, "teaspoon")],
}];

/** Ingredient ids (= catalog names) the patient marked as at home. Empty except in the at-home tests. */
let pantry: string[] = [];
let queries: string[] = [];
const fakePrisma = {
  patient: {
    findFirst: async () => ({
      id: "p1", mealType: null,
      foodAllergies: [{ food: { name: "Peanuts", bannedIngredients: [{ name: "peanut" }, { name: "peanut butter" }] } }],
      foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [], triggerTrials: [],
      ingredientPreferences: [], dishPreferences: [], journalEntries: [],
    }),
  },
  ingredient: {
    findMany: async (args: any) => {
      // The kept-foods catalog lookups (ids by name, then groups by id): not the dish's allergen-groups query.
      if (args?.select?.id) {
        queries.push("catalog");
        const names: string[] | undefined = args.where?.name?.in;
        const ids: string[] | undefined = args.where?.id?.in;
        return CATALOG.filter((c) => (names ? names.some((w) => w.toLowerCase() === c.name) : ids ? ids.includes(c.name) : true))
          .map((c) => ({ id: c.name, name: c.name, allergenGroups: c.allergenGroups }));
      }
      queries.push("ingredient");
      const wanted: string[] | undefined = args?.where?.name?.in;
      return wanted ? CATALOG.filter((c) => wanted.some((w) => w.toLowerCase() === c.name)) : CATALOG.map((c) => ({ name: c.name }));
    },
    createMany: async () => ({ count: 0 }), // the catalog's idempotent insert of names it lacks
  },
  patientPantryItem: { findMany: async () => pantry.map((ingredientId) => ({ ingredientId })) },
  patientIngredientPreference: { findMany: async () => [] },
  mealType: { findMany: async () => [{ id: "mt-dinner", name: "Dinner" }, { id: "mt-lunch", name: "Lunch" }] },
  recipe: { findMany: async (args: any) => { queries.push("recipe"); return args?.where?.mealTypeId === "mt-lunch" ? CHICKEN_LIBRARY : LIBRARY; } },
  mealLog: { findMany: async () => { queries.push("mealLog"); return []; } },
};

const CTX: ClaraContext = { patientId: "p1", accountId: "a1", firstName: "Sam", isPremium: false, today: "2026-11-12", surface: "ios", disabledSkills: [] };
const NO_LOGS = summarizeLevels([], null, { fromDate: "2026-11-06", toDate: "2026-11-12" });
const ASK = { mealType: "dinner" as const, summary: NO_LOGS };

const item = (name: string, extra: { name: string; quantity: number; unit: string }[] = [], steps = STEW_STEPS) => ({
  name, description: "Red lentils with spinach.", prepMinutes: 10, cookMinutes: 25,
  ingredients: [
    { name: "red lentils", quantity: 80, unit: "g" }, { name: "spinach", quantity: 60, unit: "g" },
    { name: "yellow onion", quantity: 80, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" },
    { name: "salt", quantity: 0.125, unit: "teaspoon" }, ...extra,
  ],
  steps, perServing: { calories: 400, protein: 22, carbs: 60, fat: 7, fiber: 12 },
});

/** A fake streamed structured answer in 40-char deltas, honouring the abort signal like the SDK. */
function fakeClient(text: string) {
  const seen = { yielded: 0, total: Math.ceil(text.length / 40), finished: false, signal: undefined as AbortSignal | undefined, params: null as any };
  const client = () => ({
    messages: {
      create: async (params: any, opts?: { signal?: AbortSignal }) => {
        seen.signal = opts?.signal;
        seen.params = params;
        return (async function* () {
          try {
            for (let i = 0; i < text.length; i += 40) {
              if (opts?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "APIUserAbortError" });
              seen.yielded++;
              yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 40) } };
            }
            yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
          } finally {
            seen.finished = true;
          }
        })();
      },
    },
  });
  return { client: client as any, seen };
}

let dish: typeof import("./dish");
before(async () => {
  (globalThis as any).prisma = fakePrisma; // before lib/db loads
  process.env.ANTHROPIC_API_KEY = "test-never-sent";
  dish = await import("./dish");
});

test("library: a recipe whose ingredient carries a banned allergen group, and one whose STEP names the allergen, are dropped", async () => {
  queries = [];
  const out = await dish.createLiveDishDeps().library!({ ...CTX }, ASK);
  assert.deepEqual(out.map((r) => r.name), ["Red Lentil and Spinach Stew"]);
  assert.ok(!out.some((r) => [...r.usesIngredients, ...r.steps].join(" ").match(/peanut|groundnut/i)));
});

test("library: once the signal fires no further query is made, and the allergen groups load in one query", async () => {
  queries = [];
  const stop = new AbortController();
  stop.abort();
  assert.deepEqual(await dish.createLiveDishDeps().library!({ ...CTX }, ASK, stop.signal), []);
  assert.ok(!queries.includes("ingredient"), `queries after the abort: ${queries.join(", ")}`);
  queries = [];
  await dish.createLiveDishDeps().library!({ ...CTX }, ASK);
  assert.equal(queries.filter((q) => q === "ingredient").length, 1, `one groups query for every ranked candidate: ${queries.join(", ")}`);
});

test("generator: candidate 1 breaks the allergy, candidate 2 passes → candidate 2 is served, generated", async () => {
  const text = JSON.stringify({ dishes: [item("Peanut Lentil Stew", [{ name: "peanut butter", quantity: 1, unit: "tablespoon" }]), item("Red Lentil and Spinach Stew")] });
  const { client } = fakeClient(text);
  const trace: string[] = [];
  const got = await dish.createLiveDishDeps({ client }).generate({ ...CTX }, ASK, { accept: () => true, trace: (e) => trace.push(e.stage) });
  assert.deepEqual(got.map((r) => r.name), ["Red Lentil and Spinach Stew"]);
  assert.deepEqual(trace, ["safety", "accepted"]);

  const res: any = await dish.makeDishHandlers({ ...dish.createLiveDishDeps({ client: fakeClient(text).client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined }).suggest({ ...CTX }, { mealType: "dinner" });
  assert.equal(res.ok, true);
  assert.equal(res.data.dish.source, "generated");
  assert.equal(res.parts.find((p: any) => p.kind === "dish").name, "Red Lentil and Spinach Stew");
});

test("generator: a truncated stream serves nothing from the model", async () => {
  const full = JSON.stringify({ dishes: [item("Red Lentil and Spinach Stew")] });
  const { client } = fakeClient(full.slice(0, full.length - 30));
  assert.deepEqual(await dish.createLiveDishDeps({ client }).generate({ ...CTX }, ASK, { accept: () => true }), []);
});

test("generator: accepting a dish aborts the stream — the rest is never read", async () => {
  const text = JSON.stringify({ dishes: [item("Red Lentil and Spinach Stew"), item("Lentil Spinach Pot", [], STEW_STEPS), item("Spinach Lentil Bowl")] });
  const { client, seen } = fakeClient(text);
  const got = await dish.createLiveDishDeps({ client }).generate({ ...CTX }, ASK, { accept: () => true });
  assert.equal(got.length, 1);
  assert.equal(seen.finished, true, "the stream was closed");
  assert.equal(seen.signal?.aborted, true, "and its request aborted");
  assert.ok(seen.yielded < seen.total, `read ${seen.yielded} of ${seen.total} chunks`);
  // The request carried the strict structured-output format, streamed, with the Haiku model.
  assert.equal(seen.params.stream, true);
  assert.equal(seen.params.output_config.format.type, "json_schema");
});

test("dish_plan_today: the recent-dishes query runs once per tool call, not once per meal", async () => {
  queries = [];
  const deps = { ...dish.createLiveDishDeps({ client: fakeClient('{"dishes":[]}').client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined };
  const res: any = await dish.makeDishHandlers(deps).planToday({ ...CTX }, {});
  assert.equal(res.ok, true);
  // One for the meals already logged today, one for the recent dishes — three meals asked.
  assert.equal(queries.filter((q) => q === "mealLog").length, 2, queries.join(", "));
});

test("fibre: declared above the declared carbs, or above the PRICED carbs the card shows, is not a dish", async () => {
  const { pricedMacros } = await import("@/lib/clara/recipe-generation");
  const base = (await dish.createLiveDishDeps().library!({ ...CTX }, ASK))[0];
  assert.equal(dish.fibreIsPlausible(base), true);
  assert.equal(dish.fibreIsPlausible({ ...base, perServing: { ...base.perServing, fiber: 180 } }), false, "the live typo");
  assert.equal(dish.fibreIsPlausible({ ...base, perServing: { ...base.perServing, carbs: 8, fiber: 12 } }), false, "above the declared carbs");
  // Declared carbs 30 and fibre 10 look fine, but the amounts price at a few grams of carbs: the card shows those.
  const lowCarb = {
    ...base,
    usesIngredients: ["chicken breast", "spinach", "olive oil"],
    amounts: [{ name: "chicken breast", quantity: 150, unit: "g" }, { name: "spinach", quantity: 100, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" }],
    perServing: { calories: 330, protein: 48, carbs: 30, fat: 9, fiber: 10 },
  };
  const priced = pricedMacros(lowCarb);
  assert.ok(priced && priced.carbs < 10, `priced carbs ${priced?.carbs}`);
  assert.equal(dish.fibreIsPlausible(lowCarb), false, "above the priced carbs");
});

// ─── wants: the real generator, library and conflict check ──────────────────

test("wants: the request is in the generator's prompt, and the gates still drop an unsafe candidate", async () => {
  const text = JSON.stringify({ dishes: [item("Peanut Lentil Stew", [{ name: "peanut butter", quantity: 1, unit: "tablespoon" }]), item("Red Lentil and Spinach Stew")] });
  const { client, seen } = fakeClient(text);
  const trace: string[] = [];
  const got = await dish.createLiveDishDeps({ client }).generate({ ...CTX }, { ...ASK, wants: "lentil stew" }, { accept: () => true, trace: (e) => trace.push(e.stage) });
  assert.match(seen.params.system, /THE REQUEST: they asked to cook "lentil stew"/);
  assert.match(seen.params.system, /FORBIDDEN WORDS/, "their forbidden words are still in the prompt");
  assert.equal(seen.params.output_config.format.type, "json_schema");
  assert.deepEqual(got.map((r) => r.name), ["Red Lentil and Spinach Stew"]);
  assert.deepEqual(trace, ["safety", "accepted"]);
});

test("wants: every candidate breaks the allergy → nothing generated; a matching library recipe is served instead", async () => {
  const unsafe = JSON.stringify({ dishes: [item("Peanut Lentil Stew", [{ name: "peanut butter", quantity: 1, unit: "tablespoon" }])] });
  const deps = () => ({ ...dish.createLiveDishDeps({ client: fakeClient(unsafe).client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined });
  const res: any = await dish.makeDishHandlers(deps()).suggest({ ...CTX }, { mealType: "dinner", wants: "lentil stew" });
  assert.equal(res.ok, true);
  assert.equal(res.data.dish.source, "library");
  assert.equal(res.parts.find((p: any) => p.kind === "dish").name, "Red Lentil and Spinach Stew");
  assert.equal(res.data.dish.answersRequest, true);
  assert.ok(!JSON.stringify(res.parts).match(/peanut|groundnut/i));

  // Nothing in the library is a soup: no unrelated library dish stands in for it.
  const soup: any = await dish.makeDishHandlers(deps()).suggest({ ...CTX }, { mealType: "dinner", wants: "lentil soup" });
  assert.equal(soup.ok, false);
  assert.equal(soup.message, dish.couldntMakeRequestNote("lentil soup"));
});

test("wants: the real library only offers recipes that match the request", async () => {
  const lib = dish.createLiveDishDeps().library!;
  assert.deepEqual((await lib({ ...CTX }, { ...ASK, wants: "spinach stew" })).map((r) => r.name), ["Red Lentil and Spinach Stew"]);
  assert.deepEqual(await lib({ ...CTX }, { ...ASK, wants: "chicken" }), []);
});

test("wants: a request that names their allergen is refused before any model call, and says why", async () => {
  const { client, seen } = fakeClient(JSON.stringify({ dishes: [item("Red Lentil and Spinach Stew")] }));
  const deps = { ...dish.createLiveDishDeps({ client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined };
  for (const wants of ["peanut noodles", "Peanuts", "groundnut oil"]) {
    const res: any = await dish.makeDishHandlers(deps).suggest({ ...CTX }, { mealType: "dinner", wants });
    assert.equal(res.ok, false, wants);
    assert.match(res.message, /does not fit them/, wants);
    assert.match(res.message, /allergy: peanut/, wants);
    assert.equal(res.parts, undefined);
  }
  assert.equal(seen.params, null, "the model was never called");
  // "peanut-free" names what they avoid, not what they want: no conflict.
  assert.deepEqual(await dish.createLiveDishDeps().requestConflicts!({ ...CTX }, "peanut-free lentil stew"), []);
  assert.deepEqual(await dish.createLiveDishDeps().requestConflicts!({ ...CTX }, "lentil stew"), []);
});

// ─── kept foods: what they keep at home, through the real gates ─────────────

const salmonItem = () => ({
  ...item("Pan-Seared Salmon with Lentils and Spinach", [{ name: "salmon fillet", quantity: 120, unit: "g" }], [
    "Heat the olive oil in a pan and cook the yellow onion for 5 minutes.",
    "Add the red lentils and water and simmer for 20 minutes.",
    "Sear the salmon fillet in the pan for 4 minutes on each side.",
    "Stir in the spinach, season with the salt and serve with the salmon fillet.",
  ]),
  perServing: { calories: 600, protein: 50, carbs: 60, fat: 16, fiber: 12 },
});
const chickenItem = () => ({
  ...item("Ground Chicken and Lentil Skillet", [{ name: "ground chicken", quantity: 120, unit: "g" }], [
    "Heat the olive oil in a pan and cook the yellow onion for 5 minutes.",
    "Brown the ground chicken in the pan for 6 minutes.",
    "Add the red lentils and water and simmer for 20 minutes.",
    "Stir in the spinach, season with the salt and serve.",
  ]),
  perServing: { calories: 600, protein: 50, carbs: 60, fat: 16, fiber: 12 },
});

test("kept: salmon is the only protein at home → a ground-chicken candidate is not served (stage kept), the salmon one is", async () => {
  pantry = ["salmon fillets"];
  try {
    const text = JSON.stringify({ dishes: [chickenItem(), salmonItem()] });
    const { client, seen } = fakeClient(text);
    const trace: { name: string; stage: string }[] = [];
    const got = await dish.createLiveDishDeps({ client }).generate({ ...CTX }, ASK, { accept: () => true, trace: (e) => trace.push({ name: e.name, stage: e.stage }) });
    assert.deepEqual(got.map((r) => r.name), ["Pan-Seared Salmon with Lentils and Spinach"]);
    assert.deepEqual(trace.map((t) => t.stage), ["kept", "accepted"]);
    assert.match(seen.params.system, /Salmon fillets/);
    assert.match(seen.params.system, /no other meat, fish or seafood/);

    // Through the handler: the chicken dish alone is never served from the model.
    const only = JSON.stringify({ dishes: [chickenItem()] });
    const res: any = await dish.makeDishHandlers({ ...dish.createLiveDishDeps({ client: fakeClient(only).client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined }).suggest({ ...CTX }, { mealType: "dinner" });
    assert.ok(!(res.ok && res.data.dish.source === "generated"), "the chicken candidate was not served");
    assert.ok(!JSON.stringify(res.parts ?? []).match(/ground chicken/i));
    const served: any = await dish.makeDishHandlers({ ...dish.createLiveDishDeps({ client: fakeClient(JSON.stringify({ dishes: [salmonItem()] })).client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined }).suggest({ ...CTX }, { mealType: "dinner" });
    assert.equal(served.ok, true);
    assert.equal(served.data.dish.source, "generated");
    assert.equal(served.parts.find((p: any) => p.kind === "dish").name, "Pan-Seared Salmon with Lentils and Spinach");
  } finally {
    pantry = [];
  }
});

test("kept: nothing at home → the ground-chicken candidate is served as before", async () => {
  const got = await dish.createLiveDishDeps({ client: fakeClient(JSON.stringify({ dishes: [chickenItem()] })).client }).generate({ ...CTX }, ASK, { accept: () => true });
  assert.deepEqual(got.map((r) => r.name), ["Ground Chicken and Lentil Skillet"]);
});

test("kept: a library of only chicken recipes and a generator that returns nothing still yields a dish (the rule gives way)", async () => {
  pantry = ["salmon fillets"];
  try {
    const deps = { ...dish.createLiveDishDeps({ client: fakeClient('{"dishes":[]}').client }), loadSummary: async () => NO_LOGS, loadStartingPicture: undefined };
    const res: any = await dish.makeDishHandlers(deps).suggest({ ...CTX }, { mealType: "lunch" });
    assert.equal(res.ok, true, res.message);
    assert.equal(res.data.dish.source, "library");
    assert.equal(res.parts.find((p: any) => p.kind === "dish").name, "Chicken Breast with Spinach Rice");
  } finally {
    pantry = [];
  }
});
