import { test } from "node:test";
import { saltRuleLine } from "@/lib/clara/recipe-generation";
import assert from "node:assert/strict";
import {
  makeDishHandlers,
  dishSkill,
  gateGeneratedDishes,
  NOTHING_LOGGED_NOTE,
  NOT_ENOUGH_LOGS_NOTE,
  COULDNT_FIT_NOTE,
  requestAnsweredNote,
  requestNotMatchedNote,
  cannotFitRequestNote,
  couldntMakeRequestNote,
  OCCASION_OPTIONS,
  completeSodiumMg,
  stepStatesAmount,
  dishSystemPrompt,
  DISH_CRAFT_LINES,
  DAY_PLAN_LUNCH_LINE,
  DAY_PLAN_DINNER_LINE,
  DAY_PLAN_QUICK_DINNER_LINE,
  styleOfTheDay,
  promptDishName,
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
import { NO_KEPT_FOODS, type KeptFoods } from "@/lib/clara/kept-foods";
import { brainFrom, NO_BRAIN_ROWS } from "@/lib/clara/dish-brain";
import { DEFAULT_DISH_RULES, type DishRules } from "@/lib/clara/dish-rules";
import { buildDietMatchers, derivePatientBans } from "@/lib/diet-match";
import crypto from "crypto";

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

test("dish_suggest: a throwing loadStartingPicture does not fail the tool; falls back to the levels path", async () => {
  const s = spy({ summary: NO_LOGS });
  s.deps.loadStartingPicture = async () => {
    throw new Error("db down");
  };
  const res = await makeDishHandlers(s.deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(s.asks[0].picture, undefined);
  assert.doesNotMatch(JSON.stringify(res.data), /from your answers/);
});

test("dish_plan_today: a throwing loadStartingPicture does not fail the tool", async () => {
  const s = spy({ summary: NO_LOGS });
  s.deps.loadStartingPicture = async () => {
    throw new Error("db down");
  };
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.equal(res.ok, true);
});

test("dishSkill.promptFragment pins the wording rule: 'from your answers', never body state", () => {
  const f = dishSkill.promptFragment;
  assert.match(f, /from your answers/);
  assert.doesNotMatch(f, /from what you logged/);
  const sentence = f.split(/(?<=\.)\s/).find((x) => x.includes("from your answers")) ?? "";
  assert.doesNotMatch(sentence, /is low|are low/);
  assert.doesNotMatch(sentence, /from what you logged/);
});

// Simulation finding 2 (docs/qa/clara-first-sim.md): with too few logs and no
// starting picture, Clara made "you've had little fibre this week" claims from
// a single day. Numbers says nothing then; Clara must agree.
const ONE_DAY_LITTLE_FIBRE: LevelSummary = summarizeLevels([day("2026-11-12", 5, 3200)], null, RANGE);

test("dish_suggest: too few logs and no picture → no level claim, no levels part, model told so", async () => {
  assert.equal(ONE_DAY_LITTLE_FIBRE.enoughLogs, false);
  assert.deepEqual(ONE_DAY_LITTLE_FIBRE.little, ["fibre"], "the raw summary would claim it");
  const s = spy({ summary: ONE_DAY_LITTLE_FIBRE });
  const res = await makeDishHandlers(s.deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(kinds(res.parts), ["dish", "steps"]);
  assert.deepEqual(dishParts(res.parts)[0].reasons, []);
  const data = res.data as { levels: { little: string[]; aLot: string[] }; note?: string };
  assert.deepEqual(data.levels.little, []);
  assert.deepEqual(data.levels.aLot, []);
  assert.equal(data.note, NOT_ENOUGH_LOGS_NOTE);
  assert.deepEqual(s.asks[0].summary.little, [], "the generator prompt leans into nothing");
  assert.doesNotMatch(JSON.stringify(res), /you've had/);
});

test("dish_plan_today: too few logs and no picture → no claims either", async () => {
  const s = spy({ summary: ONE_DAY_LITTLE_FIBRE });
  const res = await makeDishHandlers(s.deps).planToday(CTX, {});
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(!kinds(res.parts).includes("levels"));
  assert.ok(dishParts(res.parts).every((d) => d.reasons.length === 0));
  assert.equal((res.data as { note?: string }).note, NOT_ENOUGH_LOGS_NOTE);
  assert.ok(s.asks.every((a) => a.summary.little.length === 0 && a.summary.aLot.length === 0));
});

// ─── wants: "help me cook eggs" (a dish card for what they asked to cook) ───

test("dish_suggest: wants is trimmed and reaches the generator; absent wants leaves the ask as before", async () => {
  const s = spy();
  await makeDishHandlers(s.deps).suggest(CTX, { mealType: "breakfast", wants: "  scrambled   eggs " });
  assert.equal(s.asks[0].wants, "scrambled eggs");
  await makeDishHandlers(s.deps).suggest(CTX, { mealType: "breakfast" });
  assert.ok(!("wants" in s.asks[1]), "no wants key when none was asked");
});

test("dish_suggest: a bad wants is INVALID_INPUT and costs no generation", async () => {
  const s = spy();
  const h = makeDishHandlers(s.deps);
  for (const wants of ["", "   ", "x".repeat(81), 12, ["eggs"], {}]) {
    const res = await h.suggest(CTX, { mealType: "dinner", wants });
    assert.equal(res.ok, false, JSON.stringify(wants));
    if (!res.ok) {
      assert.equal(res.reason, "INVALID_INPUT");
      assert.match(res.message, /wants must be 1 to 80 characters/);
    }
  }
  assert.equal(s.asks.length, 0);
  const edge = await h.suggest(CTX, { mealType: "dinner", wants: "x".repeat(80) });
  assert.equal(edge.ok, true, "80 characters is allowed");
});

test("prompt: wants puts the request in the generator prompt, inside the same rules; no wants, no request line", () => {
  const base = { foodMapText: "MAP", bannedNames: ["milk"], proteinOptions: ["tofu"], sodiumLimitMg: 2300 };
  const without = dishSystemPrompt({ ...base, ask: { mealType: "breakfast", summary: NO_LOGS, maxMinutes: 15 } });
  const withWants = dishSystemPrompt({ ...base, ask: { mealType: "breakfast", summary: NO_LOGS, maxMinutes: 15, wants: 'scrambled "eggs"' } });
  assert.ok(!/THE REQUEST/.test(without));
  assert.match(withWants, /THE REQUEST: they asked to cook "scrambled eggs"/);
  assert.match(withWants, /main idea/);
  // Every line of the no-wants prompt is still there: the request is added, nothing is relaxed.
  for (const line of without.split("\n")) assert.ok(withWants.includes(line), line);
  assert.match(withWants, /FORBIDDEN WORDS/);
  assert.match(withWants, /at most 15 minutes/);
});

test("dish_suggest: with wants, the result says the dish answers the request, and never that it was made for them", async () => {
  const eggs = lentils({
    id: "frg_eggs", name: "Soft Scrambled Eggs with Spinach", description: "Eggs with spinach.", mealType: "breakfast",
    usesIngredients: ["eggs", "spinach", "olive oil"],
    steps: ["Whisk the eggs.", "Cook the eggs in the olive oil for 3 minutes.", "Fold in the spinach."],
    prepMinutes: 3, cookMinutes: 5,
    amounts: [{ name: "eggs", quantity: 2, unit: "" }, { name: "spinach", quantity: 40, unit: "g" }, { name: "olive oil", quantity: 1, unit: "teaspoon" }],
    perServing: { calories: 210, protein: 14, carbs: 2, fat: 16, fiber: 1 },
  });
  const res: any = await makeDishHandlers(spy({ recipes: [eggs] }).deps).suggest(CTX, { mealType: "breakfast", wants: "eggs" });
  assert.equal(res.ok, true);
  assert.equal(res.data.dish.askedFor, "eggs");
  assert.equal(res.data.dish.answersRequest, true);
  assert.equal(res.data.request, requestAnsweredNote("eggs"));
  assert.match(res.data.request, /answers their request to cook "eggs"/);
  assert.ok(!/\b(made|created|invented) (it |this |just )?for\b/i.test(JSON.stringify(res.data)), "no 'made for them' promise");
  assert.deepEqual(kinds(res.parts), ["dish", "steps"]);
});

test("dish_suggest: with wants, a served dish that does not say the request is flagged, never presented as it", async () => {
  const res: any = await makeDishHandlers(spy().deps).suggest(CTX, { mealType: "dinner", wants: "salmon" });
  assert.equal(res.ok, true);
  assert.equal(res.data.dish.answersRequest, false);
  assert.equal(res.data.request, requestNotMatchedNote("salmon"));
  assert.match(res.data.request, /never present it as "salmon"/);
});

test("dish_suggest: no wants → the result is exactly as before (no request keys)", async () => {
  const res: any = await makeDishHandlers(spy().deps).suggest(CTX, { mealType: "dinner" });
  assert.deepEqual(Object.keys(res.data).sort(), ["dish", "levels", "note", "shown"]);
  assert.deepEqual(Object.keys(res.data.dish).sort(), ["caloriesPerServing", "dishId", "mealType", "minutes", "name", "reasons", "servings", "source"]);
});

test("dish_suggest: what they asked for breaks one of their rules → says so plainly, no generation, no dish", async () => {
  const s = spy();
  const seen: string[] = [];
  s.deps.requestConflicts = async (_c, wants) => { seen.push(wants); return ["allergy: egg"]; };
  const res = await makeDishHandlers(s.deps).suggest(CTX, { mealType: "breakfast", wants: "eggs" });
  assert.deepEqual(seen, ["eggs"]);
  assert.equal(s.asks.length, 0, "no dish is generated for a request that cannot fit");
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, "FAILED");
  assert.equal(res.message, cannotFitRequestNote("eggs", ["allergy: egg"]));
  assert.match(res.message, /"eggs"/);
  assert.match(res.message, /allergy: egg/);
  assert.match(res.message, /offer/i);
  assert.ok(!("parts" in res));
});

test("dish_suggest: no conflict, or a conflict check that throws, still goes on to the generator (the gates decide)", async () => {
  const ok = spy();
  ok.deps.requestConflicts = async () => [];
  assert.equal((await makeDishHandlers(ok.deps).suggest(CTX, { mealType: "dinner", wants: "lentil stew" })).ok, true);
  const broken = spy();
  broken.deps.requestConflicts = async () => { throw new Error("db down"); };
  assert.equal((await makeDishHandlers(broken.deps).suggest(CTX, { mealType: "dinner", wants: "lentil stew" })).ok, true);
  assert.equal(broken.asks.length, 1);
  // Without wants the conflict check is never consulted.
  const none = spy();
  let called = 0;
  none.deps.requestConflicts = async () => { called++; return ["allergy: egg"]; };
  assert.equal((await makeDishHandlers(none.deps).suggest(CTX, { mealType: "dinner" })).ok, true);
  assert.equal(called, 0);
});

test("dish_suggest: with wants and nothing to serve → 'couldn't make that right now', naming the request", async () => {
  const res = await makeDishHandlers(spy({ recipes: [] }).deps).suggest(CTX, { mealType: "dinner", wants: "pancakes" });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.message, couldntMakeRequestNote("pancakes"));
  assert.match(res.message, /"pancakes"/);
  assert.notEqual(res.message, COULDNT_FIT_NOTE);
});

test("the dish_suggest schema carries wants, and the description routes cook requests to it while keeping the NOT-for clauses", () => {
  const def = dishSkill.tools[0].def;
  assert.equal((def.input_schema.properties.wants as { type: string }).type, "string");
  assert.deepEqual(def.input_schema.required, ["mealType"]);
  for (const phrase of ["help me cook eggs", "how do I make pancakes", "cook salmon with me", "I want to make a lentil soup", "what should I eat"]) {
    assert.ok(def.description.includes(phrase), phrase);
  }
  assert.match(def.description, /NOT for what is already on their meal plan \(plan_get\)/);
  assert.match(def.description, /NOT for whether a named dish fits them \(answer directly\)/);
  assert.match(def.description, /how long do I boil an egg/);
  assert.match(dishSkill.promptFragment, /wants/);
  assert.match(dishSkill.promptFragment, /how long do I boil an egg/);
  const text = [def.description, dishSkill.promptFragment, requestAnsweredNote("x"), requestNotMatchedNote("x"), cannotFitRequestNote("x", ["y"]), couldntMakeRequestNote("x")].join(" ");
  assert.ok(!/upgrade|premium|allowance|plus plan|limit reached/i.test(text));
  assert.ok(!/\b(made|created|invented) (it |this |just )?for\b/i.test(text));
});

test("routing: with the dish skill on, a request to cook something particular goes to dish_suggest with wants; a technique question does not", async () => {
  const { ALL_SKILLS, resolveActiveSkills, buildSystemPrompt } = await import("../registry");
  const prompt = buildSystemPrompt("Sam", "MAP", resolveActiveSkills(ALL_SKILLS, undefined), "2026-11-12", "assistant");
  assert.match(prompt, /"help me cook eggs"[^\n]*→ dish_suggest with wants/);
  assert.match(prompt, /"how long do I boil an egg\?"[^\n]*answer directly/);
  const off = buildSystemPrompt("Sam", "MAP", resolveActiveSkills(ALL_SKILLS, "profile,logs,nutrition,plan"), "2026-11-12", "assistant");
  assert.ok(!/help me cook eggs/.test(off));
});

// ─── avoid: "something else" must not return the dish they were just shown ──
// (seen live 2026-11-12: the same ask gave the same dish twice).

test("dish_suggest: avoid reaches the generator, and a dish with an avoided name is never served", async () => {
  const shown = lentils({ name: "Red Lentil and Spinach Stew" });
  const other = lentils({ id: "frg_other", name: "Chickpea and Tomato Skillet" });
  const s = spy({ recipes: [shown, other] });
  const res: any = await makeDishHandlers(s.deps).suggest(CTX, { mealType: "dinner", avoid: ["  red lentil and spinach STEW ", 7, ""] });
  assert.deepEqual(s.asks[0].avoid, ["red lentil and spinach STEW"]);
  assert.equal(dishParts(res.parts)[0].name, "Chickpea and Tomato Skillet");
  const only: any = await makeDishHandlers(spy({ recipes: [shown] }).deps).suggest(CTX, { mealType: "dinner", avoid: ["Red Lentil and Spinach Stew"] });
  assert.equal(only.ok, false, "the same dish again is not an answer to 'something else'");
  // No avoid: as before.
  const plain = spy({ recipes: [shown, other] });
  const again: any = await makeDishHandlers(plain.deps).suggest(CTX, { mealType: "dinner" });
  assert.ok(!("avoid" in plain.asks[0]));
  assert.equal(dishParts(again.parts)[0].name, "Red Lentil and Spinach Stew");
  const bad = await makeDishHandlers(spy().deps).suggest(CTX, { mealType: "dinner", avoid: "stew" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "INVALID_INPUT");
});

test("prompt: avoid tells the generator which dishes they were just shown", () => {
  const base = { foodMapText: "MAP", bannedNames: [], proteinOptions: [], sodiumLimitMg: 2300 };
  const p = dishSystemPrompt({ ...base, ask: { mealType: "dinner", summary: NO_LOGS, avoid: ["Lemon Herb Chicken"] } });
  assert.match(p, /already shown[^\n]*Lemon Herb Chicken/);
  assert.ok(!/already shown/.test(dishSystemPrompt({ ...base, ask: { mealType: "dinner", summary: NO_LOGS } })));
  assert.ok("avoid" in dishSkill.tools[0].def.input_schema.properties);
});

// ─── kept foods: at home and favourites in the prompt ───────────────────────

const KEPT_BASE = {
  ask: { mealType: "dinner" as const, summary: NO_LOGS, wants: "a stew", avoid: ["Old Dish"] },
  foodMapText: "MAP",
  proteinOptions: ["chicken breast", "salmon", "eggs", "lentils"],
  sodiumLimitMg: 2300,
};
const SALMON_AND_BEEF: KeptFoods = { proteinKeys: ["salmon", "ground beef"], proteinNames: ["Salmon fillets", "Ground beef"], atHome: [], favorites: [] };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

test("prompt: without kept foods (absent or NO_KEPT_FOODS) the prompt is today's plus the lines the brain adds for everyone", () => {
  // Hashes of the prompt taken from the function before kept foods existed.
  const before: [string[], string][] = [
    [[], "53f3878bb521e2f1dfe6d7eb6cf1b8248bd490b4c4b4d178f8b71f7e941b0979"],
    [["peanut", "milk"], "863c7597d7af29401cca2a245b50dd3ce06f7a8456661466436929f2871125e9"],
  ];
  // DISH_CRAFT_LINES includes the plain-ingredient-names line (dish names stay readable, 2026-11-21).
  assert.ok(DISH_CRAFT_LINES.includes(`- Ingredient names are plain food names, with no comma and no state or cut after it: "jasmine rice", "carrots" — never "jasmine rice, dry" or "carrots, peeled and sliced".`));
  const NEW_FOR_EVERYONE = [...DISH_CRAFT_LINES, "- Macro split to aim for, by calories: ~30% protein, ~45% carbs, ~25% fat."];
  // The one sodium line stands where the salt line stood (2026-11-22).
  const SODIUM = "- Sodium and salt: each serving must stay at or under 1030 mg of sodium in total, counting what is already in the food (stock, sauces, cheese, bread). That leaves room for at most a quarter teaspoon of salt per serving.";
  for (const [bannedNames, hash] of before) {
    for (const kept of [undefined, NO_KEPT_FOODS]) {
      const lines = dishSystemPrompt({ ...KEPT_BASE, bannedNames, ...(kept ? { kept } : {}) }).split("\n");
      for (const l of [...NEW_FOR_EVERYONE, SODIUM]) assert.equal(lines.filter((x) => x === l).length, 1, l);
      assert.equal(sha(lines.filter((l) => !NEW_FOR_EVERYONE.includes(l)).map((l) => (l === SODIUM ? saltRuleLine(2300) : l)).join("\n")), hash, JSON.stringify(bannedNames));
    }
  }
  assert.doesNotMatch(dishSystemPrompt({ ...KEPT_BASE, bannedNames: [] }), /at home|kcal/);
});

const DINNER = { mealType: "dinner" as const, summary: NO_LOGS };
test("prompt: a protein at home → this main is built on ONE of them, and nothing that is not at home is offered", () => {
  for (const bannedNames of [[], ["peanut"]]) {
    const p = dishSystemPrompt({ ...KEPT_BASE, ask: DINNER, bannedNames, kept: SALMON_AND_BEEF });
    assert.match(p, /- Build this Dinner on (Salmon fillets|Ground beef), which they have at home\./);
    assert.match(p, /must be one of these, which they have at home: Salmon fillets, Ground beef; use no other meat, fish or seafood/);
    assert.equal(p.split("\n").filter((l) => /no other meat, fish or seafood/i.test(l)).length, 1);
    assert.doesNotMatch(p, /chicken breast|lentils|Protein sources that fit this person/);
  }
});

test("prompt: a request that names a meat turns the at-home protein rule off; today's protein line comes back under today's condition", () => {
  const ask = { mealType: "dinner" as const, summary: NO_LOGS, wants: "a chicken dish" };
  const noBans = dishSystemPrompt({ ...KEPT_BASE, ask, bannedNames: [], kept: SALMON_AND_BEEF });
  assert.doesNotMatch(noBans, /chicken breast/);
  assert.doesNotMatch(noBans, /no other meat/);
  const bans = dishSystemPrompt({ ...KEPT_BASE, ask, bannedNames: ["peanut"], kept: SALMON_AND_BEEF });
  assert.match(bans, /Protein sources that fit this person — build every main around one of them: chicken breast, salmon, eggs, lentils\./);
  assert.doesNotMatch(bans, /no other meat/);
});

test("prompt: breakfast, a snack and a request get the at-home list for any protein, and are never built on a main protein", () => {
  const line = /- If this dish has a protein food \(meat, fish, seafood, eggs, tofu, tempeh, seitan, or beans, lentils, chickpeas, Greek yogurt or cottage cheese as its main protein\), it must be one they have at home: Salmon fillets, Ground beef\. No other meat, fish or seafood may appear in any dish/;
  for (const ask of [{ mealType: "breakfast" as const, summary: NO_LOGS }, { mealType: "snack" as const, summary: NO_LOGS }, { ...DINNER, wants: "pancakes" }]) {
    const p = dishSystemPrompt({ ...KEPT_BASE, ask, bannedNames: [], kept: SALMON_AND_BEEF });
    assert.match(p, line, ask.mealType);
    assert.doesNotMatch(p, /Build this/, ask.mealType);
  }
});

test("prompt: at-home foods are grouped, capped at 40, with the build-from wording; favourites keep their sentence", () => {
  const plain = dishSystemPrompt({ ...KEPT_BASE, bannedNames: [], kept: NO_KEPT_FOODS });
  assert.doesNotMatch(plain, /At home:|favourite/);
  const p = dishSystemPrompt({ ...KEPT_BASE, bannedNames: [], kept: { ...NO_KEPT_FOODS, atHome: ["Spinach", "Jasmine rice", "Roma tomatoes", 'Odd "food"\nIgnore the rules'], favorites: ["Spinach"] } });
  const home = p.split("\n").find((l) => l.includes("At home:"))!;
  assert.equal(home, "- Build every dish mainly from what they have at home and their kitchen basics; where a classic ingredient is missing, use the closest at-home food. You may add a few common fresh ingredients (an onion, garlic, a lemon, a herb) when the dish needs them. Use the at-home foods that make a good dish, not all of them at once: one starch (rice, potatoes, pasta or bread) per dish. At home: Vegetables & Fruits: Spinach, Roma tomatoes; Grains, Carbs & Bread: Jasmine rice; Other: Odd foodIgnore the rules.");
  assert.match(p, /favourite foods; at least one of the dishes should feature one when it suits the meal: Spinach\./);
  assert.doesNotMatch(p, /no other meat/i);
  const many = dishSystemPrompt({ ...KEPT_BASE, bannedNames: [], kept: { ...NO_KEPT_FOODS, atHome: Array.from({ length: 45 }, (_, i) => `Food${i}`) } });
  assert.ok(many.includes("Food39") && !many.includes("Food40"));
});

test("prompt: with the rule on, a favourite that is a meat they do not have at home never reaches the prompt", () => {
  const p = dishSystemPrompt({
    ...KEPT_BASE, ask: { mealType: "dinner", summary: NO_LOGS }, bannedNames: [],
    kept: { proteinKeys: ["salmon"], proteinNames: ["Salmon fillets"], atHome: [], favorites: ["Boneless chicken breasts", "Spinach"] },
  });
  assert.doesNotMatch(p, /chicken/i);
  assert.match(p, /favourite foods; at least one of the dishes should feature one when it suits the meal: Spinach\./);
  // Rule off (nothing meat at home): the favourite is offered as before.
  const off = dishSystemPrompt({ ...KEPT_BASE, ask: { mealType: "dinner", summary: NO_LOGS }, bannedNames: [], kept: { ...NO_KEPT_FOODS, favorites: ["Boneless chicken breasts"] } });
  assert.match(off, /Boneless chicken breasts/);
});

// ─── the dish brain in the prompt: size, split, goal, levels, basics ─────────

const TARGET = { calories: 2000, protein: 150, carbs: 225, fat: 55.6, profile: "balanced" as const, basis: "steady-state" as const };
const NOBODY = { healthConditions: [], motivations: [] };
const withBrain = (over: Parameters<typeof brainFrom>[0], ask: DishAsk = DINNER) =>
  dishSystemPrompt({ ...KEPT_BASE, ask, bannedNames: ["peanut"], brain: brainFrom(over), who: { patientId: "p1", today: "2026-11-12" } });
const answersLines = (p: string) => p.split("\n").filter((l) => /^- From their answers they probably get/.test(l));

test("prompt: the size, the split, the protein floor and the goal", () => {
  const p = withBrain({ kept: NO_KEPT_FOODS, rows: { ...NO_BRAIN_ROWS, dayTarget: TARGET }, patient: { ...NOBODY, motivations: [{ motivation: { name: "Build muscle" } }] } });
  for (const l of [
    "- Size: this Dinner should be about 600 kcal per serving (their day is 2000 kcal); choose the portions to land there. It must be between 330 and 750 kcal.",
    "- Macro split to aim for, by calories: ~30% protein, ~40% carbs, ~30% fat.",
    "- Their goal: lean towards protein.",
  ]) assert.ok(p.split("\n").includes(l), l);
  // Owner, 2026-11-22: the 15% protein floor is off.
  assert.doesNotMatch(p, /15% of its calories/);
});
test("prompt: same day, same protein, in a different dish", () => {
  const p = withBrain({ kept: SALMON_AND_BEEF, rows: { ...NO_BRAIN_ROWS, todayDishes: ["Beef and Rice Skillet"] } });
  assert.ok(p.includes("- Build this Dinner on Ground beef, which they have at home. It is already open today, so make a different dish from: Beef and Rice Skillet."));
});
test("prompt: levels from the answers (at most four), and today's sodium", () => {
  const person = (usualEating: object) => ({ kept: NO_KEPT_FOODS, rows: { ...NO_BRAIN_ROWS, pills: [] }, today: "2026-11-12", patient: { ...NOBODY, usualEating } });
  // lib/starting-picture.ts: these answers give little iron and potassium, and nothing else.
  assert.deepEqual(answersLines(withBrain(person({ veg: 1, fruit: 1, beans: 0, grains: 2, fish: 2, meat: 1, dairy: 2, packaged: 0, sweet: 0 }))), [
    "- From their answers they probably get little potassium: build the dish on foods rich in it (potatoes, sweet potatoes, beans, lentils, spinach, bananas, avocado).",
    "- From their answers they probably get little iron: build the dish on foods rich in it (lentils, beans, chickpeas, spinach, beef, tofu).",
  ]);
  // eleven levels out of line: four lines
  assert.equal(answersLines(withBrain(person({ veg: 0, fruit: 0, beans: 0, grains: 0, fish: 0, meat: 0, dairy: 0, packaged: 2, sweet: 2 }))).length, 4);
  // Limits are weekly (owner, 2026-11-22): one salty day says nothing; a salty week does, and sets the ceiling.
  const day = (localDate: string) => ({ localDate, meals: 3, calories: 1800, protein: 80, carbs: 200, fibre: 28, sodium: 2900, saturatedFat: 8, addedSugar: 10 });
  const weekOf = (dates: string[]) => withBrain({ kept: NO_KEPT_FOODS, today: "2026-11-12", patient: NOBODY, rows: { ...NO_BRAIN_ROWS, week: { range: { fromDate: "2026-11-06", toDate: "2026-11-12" }, days: dates.map(day) } } });
  const one = weekOf(["2026-11-12"]);
  assert.doesNotMatch(one, /Today's meals have already used|a lot of sodium this week/);
  assert.ok(one.split("\n").includes("- Sodium and salt: each serving must stay at or under 1030 mg of sodium in total, counting what is already in the food (stock, sauces, cheese, bread). That leaves room for at most a quarter teaspoon of salt per serving."));
  const salty = weekOf(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  // One figure in the whole prompt: the week line and the salt line agree, and nothing says 350 or "four of these dishes".
  assert.match(salty, /- They have had a lot of sodium this week: keep every serving at or under 690 mg of sodium/);
  assert.ok(salty.split("\n").includes("- Sodium and salt: each serving must stay at or under 690 mg of sodium in total, counting what is already in the food (stock, sauces, cheese, bread). That leaves room for at most an eighth of a teaspoon of salt per serving."));
  assert.doesNotMatch(salty, /350 mg|quarter teaspoon|four of these dishes/);
});
test("prompt: kitchen basics, and every liked food", () => {
  const matchers = buildDietMatchers(derivePatientBans({ foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] } as any));
  const p = withBrain({ kept: NO_KEPT_FOODS, matchers, patient: { ...NOBODY, missingStaples: ["butter"] }, rows: { ...NO_BRAIN_ROWS, liked: [{ name: "Halloumi", allergenGroups: [] }] } });
  const basics = p.split("\n").find((l) => l.startsWith("- Kitchen basics they always have: "))!;
  assert.ok(basics.includes("olive oil") && basics.includes("salt") && !basics.includes("butter"), basics);
  // Nothing at home: no "oil from the at-home list". Fresh seasonings are allowed, not only the basics.
  assert.ok(basics.endsWith(". Common fresh seasonings (lemon, garlic, fresh herbs, pepper) may be used too; list each one you use in ingredients with its amount. Cook with one of these fats."), basics);
  const withHome = withBrain({ kept: { ...NO_KEPT_FOODS, atHome: ["Spinach"] }, matchers });
  assert.match(withHome, /Cook with one of these fats or with an oil from the at-home list\./);
  assert.match(p, /favourite foods; at least one of the dishes should feature one when it suits the meal: Halloumi\./);
});
test("prompt: every switch removes its own lines, and no switch removes a safety line", () => {
  const rows = { ...NO_BRAIN_ROWS, dayTarget: TARGET, liked: [{ name: "Halloumi", allergenGroups: [] }] };
  const kept = { ...SALMON_AND_BEEF, atHome: ["Spinach"] };
  const ask = { ...DINNER, summary: LITTLE_FIBRE_LOTS_OF_SODIUM };
  const off = (rules: Partial<DishRules>) => withBrain({ kept, rows, rules: { ...DEFAULT_DISH_RULES, ...rules } }, ask);
  assert.doesNotMatch(off({ cookFromHome: false }), /Build this|At home:/);
  assert.doesNotMatch(off({ onlyHomeProteins: false }), /Build this|no other meat/i);
  assert.match(off({ onlyHomeProteins: false }), /At home: Vegetables & Fruits: Spinach/);
  assert.doesNotMatch(off({ sizeToCalories: false }), /kcal per serving/);
  assert.doesNotMatch(off({ followMacroSplit: false }), /Macro split/);
  assert.doesNotMatch(off({ mainsOnProtein: false }), /at least 15%/);
  assert.doesNotMatch(off({ steerByLevels: false }), /fibre-rich ingredient|a lot of sodium this week/);
  assert.doesNotMatch(off({ favourFavourites: false }), /favourite/);
  const allOff = off(Object.fromEntries(Object.keys(DEFAULT_DISH_RULES).map((k) => [k, false])));
  for (const safety of [/FORBIDDEN WORDS/, /- Sodium and salt: /, /Their dietary profile/]) assert.match(allOff, safety);
});

// ─── wording fixes: the protein is the heart; breakfast, snack and levels follow what is at home ───

const SIMPLEST = "The app shows the first one that passes its checks, so put the simplest, surest fit first.";
const CLOSEST = "The app shows the first one that passes its checks, so put first the dish that follows every rule below most closely, then the next.";
const SALMON_TODAY = { ...NO_BRAIN_ROWS, todayDishes: ["Salmon Rice Bowl"] };
const lineOf = (p: string, start: string) => p.split("\n").find((l) => l.startsWith(start)) ?? "";

test("prompt: a rule-on dinner makes the chosen protein the heart of the dish and puts the closest fit first", () => {
  const p = withBrain({ kept: SALMON_AND_BEEF, rows: SALMON_TODAY });
  const build = lineOf(p, "- Build this Dinner on Salmon fillets");
  assert.ok(build.endsWith(" This protein is the heart of the dish. Where a line above says to build the dish on or around another food, add a portion of that food to this dish instead; do not replace Salmon fillets."), build);
  assert.ok(p.includes(CLOSEST) && !p.includes(SIMPLEST));
  // Foods marked at home without a protein rule: the closest-fit opening too.
  const spinach = withBrain({ kept: { ...NO_KEPT_FOODS, atHome: ["Spinach"] } });
  assert.ok(spinach.includes(CLOSEST) && !/heart of the dish/.test(spinach));
  // Nothing marked: today's opening.
  assert.ok(withBrain({ kept: NO_KEPT_FOODS }).includes(SIMPLEST));
});

test("prompt: level examples name only proteins the dish may use, and say 'at home' only for foods that are", () => {
  const ask = { ...DINNER, summary: { ...NO_LOGS, little: ["iron", "fibre"] } as unknown as LevelSummary };
  const iron = (p: string) => lineOf(p, "- They have had little iron this week");
  const fibre = (p: string) => lineOf(p, "- They have had little fibre this week");
  // Salmon chosen, beef at home: no beef, and no pulse or tofu that is not at home; nothing at home matches, so no "preferring".
  const bare = withBrain({ kept: SALMON_AND_BEEF, rows: SALMON_TODAY }, ask);
  assert.equal(iron(bare), "- They have had little iron this week: include one food rich in it (spinach).");
  // Case (a): spinach, rice and eggs at home.
  const a = withBrain({ kept: { ...SALMON_AND_BEEF, atHome: ["Spinach", "Jasmine rice", "Large eggs"] }, rows: SALMON_TODAY }, ask);
  assert.equal(iron(a), "- They have had little iron this week: include one food rich in it, preferring any they have at home (spinach).");
  assert.equal(fibre(a), "- They have had little fibre this week: include a fibre-rich ingredient in every dish (peas, oats, barley, quinoa, brown rice, whole-wheat bread or pasta, chia or flax seeds); one is enough, and a grain among them takes the place of the dish's starch.");
  assert.doesNotMatch(a, /build every dish around a fibre-rich ingredient/);
  // Lentils at home: kept, and preferred.
  const lentils = withBrain({ kept: { ...SALMON_AND_BEEF, atHome: ["Red lentils"] }, rows: SALMON_TODAY }, ask);
  assert.equal(fibre(lentils), "- They have had little fibre this week: include a fibre-rich ingredient in every dish, preferring any they have at home (lentils).");
  assert.equal(iron(lentils), "- They have had little iron this week: include one food rich in it, preferring any they have at home (lentils).");
  // Marked foods without a rule: every example kept, at-home preference, fibre wording unchanged.
  const noRule = withBrain({ kept: { ...NO_KEPT_FOODS, atHome: ["Spinach", "Rolled oats"] } }, ask);
  assert.equal(iron(noRule), "- They have had little iron this week: include one food rich in it, preferring any they have at home (spinach).");
  assert.equal(fibre(noRule), "- They have had little fibre this week: include a fibre-rich ingredient in every dish, preferring any they have at home (oats).");
  // Marked, no rule, no example at home: every example, and one of them is enough.
  assert.equal(fibre(withBrain({ kept: { ...NO_KEPT_FOODS, atHome: ["Jasmine rice"] } }, ask)), "- They have had little fibre this week: include a fibre-rich ingredient in every dish (lentils, chickpeas, beans, peas, oats, barley, quinoa, brown rice, whole-wheat bread or pasta, chia or flax seeds); one is enough, and a grain among them takes the place of the dish's starch.");
});

test("prompt: breakfast and snack name only what is at home when the rule is on, and the level lines add to that base", () => {
  const breakfast = { mealType: "breakfast" as const, summary: { ...NO_LOGS, little: ["iron", "fibre"] } as unknown as LevelSummary };
  const snack = { mealType: "snack" as const, summary: NO_LOGS };
  const eggs = { ...SALMON_AND_BEEF, atHome: ["Spinach", "Jasmine rice", "Large eggs"] };
  const levelText = (p: string) => p.split("\n").filter((l) => l.startsWith("- They have had little")).join("\n");
  // Case (b).
  const pb = withBrain({ kept: eggs }, breakfast);
  const b = lineOf(pb, "- This is BREAKFAST");
  assert.equal(b, "- This is BREAKFAST: morning food, under 30 minutes in total, built on Large eggs or on cheese, nut butter or nuts. Not a braise, a roast or a rice bowl. Add what the lines below ask for to this; do not replace it.");
  assert.doesNotMatch(b, /yoghurt|beans|tofu/);
  assert.equal(levelText(pb), [
    "- They have had little fibre this week: include a fibre-rich ingredient in every dish (peas, oats, barley, quinoa, brown rice, whole-wheat bread or pasta, chia or flax seeds); one is enough, and a grain among them takes the place of the dish's starch.",
    "- They have had little iron this week: include one food rich in it, preferring any they have at home (spinach).",
  ].join("\n"));
  // Case (d): only salmon and beef.
  const pd = withBrain({ kept: SALMON_AND_BEEF }, breakfast);
  assert.equal(lineOf(pd, "- This is BREAKFAST"), "- This is BREAKFAST: morning food, under 30 minutes in total, built on cheese, nut butter or nuts, or on Salmon fillets or Ground beef if one suits a breakfast. Not a braise, a roast or a rice bowl. Add what the lines below ask for to this; do not replace it.");
  assert.equal(levelText(pd), [
    "- They have had little fibre this week: include a fibre-rich ingredient in every dish (peas, oats, barley, quinoa, brown rice, whole-wheat bread or pasta, chia or flax seeds); one is enough, and a grain among them takes the place of the dish's starch.",
    "- They have had little iron this week: include one food rich in it (spinach).",
  ].join("\n"));
  for (const p of [pb, pd]) assert.doesNotMatch(levelText(p), /beef|lentils|chickpeas|beans|tofu/);
  assert.equal(lineOf(withBrain({ kept: eggs }, snack), "- This is a SNACK"), "- This is a SNACK: small and quick, under 20 minutes in total, with no added salt. Fruit, nuts, toast, a boiled egg, raw vegetables and a dip. Add what the lines below ask for to this; do not replace it.");
  assert.equal(lineOf(withBrain({ kept: { ...SALMON_AND_BEEF, atHome: ["Plain Greek yogurt"] } }, snack), "- This is a SNACK"), "- This is a SNACK: small and quick, under 20 minutes in total, with no added salt. Fruit, yoghurt, nuts, toast, raw vegetables and a dip. Add what the lines below ask for to this; do not replace it.");
  // Nothing marked: today's lines.
  assert.match(withBrain({ kept: NO_KEPT_FOODS }, breakfast), /built on a breakfast protein \(eggs, yoghurt, cottage cheese, cheese, nut butter, nuts, beans, tofu\)\. Not a braise, a roast or a rice bowl\.\n/);
  assert.match(withBrain({ kept: NO_KEPT_FOODS }, breakfast), /little fibre this week: build every dish around a fibre-rich ingredient \(lentils, chickpeas/);
  assert.match(withBrain({ kept: NO_KEPT_FOODS }, snack), /Fruit, yoghurt, nuts, toast, a boiled egg, raw vegetables and a dip\.\n/);
});

// Final review, 2026-11-21: the level examples were filtered by the at-home rule only, so a fish
// and tree-nut allergy read "build the dish on foods rich in it (salmon, sardines, mackerel, walnuts, …)"
// beside FORBIDDEN WORDS naming the same foods.
const bansOf = (allergyNames: string[], exact: string[] = []) =>
  buildDietMatchers({ allergyNames, exactBanned: exact.map((name) => ({ name, source: "preference" as const })) });
test("prompt: level examples never name a food the diet bans, with or without foods marked", () => {
  const ask = { ...DINNER, summary: { ...NO_LOGS, little: ["omega3", "iron", "calcium", "fibre"] } as unknown as LevelSummary };
  const line = (p: string, what: string) => p.split("\n").find((l) => l.startsWith(`- They have had little ${what} this week`)) ?? "";
  // Fish and tree-nut allergy, nothing marked.
  const fishNuts = bansOf(["fish", "salmon", "sardines", "mackerel", "tree nuts", "walnuts", "almonds", "cashews"]);
  const p = withBrain({ kept: NO_KEPT_FOODS, matchers: fishNuts }, ask);
  const omega = line(p, "omega-3");
  assert.equal(omega, "- They have had little omega-3 this week: build the dish on foods rich in it (chia or flax seeds).");
  assert.doesNotMatch(omega, /salmon|sardine|mackerel|walnut/);
  assert.doesNotMatch(line(p, "calcium"), /sardines/);
  // Vegetarian (here: meat and fish banned by name): no beef for iron.
  const veg = bansOf([], ["beef", "chicken", "pork", "fish", "salmon", "sardines"]);
  const v = withBrain({ kept: NO_KEPT_FOODS, matchers: veg }, ask);
  assert.equal(line(v, "iron"), "- They have had little iron this week: build the dish on foods rich in it (lentils, beans, chickpeas, spinach, tofu).");
  // Dairy allergy: the calcium line keeps only what is allowed.
  const dairy = bansOf(["milk", "yogurt", "cheese"]);
  assert.equal(line(withBrain({ kept: NO_KEPT_FOODS, matchers: dairy }, ask), "calcium"), "- They have had little calcium this week: build the dish on foods rich in it (tofu, sardines, kale).");
  // Every example banned: the line is stated without a list.
  const allOmega = bansOf(["salmon", "sardines", "mackerel", "walnuts", "chia or flax seeds"]);
  assert.equal(line(withBrain({ kept: NO_KEPT_FOODS, matchers: allOmega }, ask), "omega-3"), "- They have had little omega-3 this week: build the dish on foods rich in it.");
  // The fibre sentence gets the same filter.
  const legumes = bansOf(["lentils", "chickpeas", "beans", "peas"]);
  assert.equal(line(withBrain({ kept: NO_KEPT_FOODS, matchers: legumes }, ask), "fibre"), "- They have had little fibre this week: build every dish around a fibre-rich ingredient (oats, barley, quinoa, brown rice, whole-wheat bread or pasta, chia or flax seeds).");
  // With the at-home rule on, both filters apply.
  const ruled = withBrain({ kept: { ...SALMON_AND_BEEF, atHome: ["Spinach"] }, rows: SALMON_TODAY, matchers: veg }, ask);
  assert.doesNotMatch(line(ruled, "iron"), /beef/);
  // No bans (matchers with nothing in them, or none at all): unchanged.
  const none = bansOf([]);
  for (const m of [undefined, none]) {
    const q = withBrain({ kept: NO_KEPT_FOODS, ...(m ? { matchers: m } : {}) }, ask);
    assert.equal(line(q, "omega-3"), "- They have had little omega-3 this week: build the dish on foods rich in it (salmon, sardines, mackerel, walnuts, chia or flax seeds).");
    assert.equal(line(q, "iron"), "- They have had little iron this week: build the dish on foods rich in it (lentils, beans, chickpeas, spinach, beef, tofu).");
  }
});

// Re-check, 2026-11-21: an allergy stored as a group only ("fish", with no food names) still let
// salmon and walnuts through, because an example word has no catalog row to carry its groups.
test("prompt: level examples never name a food from an allergen group the diet bans", () => {
  const ask = { ...DINNER, summary: { ...NO_LOGS, little: ["omega3", "calcium", "iodine", "fibre"] } as unknown as LevelSummary };
  const line = (p: string, what: string) => p.split("\n").find((l) => l.startsWith(`- They have had little ${what} this week`)) ?? "";
  const groupsOnly = (allergyGroupCodes: string[]) => buildDietMatchers({ allergyNames: [], exactBanned: [], allergyGroupCodes });
  const p = withBrain({ kept: NO_KEPT_FOODS, matchers: groupsOnly(["BIG9-FISH", "BIG9-TREE-NUT"]) }, ask);
  assert.equal(line(p, "omega-3"), "- They have had little omega-3 this week: build the dish on foods rich in it (chia or flax seeds).");
  assert.equal(line(p, "calcium"), "- They have had little calcium this week: build the dish on foods rich in it (yogurt, milk, cheese, tofu, kale).");
  const d = withBrain({ kept: NO_KEPT_FOODS, matchers: groupsOnly(["BIG9-COW-MILK", "BIG9-CRUSTACEAN", "BIG9-EGG", "BIG9-WHEAT"]) }, ask);
  assert.equal(line(d, "calcium"), "- They have had little calcium this week: build the dish on foods rich in it (tofu, sardines, kale).");
  assert.equal(line(d, "iodine"), "- They have had little iodine this week: build the dish on foods rich in it (white fish).");
  assert.equal(line(d, "fibre"), "- They have had little fibre this week: build every dish around a fibre-rich ingredient (lentils, chickpeas, beans, peas, oats, quinoa, brown rice, chia or flax seeds).");
});

test("prompt: today's dish names are capped at the latest 6, 60 characters each, with no semicolons", () => {
  const names = ["Salmon One", "Two", "Three", "Four", "Five;Six", "Seven", `Salmon ${"x".repeat(80)}`];
  const p = withBrain({ kept: SALMON_AND_BEEF, rows: { ...NO_BRAIN_ROWS, todayDishes: names } });
  const used = /make a different dish from: (.*?)\. Different means/.exec(p)![1].split("; ");
  assert.deepEqual(used, ["Two", "Three", "Four", "FiveSix", "Seven", "Salmon"]);
  // Cut at a word, never ending on a connector (live run: "... with Jasmine Rice and .").
  assert.equal(promptDishName("Ground Beef and Spinach Quick Skillet with Jasmine Rice and Fried Egg"), "Ground Beef and Spinach Quick Skillet with Jasmine Rice");
  assert.equal(promptDishName('Beef; "Skillet"\n'), "Beef Skillet");
});

test("prompt: a lunch or dinner request that names no protein leans on the protein a plain main would be built on today", () => {
  const home = { ...SALMON_AND_BEEF, atHome: ["Large eggs"] };
  const stirFry = { ...DINNER, wants: "a stir-fry" };
  const lean = (name: string) => ` If this dish has a protein at its centre, make it ${name}, which they have at home; a dish that needs no protein (pancakes, a salad, a soup) stays as asked.`;
  const proteinLineOf = (p: string) => lineOf(p, "- If this dish has a protein food");
  // The plain dinner for this person and day.
  const plain = /- Build this Dinner on (.+?), which they have at home\./.exec(withBrain({ kept: home }))![1];
  const p = withBrain({ kept: home }, stirFry);
  assert.ok(proteinLineOf(p).endsWith(`a step.${lean(plain)}`), proteinLineOf(p));
  assert.doesNotMatch(p, /Build this/);
  // Beef already open today: Ground beef.
  const beef = withBrain({ kept: home, rows: { ...NO_BRAIN_ROWS, todayDishes: ["Beef and Rice Skillet"] } }, stirFry);
  assert.ok(proteinLineOf(beef).endsWith(`a step.${lean("Ground beef")}`), proteinLineOf(beef));
  // A request naming a protein not at home: rule off, no such sentence.
  const chicken = withBrain({ kept: home }, { ...DINNER, wants: "a chicken dish" });
  assert.doesNotMatch(chicken, /protein at its centre|no other meat/i);
  // A request naming an at-home protein: no lean sentence.
  assert.doesNotMatch(withBrain({ kept: home }, { ...DINNER, wants: "a salmon stir-fry" }), /protein at its centre/);
  // A breakfast request: unchanged.
  const breakfast = withBrain({ kept: home }, { mealType: "breakfast", summary: NO_LOGS, wants: "a stir-fry" });
  assert.ok(proteinLineOf(breakfast).endsWith("not in an ingredient, the dish name, the description or a step."), proteinLineOf(breakfast));
  // Nothing marked: no protein line of this kind at all.
  assert.doesNotMatch(withBrain({ kept: NO_KEPT_FOODS }, stirFry), /protein at its centre/);
});

// Owner, 2026-11-22: protein is a need of the day, not a rule for every dish.
test("prompt: protein is pushed when needed, optional when the week is on track, modest for a kidney condition", () => {
  const day = (protein: number) => (localDate: string) => ({ localDate, meals: 3, calories: 1900, protein, carbs: 220, fibre: 28, sodium: 1500, saturatedFat: 8, addedSugar: 10 });
  const dates = ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"];
  const person = (protein: number | null, patient: object = NOBODY) => withBrain({
    kept: SALMON_AND_BEEF, today: "2026-11-12", patient: patient as never,
    rows: { ...NO_BRAIN_ROWS, ...(protein === null ? {} : { week: { range: { fromDate: "2026-11-06", toDate: "2026-11-12" }, days: dates.map(day(protein)) } }) },
  });
  const HEART = /This protein is the heart of the dish/;
  // Nothing logged, or little protein this week: built on it.
  for (const p of [person(null), person(15)]) {
    assert.match(p, /- Build this Dinner on (Salmon fillets|Ground beef), which they have at home\./);
    assert.match(p, HEART);
  }
  // On track: a dish with no protein is fine; the at-home rule still names the only meats allowed.
  const free = person(55);
  assert.match(free, /- This Dinner does not have to be built on a protein: they are getting enough this week, so a salad, a vegetable plate or a potato dish is fine too\. If it has a protein at its centre, make it (Salmon fillets|Ground beef), which they have at home\. Any other meat, fish or seafood in it must be one of these, which they have at home: Salmon fillets, Ground beef; use no other meat, fish or seafood/);
  assert.doesNotMatch(free, HEART);
  assert.doesNotMatch(free, /- Build this Dinner on/);
  // A muscle goal keeps the push even on track.
  assert.match(person(55, { ...NOBODY, motivations: [{ motivation: { name: "Build muscle" } }] }), /- Build this Dinner on/);
  // A kidney condition: modest.
  const held = person(15, { ...NOBODY, healthConditions: [{ condition: { name: "Chronic kidney disease" } }] });
  assert.match(held, /- Their condition calls for modest protein: keep the protein portion of this Dinner small\. If it has a protein food, make it (Salmon fillets|Ground beef), which they have at home\./);
  assert.doesNotMatch(held, HEART);
});

// Live run, 2026-11-22: one rice bowl four times in a week, and three identical prompts three days running.
test("prompt: the week stays varied: recent dishes are not repeated and each day leans to a different kind of dish", () => {
  const on = (today: string, ask: DishAsk = DINNER, rows = NO_BRAIN_ROWS) =>
    dishSystemPrompt({ ...KEPT_BASE, ask, bannedNames: [], brain: brainFrom({ kept: SALMON_AND_BEEF, rows }), who: { patientId: "p1", today } });
  const style = (p: string) => /- To keep their week varied, make today's (Lunch|Dinner) (.+?) if that suits/.exec(p)?.[2];
  const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"].map((d) => style(on(d)));
  assert.equal(new Set(week).size, 6);
  for (let i = 0; i < 5; i++) assert.notEqual(week[i], week[i + 1]);
  assert.equal(style(on("2026-11-09")), style(on("2026-11-09")));
  // Short of time: nothing slow.
  for (const d of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]) {
    assert.doesNotMatch(style(on(d, { ...DINNER, maxMinutes: 20 }))!, /bake|roast|stew|stuffed/);
  }
  // Not for breakfast, a request or a day plan (which has its own lines).
  for (const ask of [{ mealType: "breakfast" as const, summary: NO_LOGS }, { ...DINNER, wants: "a curry" }, { ...DINNER, dayPlan: true }]) {
    assert.equal(style(on("2026-11-09", ask)), undefined);
  }
  // What their log says they had this week.
  const p = on("2026-11-12", DINNER, { ...NO_BRAIN_ROWS, recentDishes: ["Salmon Rice Bowl", "Beef; Skillet", "Salmon Rice Bowl"] });
  assert.ok(p.split("\n").includes("- They had these in the last few days; make a clearly different dish, not one of these and not a small variation of one (the same protein, starch and way of cooking under another name): Salmon Rice Bowl; Beef Skillet."));
  assert.doesNotMatch(on("2026-11-12"), /in the last few days/);
});
test("prompt: a time limit shorter than breakfast's own is the only one named", () => {
  const p = withBrain({ kept: SALMON_AND_BEEF }, { mealType: "breakfast", summary: NO_LOGS, maxMinutes: 20 });
  assert.match(p, /This is BREAKFAST: morning food, under 20 minutes in total/);
  assert.doesNotMatch(p, /under 30 minutes/);
});

// Live run, 2026-11-22: "behind on protein: build on ... (eggs)" beside "Build this Dinner on Ground beef" put eggs on every dish.
test("prompt: with a protein chosen and pushed, no second line asks to build the dish on protein foods", () => {
  const ask = { ...DINNER, summary: { ...NO_LOGS, little: ["protein", "iron"] } as unknown as LevelSummary };
  const p = withBrain({ kept: { ...SALMON_AND_BEEF, atHome: ["Large eggs", "Spinach"] } }, ask);
  assert.match(p, /- Build this Dinner on /);
  assert.doesNotMatch(p, /little protein this week/);
  assert.match(p, /little iron this week/);
  // Nothing marked: the protein line stays, as before.
  assert.match(withBrain({ kept: NO_KEPT_FOODS }, ask), /little protein this week/);
});

// Owner, 2026-11-22: eggs as the only protein at home.
test("prompt: an eggs-only kitchen gets a main on any meat-free protein, and no meat or fish", () => {
  const eggsOnly: KeptFoods = { proteinKeys: [], proteinNames: [], atHome: ["Large eggs", "Spinach"], favorites: ["Red lentils", "Chicken thighs"] };
  const ask = { ...DINNER, summary: { ...NO_LOGS, little: ["iron"] } as unknown as LevelSummary };
  const p = withBrain({ kept: eggsOnly }, ask);
  assert.equal(lineOf(p, "- Build this Dinner on"), "- Build this Dinner on a meat-free protein: Large eggs, which they have at home, or beans, lentils, chickpeas, tofu, Greek yogurt or cottage cheese. Use no meat, fish or seafood: not in an ingredient, the dish name, the description or a step.");
  assert.doesNotMatch(p, /This protein is the heart of the dish/);
  // Level examples keep the meat-free proteins and drop the meat; a meat-free favourite stays, a meat one goes.
  assert.equal(lineOf(p, "- They have had little iron"), "- They have had little iron this week: include one food rich in it, preferring any they have at home (spinach).");
  assert.match(lineOf(withBrain({ kept: { ...eggsOnly, atHome: ["Large eggs"] } }, ask), "- They have had little iron"), /\(lentils, beans, chickpeas, spinach, tofu\)/);
  assert.match(lineOf(p, "- These are their favourite foods"), /Red lentils/);
  assert.doesNotMatch(lineOf(p, "- These are their favourite foods"), /Chicken/);
  // A request: no "build on", the same freedom.
  const asked = withBrain({ kept: eggsOnly }, { ...DINNER, wants: "a curry" });
  assert.equal(lineOf(asked, "- If this dish has a protein food"), "- If this dish has a protein food, make it Large eggs, which they have at home, or another meat-free one: beans, lentils, chickpeas, tofu, Greek yogurt or cottage cheese. Use no meat, fish or seafood: not in an ingredient, the dish name, the description or a step.");
  // The diet takes its share of the list: soy and milk allergies by group.
  const soyMilk = buildDietMatchers({ allergyNames: [], exactBanned: [], allergyGroupCodes: ["BIG9-SOY", "BIG9-COW-MILK"] });
  assert.match(lineOf(withBrain({ kept: eggsOnly, matchers: soyMilk }, ask), "- Build this Dinner on"), /at home, or beans, lentils or chickpeas\. Use no meat/);
  // Breakfast is as before: only what they have.
  assert.match(withBrain({ kept: eggsOnly }, { mealType: "breakfast", summary: NO_LOGS }), /built on Large eggs/);
  // A day plan still tells lunch from dinner.
  assert.ok(withBrain({ kept: eggsOnly }, { ...DINNER, dayPlan: true }).split("\n").includes(DAY_PLAN_DINNER_LINE));
  // Tofu at home too: the strict line.
  assert.match(withBrain({ kept: { ...eggsOnly, proteinKeys: ["tofu"], proteinNames: ["Extra-firm tofu"] } }, ask), /- Build this Dinner on Extra-firm tofu, which they have at home\./);
});

// Final review, 2026-11-21: a day plan made lunch and dinner at once on the same protein with nothing
// keeping them apart. Each now carries its part of the day.
test("prompt: a day plan's lunch and dinner carry their own line; a plain dish and a breakfast do not", () => {
  const plan = (mealType: "breakfast" | "lunch" | "dinner", dayPlan?: boolean) =>
    withBrain({ kept: SALMON_AND_BEEF }, { mealType, summary: NO_LOGS, ...(dayPlan ? { dayPlan } : {}) }).split("\n");
  assert.equal(DAY_PLAN_LUNCH_LINE, "- This is the day's lunch: make it the lighter, quicker dish (a bowl, a salad, a wrap or a quick skillet).");
  assert.equal(DAY_PLAN_DINNER_LINE, "- This is the day's dinner: make it the fuller cooked dish (a bake, a roast, a braise, stuffed vegetables or a pan dish with a sauce), not a bowl.");
  const lunch = plan("lunch", true);
  const dinner = plan("dinner", true);
  assert.ok(lunch.includes(DAY_PLAN_LUNCH_LINE) && !lunch.includes(DAY_PLAN_DINNER_LINE));
  assert.ok(dinner.includes(DAY_PLAN_DINNER_LINE) && !dinner.includes(DAY_PLAN_LUNCH_LINE));
  // Right after the protein line.
  assert.match(dinner[dinner.indexOf(DAY_PLAN_DINNER_LINE) - 1], /^- Build this Dinner on /);
  // Short of time: the dinner line asks for nothing slow, and the lunch line is as it was.
  const quick = (mealType: "lunch" | "dinner") =>
    withBrain({ kept: SALMON_AND_BEEF }, { mealType, summary: NO_LOGS, dayPlan: true, maxMinutes: 20 }).split("\n");
  assert.equal(DAY_PLAN_QUICK_DINNER_LINE, "- This is the day's dinner: make it the fuller, warm dish (a pan dish with a sauce, or a stir-fry with a cooked side), not a bowl, a salad or a wrap.");
  assert.ok(quick("dinner").includes(DAY_PLAN_QUICK_DINNER_LINE) && !quick("dinner").includes(DAY_PLAN_DINNER_LINE));
  assert.doesNotMatch(quick("dinner").join("\n"), /a bake, a roast, a braise/);
  assert.ok(quick("lunch").includes(DAY_PLAN_LUNCH_LINE));
  // A plain dish_suggest, a breakfast in a plan, and a plan with no protein chosen: no line.
  for (const p of [plan("lunch"), plan("dinner"), plan("breakfast", true), withBrain({ kept: NO_KEPT_FOODS }, { ...DINNER, dayPlan: true }).split("\n")]) {
    assert.ok(!p.includes(DAY_PLAN_LUNCH_LINE) && !p.includes(DAY_PLAN_DINNER_LINE));
  }
});
