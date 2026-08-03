import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planSkill,
  makePlanHandlers,
  PLAN_WRITE_HOURLY_CAP,
  type PlanDeps,
  type PlanMenuRow,
} from "./plan";
import type { ClaraContext } from "../types";
import type { SwapPatientLike } from "@/lib/meal-plan";

const ctx: ClaraContext = {
  patientId: "p1",
  accountId: "a1",
  firstName: "Sam",
  isPremium: false,
  today: "2026-08-03",
  surface: "web",
  disabledSkills: [],
};

const dietPatient: SwapPatientLike = {
  foodAllergies: [],
  foodToAvoid: [],
  foodPreferences: [],
  healthConditions: [],
  motivations: [],
};

const menuRow = (over: Partial<PlanMenuRow> = {}): PlanMenuRow => ({
  id: "menu-1",
  date: new Date(2026, 7, 3), // 2026-08-03 local midnight
  mealTypeId: "mt-dinner",
  mealTypeName: "Dinner",
  recipe: { id: "rec-1", name: "Grilled salmon", calories: 520, protein: 38, carbs: 30, fat: 24, fiber: 4 },
  ...over,
});

const exchangeDTO = (over: Record<string, unknown> = {}) => ({
  id: "x1",
  source: "RESTAURANT" as const,
  localDate: "2026-08-03",
  status: "RESOLVED" as const,
  servings: 2,
  displacedMenuId: "menu-1",
  name: "Pad Thai",
  originLabel: "Sakura",
  emoji: null,
  perServing: { calories: 400, protein: 20, carbs: 50, fat: 12, fiber: 3 },
  incomplete: false,
  eaten: true,
  createdAt: "2026-08-02T10:00:00.000Z",
  ...over,
});

function fakeDeps(over: Partial<PlanDeps> = {}) {
  const calls: Record<string, unknown[]> = {};
  const track = (k: string, v: unknown) => (calls[k] ??= []).push(v);
  const deps: PlanDeps = {
    getPlanMeta: async () => ({ activePlanVersion: 3 }),
    findMenus: async (_p, _v, start, end) => {
      track("findMenus", { start, end });
      return [menuRow()];
    },
    findMenuById: async (menuId) => {
      track("findMenuById", menuId);
      return menuId === "menu-1" ? menuRow() : null;
    },
    completionState: async (_p, localDate) => {
      track("completionState", localDate);
      return { loggedRecipeIds: ["rec-1"], mealRatings: { "rec-1": 1 } };
    },
    getExchanges: async (_p, _v, from, to) => {
      track("getExchanges", { from, to });
      return [];
    },
    findDietPatient: async () => dietPatient,
    findPublicRecipe: async (recipeId) => {
      track("findPublicRecipe", recipeId);
      return recipeId === "rec-alt"
        ? {
            id: "rec-alt",
            name: "Chicken bowl",
            mealTypeId: "mt-dinner",
            calories: 500,
            protein: 35,
            carbs: 45,
            fat: 15,
            family: null,
            subFamily: null,
            dishType: null,
            ingredients: [],
          }
        : null;
    },
    findSameDayMenus: async () => [],
    alternativesFor: async (_p, q) => {
      track("alternativesFor", q);
      return [
        { id: "rec-alt", name: "Chicken bowl", calories: 500, protein: 35, carbs: 45, fat: 15, mealType: null, dishType: null, ingredients: [] },
      ];
    },
    upsertCompletion: async (_p, args) => {
      track("upsertCompletion", args);
      return { action: "created", journalMealId: "jm-1", rating: args.rating };
    },
    createMealLog: async (args) => {
      track("createMealLog", args);
      const data = (args as unknown as { create: Record<string, unknown> }).create;
      return {
        id: "log-1",
        localDate: data.localDate,
        mealType: data.mealType,
        source: data.source,
        name: data.name,
        servings: data.servings,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        fiber: data.fiber,
        incomplete: data.incomplete,
        recipeId: data.recipeId,
        restaurantDishId: null,
        customIngredientId: null,
        journalMealId: null,
        pictureResultId: null,
        fridgeRecipeId: null,
        planExchangeId: null,
        note: null,
        clientRequestId: data.clientRequestId,
        deletedAt: null,
        loggedAt: new Date("2026-08-03T12:00:00Z"),
        updatedAt: new Date("2026-08-03T12:00:00Z"),
      } as never;
    },
    swapMenuRecipe: async (menuId, recipeId) => {
      track("swapMenuRecipe", { menuId, recipeId });
    },
    consumeWriteBudget: async () => true,
    ...over,
  };
  return { deps, calls };
}

const dataOf = (res: unknown) => (res as { ok: true; data: Record<string, unknown> }).data;
const reasonOf = (res: unknown) => (res as { ok: false; reason: string }).reason;

// ── plan_get ──

test("get: single day defaults to ctx.today, maps menus with completion state", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  const res = await h.get(ctx, {});
  assert.equal(res.ok, true);
  const data = dataOf(res) as { from: string; to: string; days: { date: string; meals: Record<string, unknown>[] }[] };
  assert.equal(data.from, "2026-08-03");
  assert.equal(data.to, "2026-08-03");
  assert.equal(data.days.length, 1);
  const meal = data.days[0].meals[0];
  assert.equal(meal.menuId, "menu-1");
  assert.equal(meal.name, "Grilled salmon");
  assert.equal(meal.mealType, "Dinner");
  assert.equal(meal.done, true);
  assert.equal(meal.rating, 1);
  assert.equal(meal.exchange, null);
  assert.deepEqual(calls.completionState, ["2026-08-03"]);
});

test("get: a resolved exchange overlays name, macros (perServing × servings), done and flag", async () => {
  const { deps } = fakeDeps({ getExchanges: async () => [exchangeDTO()] as never });
  const h = makePlanHandlers(deps);
  const res = await h.get(ctx, {});
  const meal = (dataOf(res) as { days: { meals: Record<string, unknown>[] }[] }).days[0].meals[0];
  assert.equal(meal.name, "Pad Thai");
  assert.equal(meal.calories, 800); // 400 × 2
  assert.equal(meal.done, true); // dto.eaten
  assert.deepEqual(meal.exchange, { source: "RESTAURANT", originLabel: "Sakura" });
});

test("get: pending exchanges are listed, not overlaid", async () => {
  const { deps } = fakeDeps({
    getExchanges: async () => [exchangeDTO({ status: "PENDING", displacedMenuId: null, eaten: false })] as never,
  });
  const h = makePlanHandlers(deps);
  const res = await h.get(ctx, {});
  const day = (dataOf(res) as { days: { meals: Record<string, unknown>[]; pendingExchanges: Record<string, unknown>[] }[] }).days[0];
  assert.equal(day.meals[0].name, "Grilled salmon");
  assert.deepEqual(day.pendingExchanges, [{ name: "Pad Thai", originLabel: "Sakura" }]);
});

test("get: weekStart spans 7 days, skips completion lookups, and says so", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  const res = await h.get(ctx, { weekStart: "2026-08-03" });
  const data = dataOf(res) as { from: string; to: string; days: unknown[]; note?: string };
  assert.equal(data.from, "2026-08-03");
  assert.equal(data.to, "2026-08-09");
  assert.equal(data.days.length, 7);
  assert.equal(calls.completionState, undefined);
  assert.match(data.note ?? "", /week view/i);
});

test("get: empty plan is ok:true with a note pointing at the Meal Plan surface", async () => {
  const { deps } = fakeDeps({ findMenus: async () => [] });
  const h = makePlanHandlers(deps);
  const res = await h.get(ctx, {});
  assert.equal(res.ok, true);
  assert.match((dataOf(res) as { note: string }).note, /Meal Plan/);
});

test("get: malformed date is INVALID_INPUT", async () => {
  const h = makePlanHandlers(fakeDeps().deps);
  const res = await h.get(ctx, { date: "tomorrow" });
  assert.equal(res.ok, false);
  assert.equal(reasonOf(res), "INVALID_INPUT");
});

// ── plan_alternatives ──

test("alternatives: requires a menuId from plan_get; unknown id is NOT_FOUND", async () => {
  const h = makePlanHandlers(fakeDeps().deps);
  assert.equal(reasonOf(await h.alternatives(ctx, {})), "INVALID_INPUT");
  assert.equal(reasonOf(await h.alternatives(ctx, { menuId: "ghost" })), "NOT_FOUND");
});

test("alternatives: maps candidates with recipeId + macros, excludes current recipe, passes calorie anchor", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  const res = await h.alternatives(ctx, { menuId: "menu-1" });
  assert.equal(res.ok, true);
  const data = dataOf(res) as { menuId: string; alternatives: Record<string, unknown>[] };
  assert.deepEqual(data.alternatives, [
    { recipeId: "rec-alt", name: "Chicken bowl", calories: 500, protein: 35, carbs: 45, fat: 15 },
  ]);
  assert.deepEqual(calls.alternativesFor, [
    { mealTypeId: "mt-dinner", excludeRecipeId: "rec-1", currentCalories: 520 },
  ]);
});

test("alternatives: empty candidate list is ok:true", async () => {
  const { deps } = fakeDeps({ alternativesFor: async () => [] });
  const h = makePlanHandlers(deps);
  const res = await h.alternatives(ctx, { menuId: "menu-1" });
  assert.equal(res.ok, true);
  assert.deepEqual((dataOf(res) as { alternatives: unknown[] }).alternatives, []);
});

// ── plan_mark_done ──

test("mark_done: maps liked/disliked, completion lands on the MENU's day, toggle is off", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  const res = await h.markDone(ctx, { menuId: "menu-1", rating: "liked" });
  assert.equal(res.ok, true);
  const args = calls.upsertCompletion?.[0] as Record<string, unknown>;
  assert.equal(args.recipeId, "rec-1");
  assert.equal(args.date, "2026-08-03");
  assert.equal(args.rating, 1);
  assert.equal(args.toggle, false);
  const marked = (dataOf(res) as { marked: Record<string, unknown> }).marked;
  assert.equal(marked.action, "created");
  assert.equal(marked.rating, 1);
});

test("mark_done: absent rating stores null; bogus rating is INVALID_INPUT", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  await h.markDone(ctx, { menuId: "menu-1" });
  assert.equal((calls.upsertCompletion?.[0] as Record<string, unknown>).rating, null);
  const res = await h.markDone(ctx, { menuId: "menu-1", rating: "4 stars" });
  assert.equal(reasonOf(res), "INVALID_INPUT");
});

test("mark_done: foreign menu is NOT_FOUND; spent budget is FAILED", async () => {
  const { deps } = fakeDeps();
  const h = makePlanHandlers(deps);
  assert.equal(reasonOf(await h.markDone(ctx, { menuId: "ghost" })), "NOT_FOUND");
  const { deps: broke } = fakeDeps({ consumeWriteBudget: async () => false });
  assert.equal(reasonOf(await makePlanHandlers(broke).markDone(ctx, { menuId: "menu-1" })), "FAILED");
});

// ── plan_log_eaten ──

test("log_eaten: RECIPE funnel — source, recipeId, dedupe key, real recipe macros", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  const res = await h.logEaten(ctx, { menuId: "menu-1" }, "toolu_99");
  assert.equal(res.ok, true);
  const args = calls.createMealLog?.[0] as { create: Record<string, unknown> };
  assert.equal(args.create.source, "RECIPE");
  assert.equal(args.create.recipeId, "rec-1");
  assert.equal(args.create.clientRequestId, "clara:toolu_99");
  assert.equal(args.create.localDate, "2026-08-03"); // ctx.today default
  assert.equal(args.create.mealType, "dinner"); // lowercased from the menu
  assert.equal(args.create.calories, 520); // recipe-priced, not model-priced
});

test("log_eaten: servings and explicit date pass through", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  await h.logEaten(ctx, { menuId: "menu-1", date: "2026-08-02", servings: 2 }, "toolu_1");
  const args = calls.createMealLog?.[0] as { create: Record<string, unknown> };
  assert.equal(args.create.localDate, "2026-08-02");
  assert.equal(args.create.servings, 2);
});

test("log_eaten: missing toolUseId hard-fails (S1 rule)", async () => {
  const h = makePlanHandlers(fakeDeps().deps);
  const res = await h.logEaten(ctx, { menuId: "menu-1" });
  assert.equal(reasonOf(res), "FAILED");
});

test("log_eaten: unmappable menu meal type without an input mealType is INVALID_INPUT", async () => {
  const { deps } = fakeDeps({
    findMenuById: async () => menuRow({ mealTypeName: "Brunch" }),
  });
  const h = makePlanHandlers(deps);
  const res = await h.logEaten(ctx, { menuId: "menu-1" }, "toolu_2");
  assert.equal(reasonOf(res), "INVALID_INPUT");
  const ok = await h.logEaten(ctx, { menuId: "menu-1", mealType: "lunch" }, "toolu_3");
  assert.equal(ok.ok, true);
});

// ── plan_swap_dish ──

test("swap: budget first, then menu and recipe resolution", async () => {
  const { deps } = fakeDeps({ consumeWriteBudget: async () => false });
  assert.equal(reasonOf(await makePlanHandlers(deps).swap(ctx, { menuId: "menu-1", recipeId: "rec-alt" })), "FAILED");
  const h = makePlanHandlers(fakeDeps().deps);
  assert.equal(reasonOf(await h.swap(ctx, { menuId: "ghost", recipeId: "rec-alt" })), "NOT_FOUND");
  assert.equal(reasonOf(await h.swap(ctx, { menuId: "menu-1", recipeId: "ghost" })), "NOT_FOUND");
});

test("swap: a validation failure surfaces the gate's message as INVALID_INPUT", async () => {
  const { deps } = fakeDeps({
    findPublicRecipe: async () => ({
      id: "rec-alt", name: "Wrong-slot dish", mealTypeId: "mt-breakfast",
      calories: 500, protein: 35, carbs: 45, fat: 15,
      family: null, subFamily: null, dishType: null, ingredients: [],
    }),
  });
  const h = makePlanHandlers(deps);
  const res = await h.swap(ctx, { menuId: "menu-1", recipeId: "rec-alt" });
  assert.equal(reasonOf(res), "INVALID_INPUT");
  assert.equal((res as { ok: false; message: string }).message, "Recipe not suitable for this meal slot");
});

test("swap: success swaps the menu row and reports from → to", async () => {
  const { deps, calls } = fakeDeps();
  const h = makePlanHandlers(deps);
  const res = await h.swap(ctx, { menuId: "menu-1", recipeId: "rec-alt" });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.swapMenuRecipe, [{ menuId: "menu-1", recipeId: "rec-alt" }]);
  assert.deepEqual((dataOf(res) as { swapped: unknown }).swapped, {
    menuId: "menu-1",
    from: "Grilled salmon",
    to: "Chicken bowl",
  });
});

// ── schema contract + fragment ──

test("skill shape: five tools in order, isWrite on exactly the three writes, no identity params", () => {
  assert.equal(planSkill.name, "plan");
  const defs = planSkill.tools.map((t) => t.def);
  assert.deepEqual(
    defs.map((d) => d.name),
    ["plan_get", "plan_alternatives", "plan_mark_done", "plan_log_eaten", "plan_swap_dish"]
  );
  assert.deepEqual(
    defs.map((d) => d.isWrite === true),
    [false, false, true, true, true]
  );
  for (const d of defs) {
    for (const banned of ["patientId", "accountId", "userId"]) {
      assert.equal(Object.keys(d.input_schema.properties).includes(banned), false);
    }
  }
  assert.deepEqual(defs[1].input_schema.required, ["menuId"]);
  assert.deepEqual(defs[2].input_schema.required, ["menuId"]);
  assert.deepEqual(defs[3].input_schema.required, ["menuId"]);
  assert.deepEqual(defs[4].input_schema.required, ["menuId", "recipeId"]);
  assert.equal(PLAN_WRITE_HOURLY_CAP, 30);
});

test("fragment: ask-once intake rule, regeneration refusal, binary rating", () => {
  assert.match(planSkill.promptFragment, /ask ONCE/);
  assert.match(planSkill.promptFragment, /regenerate/i);
  assert.match(planSkill.promptFragment, /liked or disliked/i);
});
