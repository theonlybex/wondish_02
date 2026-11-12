import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDishHandlers,
  dishSkill,
  gateGeneratedDishes,
  NOTHING_LOGGED_NOTE,
  COULDNT_FIT_NOTE,
  OCCASION_OPTIONS,
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
  assert.deepEqual(kinds(res.parts), ["levels", "dish", "steps"]);
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
  const [, dish, steps] = res.parts!;
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

test("dish_suggest: a dish that cannot be priced passes sodium null and gets no sodium reason", async () => {
  const unpriced = lentils({
    usesIngredients: ["mystery sauce", "dragonfruit crumble"],
    amounts: [
      { name: "mystery sauce", quantity: 2, unit: "tablespoon" },
      { name: "dragonfruit crumble", quantity: 100, unit: "g" },
    ],
  });
  const { deps } = spy({ summary: LITTLE_FIBRE_LOTS_OF_SODIUM, recipes: [unpriced] });
  const res = await makeDishHandlers(deps).suggest(CTX, { mealType: "dinner" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const dish = dishParts(res.parts)[0];
  assert.equal(dish.recipe!.perServing.sodium, null);
  assert.deepEqual(dish.reasons.map((r) => r.level), ["fibre"]);
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
