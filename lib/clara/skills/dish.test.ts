import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDishHandlers,
  dishSkill,
  gateGeneratedDishes,
  NOTHING_LOGGED_NOTE,
  COULDNT_FIT_NOTE,
  OCCASION_OPTIONS,
  completeSodiumMg,
  stepStatesAmount,
  dishSystemPrompt,
  parseStartingPicture,
  type StartingPicture,
  type DishAsk,
  type DishDeps,
} from "./dish";
import { summarizeLevels, type LevelDayInput, type LevelSummary } from "@/lib/levels";
import type { FridgeRecipe } from "@/lib/fridge";
import type { DietMatchers } from "@/lib/diet-match";
import type { ClaraPart } from "../parts";
import type { ClaraContext } from "../types";

const CTX: ClaraContext = {
  patientId: "p1",
  accountId: "a1",
  firstName: "Sam",
  isPremium: false,
  today: "2026-11-12",
  surface: "ios",
  disabledSkills: [],
};
const RANGE = { fromDate: "2026-11-06", toDate: "2026-11-12" };

function day(localDate: string, fibre: number, sodium: number | null): LevelDayInput {
  return { localDate, meals: 3, calories: 1800, protein: 90, carbs: 200, fat: 60, fibre, sodium };
}
const NO_LOGS: LevelSummary = summarizeLevels([], null, RANGE);
// Little fibre AND a lot of sodium, over three full days.
const LITTLE_FIBRE_LOTS_OF_SODIUM: LevelSummary = summarizeLevels(
  [day("2026-11-10", 10, 3200), day("2026-11-11", 10, 3200), day("2026-11-12", 10, 3200)],
  null,
  RANGE,
);

function lentils(overrides: Partial<FridgeRecipe> = {}): FridgeRecipe {
  return {
    id: "frg_lentils",
    name: "Red Lentil and Spinach Stew",
    description: "Red lentils simmered with spinach.",
    emoji: "",
    usesIngredients: ["red lentils", "spinach", "olive oil"],
    missingIngredients: [],
    steps: [
      "Rinse the red lentils.",
      "Simmer the lentils in water for 15 minutes.",
      "Stir in the spinach and olive oil.",
    ],
    mealType: "dinner",
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

interface Spy {
  deps: DishDeps;
  asks: DishAsk[];
}
function spy(opts: {
  summary?: LevelSummary;
  recipes?: FridgeRecipe[] | ((ask: DishAsk) => FridgeRecipe[]);
  logged?: string[];
  throws?: boolean;
} = {}): Spy {
  const asks: DishAsk[] = [];
  return {
    asks,
    deps: {
      loadSummary: async () => opts.summary ?? NO_LOGS,
      generate: async (_ctx, ask) => {
        asks.push(ask);
        if (opts.throws) throw new Error("model down");
        const r = opts.recipes ?? [lentils()];
        return typeof r === "function" ? r(ask) : r;
      },
      loggedMealTypes: async () => opts.logged ?? [],
    },
  };
}

const kinds = (parts: ClaraPart[] | undefined) => (parts ?? []).map((p) => p.kind);
function dishParts(parts: ClaraPart[] | undefined) {
  return (parts ?? []).filter((p): p is Extract<ClaraPart, { kind: "dish" }> => p.kind === "dish");
}

// ─── dish_suggest ───────────────────────────────────────────────────────────

test("dish_suggest: no logs at all → says nothing is logged yet and still returns a dish", async () => {
  const { deps } = spy({ summary: NO_LOGS });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(kinds(res.parts), ["dish", "steps"], "no levels card when no level has a word");
  const data = res.data as { note?: string; dish: { name: string } };
  assert.equal(data.note, NOTHING_LOGGED_NOTE);
  assert.match(data.note!, /nothing is logged yet/i);
  assert.equal(data.dish.name, "Red Lentil and Spinach Stew");
});

test("dish_suggest: generator returns [] → ok:false with the couldn't-make-one note and no parts", async () => {
  const { deps } = spy({ recipes: [] });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "lunch" });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.message, COULDNT_FIT_NOTE);
  assert.match(res.message, /couldn't make one that fits/i);
  assert.equal("parts" in res, false);
});

test("dish_suggest: a generator that throws is the same ok:false, never a throw", async () => {
  const { deps } = spy({ throws: true });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "lunch" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.message, COULDNT_FIT_NOTE);
});

test("dish_suggest: reasons come from the levels and the priced dish", async () => {
  const { deps } = spy({ summary: LITTLE_FIBRE_LOTS_OF_SODIUM });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const [levels, dish] = res.parts!;
  assert.equal(levels.kind, "levels");
  if (levels.kind === "levels") {
    assert.deepEqual(levels.little.map((l) => l.key), ["fibre"]);
    assert.deepEqual(levels.aLot.map((l) => l.key), ["sodium"]);
  }
  assert.equal(dish.kind, "dish");
  if (dish.kind !== "dish") return;
  assert.deepEqual(dish.reasons.map((r) => [r.level, r.direction]), [["fibre", "up"], ["sodium", "down"]]);
  assert.equal("note" in (res.data as object), false, "logs exist, so no nothing-logged note");
});

test("dish_suggest: the dish part carries the full recipe; the steps part carries the steps with stated timers", async () => {
  const { deps } = spy();
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const [dish, steps] = res.parts!;
  if (dish.kind !== "dish" || steps.kind !== "steps") return assert.fail("wrong part order");
  assert.equal(dish.dishId, steps.dishId);
  assert.equal(dish.minutes, 25);
  const recipe = dish.recipe!;
  assert.equal(recipe.name, "Red Lentil and Spinach Stew");
  assert.equal(recipe.minutes, 25);
  assert.deepEqual(recipe.ingredients[0], { name: "red lentils", quantity: 80, unit: "g" });
  assert.equal(recipe.steps.length, 3);
  for (const k of ["calories", "protein", "carbs", "fat", "fibre"] as const) {
    assert.equal(typeof recipe.perServing[k], "number", k);
  }
  assert.equal(recipe.perServing.fibre, 9);
  assert.equal(typeof recipe.perServing.sodium, "number", "this dish prices in full");
  assert.equal(dish.calories, recipe.perServing.calories);
  assert.deepEqual(
    steps.steps.map((s) => s.timerMinutes),
    [null, 15, null],
  );
  assert.deepEqual(steps.steps.map((s) => s.n), [1, 2, 3]);
});

async function suggestWith(recipe: FridgeRecipe, summary = LITTLE_FIBRE_LOTS_OF_SODIUM) {
  const { deps } = spy({ summary, recipes: [recipe] });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error("expected a dish");
  return { res, dish: dishParts(res.parts)[0] };
}

test("dish_suggest: a dish that cannot be priced passes sodium null and gets no sodium reason", async () => {
  const unpriced = lentils({
    usesIngredients: ["red lentils", "mystery sauce", "dragonfruit crumble"],
    amounts: [
      { name: "red lentils", quantity: 80, unit: "g" },
      { name: "mystery sauce", quantity: 2, unit: "tablespoon" },
      { name: "dragonfruit crumble", quantity: 100, unit: "g" },
    ],
  });
  const { dish } = await suggestWith(unpriced);
  assert.equal(dish.recipe!.perServing.sodium, null);
  assert.deepEqual(dish.reasons.map((r) => r.level), ["fibre"]);
});

test("dish_suggest: a PARTLY priced dish (coverage above the minimum, below full) stores sodium null and gets no sodium reason", async () => {
  // 300 g of priced food beside one unweighable row: coverage 0.75–0.99 is
  // enough for pricedMacros at large portions, but the unpriced row adds 0 mg.
  const partly = lentils({
    usesIngredients: ["red lentils", "spinach", "olive oil", "mystery relish"],
    amounts: [
      { name: "red lentils", quantity: 400, unit: "g" },
      { name: "spinach", quantity: 600, unit: "g" },
      { name: "olive oil", quantity: 1, unit: "teaspoon" },
      { name: "mystery relish", quantity: 1, unit: "tablespoon" },
    ],
  });
  const { priceDish } = await import("@/lib/staple-density");
  const p = priceDish(partly.amounts!.map((a) => ({ name: a.name, quantity: a.quantity, unit: a.unit })), partly.steps);
  assert.ok(p && p.coverage >= 0.9 && p.coverage < 1, `fixture is partly priced (coverage ${p?.coverage})`);
  assert.equal(completeSodiumMg(partly), null);
  const { dish } = await suggestWith(partly);
  assert.equal(dish.recipe!.perServing.sodium, null);
  assert.ok(!dish.reasons.some((r) => r.level === "sodium"));
});

test("dish_suggest: an unweighable salty seasoning makes sodium null (no 'only N mg' undercount)", async () => {
  for (const [name, quantity, unit] of [
    ["soy sauce", 1, "splash"],
    ["salt", 1, "to taste"],
    ["cajun seasoning", 1, "teaspoon"],
    ["white miso", 1, "tablespoon"],
    ["baking soda", 0.5, "teaspoon"],
  ] as const) {
    const salty = lentils({
      usesIngredients: [...lentils().usesIngredients, name],
      amounts: [...lentils().amounts!, { name, quantity, unit }],
    });
    assert.equal(completeSodiumMg(salty), null, name);
    const { dish } = await suggestWith(salty);
    assert.equal(dish.recipe!.perServing.sodium, null, name);
    assert.ok(!dish.reasons.some((r) => r.level === "sodium"), name);
  }
});

test("dish_suggest: weighed salt and a weighed salty sauce still give a complete sodium figure", async () => {
  const salted = lentils({
    usesIngredients: [...lentils().usesIngredients, "salt", "soy sauce"],
    amounts: [
      ...lentils().amounts!,
      { name: "salt", quantity: 1, unit: "pinch" },
      { name: "soy sauce", quantity: 1, unit: "teaspoon" },
    ],
  });
  const mg = completeSodiumMg(salted);
  assert.equal(typeof mg, "number");
  assert.ok(mg! > completeSodiumMg(lentils())!, "the salt and soy sauce are counted");
});

test("dish_suggest: everything on track → no levels card; parts are [dish, steps]", async () => {
  const onTrack = summarizeLevels(
    [day("2026-11-10", 30, 1800), day("2026-11-11", 30, 1800), day("2026-11-12", 30, 1800)],
    null,
    RANGE,
  );
  const { res } = await suggestWith(lentils(), onTrack);
  assert.deepEqual(kinds(res.parts), ["dish", "steps"]);
});

test("dish_suggest: the fibre reason names the fibre-rich ingredient, never a gram figure", async () => {
  const { dish } = await suggestWith(lentils());
  const fibre = dish.reasons.find((r) => r.level === "fibre")!;
  assert.equal(fibre.text, "Red lentils are rich in fibre, and you've had little this week.");
});

test("dish_suggest: a dish with no fibre-rich ingredient gets no fibre reason, even when the model claims 20 g", async () => {
  const claimed = lentils({
    usesIngredients: ["chicken breast", "spinach", "olive oil"],
    amounts: [
      { name: "chicken breast", quantity: 150, unit: "g" },
      { name: "spinach", quantity: 60, unit: "g" },
      { name: "olive oil", quantity: 1, unit: "teaspoon" },
    ],
    perServing: { calories: 300, protein: 36, carbs: 4, fat: 14, fiber: 20 },
  });
  const { dish } = await suggestWith(claimed);
  assert.ok(!dish.reasons.some((r) => r.level === "fibre"));
});

test("dish_suggest: maxMinutes and servings reach the generator; a slower dish is dropped", async () => {
  const slow = lentils({ id: "frg_slow", name: "Slow Stew", prepMinutes: 15, cookMinutes: 40 });
  const quick = lentils({ id: "frg_quick", name: "Quick Stew", prepMinutes: 5, cookMinutes: 10 });
  const s = spy({ recipes: [slow, quick] });
  const res = await makeDishHandlers(s.deps).suggest(CTX, { mealType: "dinner", maxMinutes: 20, servings: 2 });
  assert.equal(s.asks[0].maxMinutes, 20);
  assert.equal(s.asks[0].servings, 2);
  assert.equal(s.asks[0].mealType, "dinner");
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(dishParts(res.parts)[0].name, "Quick Stew");
  assert.equal(dishParts(res.parts)[0].recipe!.servings, 2);
});

test("dish_suggest: every dish over maxMinutes → the couldn't-make-one result", async () => {
  const { deps } = spy({ recipes: [lentils({ prepMinutes: 20, cookMinutes: 40 })] });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner", maxMinutes: 20 });
  assert.equal(res.ok, false);
});

test("dish_suggest: the generator is asked with the person's levels and today is ctx.today", async () => {
  const s = spy({ summary: LITTLE_FIBRE_LOTS_OF_SODIUM });
  let summaryDate = "";
  s.deps.loadSummary = async (_p, today) => {
    summaryDate = today;
    return LITTLE_FIBRE_LOTS_OF_SODIUM;
  };
  await makeDishHandlers(s.deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(summaryDate, "2026-11-12");
  assert.deepEqual(s.asks[0].summary.little, ["fibre"]);
});

test("dish_suggest: a bad mealType is INVALID_INPUT and costs no generation", async () => {
  const s = spy();
  const res = await makeDishHandlers(s.deps).suggest(CTX, { mealType: "brunch" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "INVALID_INPUT");
  assert.equal(s.asks.length, 0);
});

test("dish_suggest: a bad maxMinutes or servings is INVALID_INPUT", async () => {
  const h = makeDishHandlers(spy().deps);
  for (const input of [
    { mealType: "dinner", maxMinutes: 0 },
    { mealType: "dinner", maxMinutes: "soon" },
    { mealType: "dinner", servings: 0 },
    { mealType: "dinner", servings: 100 },
  ]) {
    const res = await h.suggest(CTX, input);
    assert.equal(res.ok, false, JSON.stringify(input));
    if (!res.ok) assert.equal(res.reason, "INVALID_INPUT");
  }
});

// ─── dish_plan_today ────────────────────────────────────────────────────────

test("dish_plan_today: one dish part per meal not yet logged; a logged meal type is skipped", async () => {
  const s = spy({ logged: ["breakfast"], recipes: (ask) => [lentils({ id: `frg_${ask.mealType}`, name: `${ask.mealType} dish`, mealType: ask.mealType })] });
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.deepEqual(s.asks.map((a) => a.mealType).sort(), ["dinner", "lunch"]);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(kinds(res.parts), ["dish", "dish"]);
  assert.deepEqual(dishParts(res.parts).map((d) => d.name), ["lunch dish", "dinner dish"]);
  for (const d of dishParts(res.parts)) assert.ok(d.recipe, "each planned dish can be cooked");
});

test("dish_plan_today: little_time passes maxMinutes 20 for every meal", async () => {
  const s = spy({ recipes: [lentils({ prepMinutes: 5, cookMinutes: 10 })] });
  await makeDishHandlers(s.deps).planToday(CTX, { occasion: "little_time" });
  assert.equal(s.asks.length, 3);
  for (const a of s.asks) assert.equal(a.maxMinutes, 20, a.mealType);
});

test("dish_plan_today: guests passes servings 6 for dinner only", async () => {
  const s = spy();
  await makeDishHandlers(s.deps).planToday(CTX, { occasion: "guests" });
  for (const a of s.asks) assert.equal(a.servings, a.mealType === "dinner" ? 6 : undefined, a.mealType);
  assert.ok(s.asks.some((a) => a.mealType === "dinner"));
});

test("dish_plan_today: eating_out leaves dinner out and says to send the menu", async () => {
  const s = spy();
  const res = await makeDishHandlers(s.deps).planToday(CTX, { occasion: "eating_out" });
  assert.deepEqual(s.asks.map((a) => a.mealType).sort(), ["breakfast", "lunch"]);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.match(JSON.stringify(res.data), /menu/i);
});

test("dish_plan_today: normal (or no occasion) asks with no time or servings override", async () => {
  const s = spy();
  await makeDishHandlers(s.deps).planToday(CTX, { occasion: "normal" });
  for (const a of s.asks) {
    assert.equal(a.maxMinutes, undefined);
    assert.equal(a.servings, undefined);
  }
});

test("dish_plan_today: no logs → says nothing is logged yet and still plans", async () => {
  const s = spy({ summary: NO_LOGS });
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal((res.data as { note?: string }).note, NOTHING_LOGGED_NOTE);
  assert.equal(dishParts(res.parts).length, 3);
});

test("dish_plan_today: the generator returns nothing for every meal → ok:false, no parts", async () => {
  const s = spy({ recipes: [] });
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.message, COULDNT_FIT_NOTE);
});

test("dish_plan_today: a meal the generator could not fill is named, the others still come back", async () => {
  const s = spy({ recipes: (ask) => (ask.mealType === "lunch" ? [] : [lentils({ id: `frg_${ask.mealType}` })]) });
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(dishParts(res.parts).length, 2);
  assert.deepEqual((res.data as { couldNotFill: string[] }).couldNotFill, ["lunch"]);
});

test("dish_plan_today: everything already logged → nothing to plan, no generation", async () => {
  const s = spy({ logged: ["breakfast", "lunch", "dinner"] });
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.equal(s.asks.length, 0);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.parts, undefined);
});

test("dish_plan_today: a bad occasion is INVALID_INPUT", async () => {
  const res = await makeDishHandlers(spy().deps).planToday(CTX, { occasion: "party" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "INVALID_INPUT");
});

// ─── the skill ──────────────────────────────────────────────────────────────

test("both dish tools are reads: neither is flagged isWrite", () => {
  const names = dishSkill.tools.map((t) => t.def.name);
  assert.deepEqual(names, ["dish_suggest", "dish_plan_today"]);
  for (const t of dishSkill.tools) assert.ok(!t.def.isWrite, t.def.name);
});

test("the tool schemas use the brief's names and options", () => {
  const [suggest, plan] = dishSkill.tools.map((t) => t.def.input_schema);
  assert.deepEqual((suggest.properties.mealType as { enum: string[] }).enum, ["breakfast", "lunch", "dinner", "snack"]);
  assert.deepEqual(suggest.required, ["mealType"]);
  assert.ok("maxMinutes" in suggest.properties && "servings" in suggest.properties);
  assert.deepEqual((plan.properties.occasion as { enum: string[] }).enum, ["normal", "eating_out", "guests", "little_time"]);
});

test("the prompt fragment asks 'Anything happening today?' once through ask_choices, with the exact options", () => {
  assert.deepEqual(OCCASION_OPTIONS, ["A normal day", "Eating out", "Guests or a party at home", "Very little time"]);
  const f = dishSkill.promptFragment;
  assert.ok(f.includes("Anything happening today?"));
  assert.ok(f.includes("ask_choices"));
  for (const o of OCCASION_OPTIONS) assert.ok(f.includes(`"${o}"`), o);
  assert.match(f, /already/i, "optional: skipped when the person already said");
});

test("nothing in the skill offers an allowance or an upgrade", () => {
  const text = [dishSkill.promptFragment, ...dishSkill.tools.map((t) => t.def.description), NOTHING_LOGGED_NOTE, COULDNT_FIT_NOTE].join(" ");
  assert.ok(!/upgrade|premium|allowance|plus plan|limit reached/i.test(text));
});

// ─── gates (the real generator's server-side filter) ────────────────────────

const NO_BANS: DietMatchers = { allergyMatchers: [], exactBanned: [] } as unknown as DietMatchers;
const GATE = {
  mealTypeName: "Dinner",
  matchers: NO_BANS,
  groupsOf: () => [] as string[],
  catalogFoodTokens: new Set<string>(),
  sodiumLimitMg: 2300,
};

test("gates: a sound dish passes", () => {
  assert.equal(gateGeneratedDishes([lentils()], GATE).length, 1);
});

test("gates: an allergen is dropped, never returned with a warning", () => {
  const peanut = Object.assign(/\bpeanut\b/i, { term: "peanut" });
  const matchers = { allergyMatchers: [peanut], exactBanned: [] } as unknown as DietMatchers;
  const withPeanut = lentils({
    usesIngredients: ["red lentils", "spinach", "olive oil", "peanut"],
    amounts: [...lentils().amounts!, { name: "peanut", quantity: 10, unit: "g" }],
  });
  assert.deepEqual(gateGeneratedDishes([withPeanut], { ...GATE, matchers }), []);
});

test("gates: a dish the allergen group lookup flags is dropped", () => {
  const matchers = { allergyMatchers: [], exactBanned: [], bannedGroups: new Set(["BIG9-WHEAT"]) } as unknown as DietMatchers;
  const groupsOf = (n: string) => (n === "spinach" ? ["BIG9-WHEAT"] : []);
  assert.deepEqual(gateGeneratedDishes([lentils()], { ...GATE, matchers, groupsOf }), []);
});

test("gates: implausible numbers, a missing amount, an unlisted frying fat and the wrong meal type are dropped", () => {
  const bad = [
    lentils({ perServing: { calories: 20, protein: 1, carbs: 2, fat: 0, fiber: 1 } }),
    lentils({ amounts: lentils().amounts!.slice(0, 2) }),
    lentils({ steps: ["Fry the lentils in a pan for 10 minutes.", "Add the spinach."], usesIngredients: ["red lentils", "spinach"], amounts: lentils().amounts!.slice(0, 2) }),
    lentils({ mealType: "breakfast" }),
  ];
  assert.deepEqual(gateGeneratedDishes(bad, GATE), []);
});

test("gates: added salt is clamped to a seasoning amount, not passed through", () => {
  const salty = lentils({
    usesIngredients: ["red lentils", "spinach", "olive oil", "salt"],
    amounts: [...lentils().amounts!, { name: "salt", quantity: 0.75, unit: "teaspoon" }],
  });
  const [kept] = gateGeneratedDishes([salty], GATE);
  assert.ok(kept, "the dish itself is fine");
  const salt = kept.amounts!.find((a) => a.name === "salt")!;
  assert.ok(salt.quantity < 0.75, `salt clamped, got ${salt.quantity}`);
});

// ─── routing lines ──────────────────────────────────────────────────────────

test("routing: with the dish skill on, the table sends 'what should I eat' and 'plan today's dishes' to the dish tools", async () => {
  const { ALL_SKILLS, resolveActiveSkills, buildSystemPrompt, buildToolDefs } = await import("../registry");
  const active = resolveActiveSkills(ALL_SKILLS, undefined);
  assert.ok(buildToolDefs(active).some((d) => d.name === "dish_suggest"));
  const prompt = buildSystemPrompt("Sam", "MAP", active, "2026-11-12", "assistant");
  assert.match(prompt, /"what should I eat"[^\n]*→ dish_suggest/);
  assert.match(prompt, /"Plan today's dishes"[^\n]*→ dish_plan_today/);
});

test("routing: with the dish skill off, no dish tool is named anywhere", async () => {
  const { ALL_SKILLS, resolveActiveSkills, buildSystemPrompt, buildToolDefs } = await import("../registry");
  const active = resolveActiveSkills(ALL_SKILLS, "profile,logs,nutrition,plan");
  assert.ok(!buildToolDefs(active).some((d) => d.name.startsWith("dish_")));
  assert.ok(!/dish_suggest|dish_plan_today/.test(buildSystemPrompt("Sam", "MAP", active, "2026-11-12", "assistant")));
});

// ─── multi-serving dishes: amounts per serving, steps without amounts ───────

test("stepStatesAmount: amounts in steps are caught; times, temperatures and sizes are not", () => {
  for (const step of [
    "Add 1 cup lentils.",
    "Stir in 2 tablespoons of olive oil.",
    "Add ½ teaspoon cumin.",
    "Add 1/2 tsp salt.",
    "Crack 2 eggs into the pan.",
    "Crack 2 large eggs into the pan.",
    "Add 200g spinach.",
    "Mince 3 cloves garlic.",
    "Pour in 250 ml stock.",
    "Add 1.5 oz feta.",
  ]) {
    assert.ok(stepStatesAmount(step), step);
  }
  for (const step of [
    "Simmer the lentils for 15 minutes.",
    "Roast at 200°C for 20-25 minutes.",
    "Cut into 2 cm pieces.",
    "Heat a 12-inch skillet over medium heat.",
    "Add the lentils and the spinach.",
    "Rest for 1 hour.",
    "Step 2: stir well.",
  ]) {
    assert.ok(!stepStatesAmount(step), step);
  }
});

test("dish_plan_today: guests → a dinner whose steps still name amounts is dropped", async () => {
  const withAmounts = lentils({ id: "frg_amounts", name: "Measured Stew", steps: ["Add 1 cup lentils to the pot.", "Simmer for 15 minutes."] });
  const clean = lentils({ id: "frg_clean", name: "Plain Stew" });
  const s = spy({ recipes: (ask) => (ask.mealType === "dinner" ? [withAmounts, clean] : [withAmounts]) });
  const res = await makeDishHandlers(s.deps).planToday(CTX, { occasion: "guests" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const dinner = dishParts(res.parts).find((d) => d.recipe!.servings === 6)!;
  assert.equal(dinner.name, "Plain Stew", "the multi-serving dinner skips the dish with amounts in its steps");
  // One-serving meals keep amounts in steps: there is nothing to scale.
  assert.ok(dishParts(res.parts).some((d) => d.name === "Measured Stew" && d.recipe!.servings === 1));
});

test("dish_suggest: servings > 1 and every candidate names amounts in its steps → couldn't make one", async () => {
  const { deps } = spy({ recipes: [lentils({ steps: ["Add 2 tablespoons olive oil.", "Simmer 15 minutes."] })] });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner", servings: 4 });
  assert.equal(res.ok, false);
});

test("prompt: more than one serving tells the model to write steps without amounts; one serving does not", () => {
  const base = { foodMapText: "MAP", bannedNames: [], proteinOptions: [], sodiumLimitMg: 2300 };
  const six = dishSystemPrompt({ ...base, ask: { mealType: "dinner", servings: 6, summary: NO_LOGS } });
  assert.match(six, /WITHOUT amounts/);
  assert.match(six, /6 people/);
  const one = dishSystemPrompt({ ...base, ask: { mealType: "dinner", summary: NO_LOGS } });
  assert.doesNotMatch(one, /WITHOUT amounts/);
});

test("prompt: little fibre asks for a fibre-rich ingredient, never a gram figure", () => {
  const p = dishSystemPrompt({
    foodMapText: "MAP", bannedNames: [], proteinOptions: [], sodiumLimitMg: 2300,
    ask: { mealType: "dinner", summary: LITTLE_FIBRE_LOTS_OF_SODIUM },
  });
  assert.match(p, /fibre-rich ingredient \(lentils/);
  assert.doesNotMatch(p, /\d+ g of fib(re|er)/i);
});

test("the plan's shown-note does not claim the steps are on screen", async () => {
  const res = await makeDishHandlers(spy().deps).planToday(CTX, {});
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const shown = (res.data as { shown: string }).shown;
  assert.doesNotMatch(shown, /steps are (already )?shown|and its steps/i);
  const sug = await makeDishHandlers(spy().deps).suggest(CTX, { mealType: "dinner" });
  if (sug.ok) assert.match((sug.data as { shown: string }).shown, /steps/);
});

test("stepStatesAmount: review probes — a number before a food noun, and spelled-out amounts", () => {
  for (const step of [
    "Dice 1 onion.",
    "Add 2 carrots.",
    "Slice 1 large onion.",
    "Add 2 chicken breasts.",
    "Add one cup of lentils.",
    "Add a tablespoon of oil.",
    "Add half a cup of stock.",
    "Season with a pinch of salt.",
    "a pinch of salt",
    // kept from the first round
    "Add 1 1/2 cups water.",
    "Mince 2-3 cloves garlic.",
    "Add ½ cup oats.",
    "Stir in 1tsp cumin.",
    "Add 3 tbsp. olive oil.",
    "Pour in 1 litre stock.",
    "Add 1 can chickpeas.",
    "Mince 2 or 3 cloves garlic.",
    "Add two eggs.",
  ]) {
    assert.ok(stepStatesAmount(step), step);
  }
});

test("stepStatesAmount: times, temperatures, lengths, step numbers and counts of actions are not amounts", () => {
  for (const step of [
    "Simmer 20 minutes.",
    "Cook for 5 min.",
    "Bake at 180°C until golden.",
    "Bake at 350 F for 25-30 minutes.",
    "Preheat the oven to 400°F (200°C).",
    "Cut the carrots into 2 cm pieces.",
    "Heat a 12-inch skillet.",
    "Step 2: stir well.",
    "Stir 2 or 3 times.",
    "Cook for 2 to 3 minutes per side.",
    "Divide between 2 bowls.",
    "Rest for 1 hour, then slice.",
    "Bring to a boil and simmer.",
    "Add the lentils and the spinach.",
  ]) {
    assert.ok(!stepStatesAmount(step), step);
  }
});

test("dish_suggest: a fractional step time becomes a whole number of minutes (the app decodes an integer)", async () => {
  const half = lentils({ prepMinutes: 0, cookMinutes: 0, steps: ["Rinse the red lentils.", "Simmer 2.5 minutes.", "Stir in the spinach."] });
  const res = await makeDishHandlers(spy({ recipes: [half] }).deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const dish = res.parts!.find((p) => p.kind === "dish");
  if (!dish || dish.kind !== "dish") return assert.fail("no dish part");
  assert.ok(Number.isInteger(dish.minutes) && dish.minutes >= 1, `minutes ${dish.minutes}`);
  assert.equal(dish.minutes, 3);
  assert.equal(dish.recipe!.minutes, 3);
});

test("dish_suggest: a step time under half a minute still shows at least 1 minute", async () => {
  const quick = lentils({ prepMinutes: 0, cookMinutes: 0, steps: ["Rinse the red lentils.", "Stir for 0.25 minutes.", "Serve."] });
  const res = await makeDishHandlers(spy({ recipes: [quick] }).deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const dish = res.parts!.find((p) => p.kind === "dish");
  if (!dish || dish.kind !== "dish") return assert.fail("no dish part");
  assert.equal(dish.minutes, 1);
});

// ─── the starting picture (not enough logs) ─────────────────────────────────

function withPicture(picture: StartingPicture | null, summary: LevelSummary = NO_LOGS) {
  const s = spy({ summary });
  let loads = 0;
  s.deps.loadStartingPicture = async () => {
    loads++;
    return picture;
  };
  return { ...s, loads: () => loads };
}
const PIC: StartingPicture = { little: ["fibre", "iron"], aLot: ["sodium", "saturatedFat"] };

test("dish_suggest: not enough logs + a picture → 'from your answers', names, no levels part", async () => {
  const { deps, asks } = withPicture(PIC);
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(kinds(res.parts), ["dish", "steps"]);
  const json = JSON.stringify(res.data);
  assert.match(json, /from your answers/);
  assert.doesNotMatch(json, /from what you logged/);
  const data = res.data as { levels: { little: string[]; aLot: string[] } };
  assert.deepEqual(data.levels.little, ["fibre", "iron"]);
  assert.deepEqual(data.levels.aLot, ["sodium", "saturated fat"]);
  assert.deepEqual(asks[0].picture, PIC);
  const reasons = dishParts(res.parts)[0].reasons.map((r) => r.text);
  assert.ok(reasons.length > 0);
  for (const t of reasons) {
    assert.match(t, /from your answers/);
    assert.doesNotMatch(t, /this week|logged/);
  }
});

test("dish_suggest: picture reasons only cover fibre (if little) and sodium (if a lot)", async () => {
  const { deps } = withPicture({ little: ["iron"], aLot: ["saturatedFat"] });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(dishParts(res.parts)[0].reasons, []);
});

test("dish_suggest: the generator prompt leans on the picture in answers wording", async () => {
  const prompt = dishSystemPrompt({
    ask: { mealType: "dinner", summary: NO_LOGS, picture: PIC },
    foodMapText: "",
    bannedNames: [],
    proteinOptions: [],
    sodiumLimitMg: 2300,
  });
  assert.match(prompt, /From their answers they probably get little fibre/);
  assert.doesNotMatch(prompt, /this week: build|this week: keep/);
});

test("dish_suggest: an empty picture behaves as the not-enough-logs path", async () => {
  const { deps } = withPicture(parseStartingPicture({ little: [], aLot: [] }));
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal((res.data as { note?: string }).note, NOTHING_LOGGED_NOTE);
  assert.doesNotMatch(JSON.stringify(res.data), /from your answers/);
});

test("dish_suggest: enough logs ignore the picture and never load it", async () => {
  const enough = summarizeLevels(
    [day("2026-11-10", 10, 3200), day("2026-11-11", 10, 3200), day("2026-11-12", 10, 3200)],
    null,
    RANGE,
  );
  assert.equal(enough.enoughLogs, true);
  const w = withPicture(PIC, enough);
  const res = await makeDishHandlers(w.deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(w.loads(), 0);
  assert.equal(w.asks[0].picture, undefined);
  assert.ok(kinds(res.parts).includes("levels"));
  assert.doesNotMatch(JSON.stringify(res.data), /from your answers/);
});

test("dish_plan_today: picture reaches every ask and the model data", async () => {
  const { deps, asks } = withPicture(PIC);
  const res = await makeDishHandlers(deps).planToday(CTX, {});
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(asks.length > 0 && asks.every((a) => a.picture === PIC));
  assert.match(JSON.stringify(res.data), /from your answers/);
  assert.doesNotMatch(JSON.stringify(res.data), /from what you logged/);
});

test("parseStartingPicture: malformed or absent JSON is no picture", () => {
  for (const bad of [null, undefined, 5, "x", [], {}, { little: "fibre" }, { little: ["nope"], aLot: [3] }]) {
    assert.equal(parseStartingPicture(bad), null);
  }
  assert.deepEqual(parseStartingPicture({ little: ["fibre", "nope", "fibre"], aLot: ["sodium"] }), {
    little: ["fibre"],
    aLot: ["sodium"],
  });
});
