import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAllMetrics,
  gradualDailyCals,
  maxDailyDeficit,
  resolvePlanDirection,
} from "./caloric-engine";
import type { MenuRow, BuildResult } from "./meal-plan";

// buildMealPlanMenus reads the prisma singleton from @/lib/db, which resolves
// `globalThis.prisma ?? createPrismaClient()`. Injecting a fabricated data stub
// on globalThis BEFORE the module loads turns the builder into a pure
// data-in/data-out function: three reads (patient, mealType, recipe) feed an
// otherwise deterministic in-memory algorithm. The stub is swapped per test via
// the mutable `db` fixture holder; no network, no real Prisma client.
const db = {
  patient: null as unknown,
  mealTypes: [] as unknown[],
  recipes: [] as any[],
};

(globalThis as any).prisma = {
  patient: { findUnique: async () => db.patient },
  mealType: { findMany: async () => db.mealTypes },
  recipe: {
    findMany: async (args: any) => {
      // Faithful interpretation of the builder's where-clause: an isPublic
      // equality plus an optional NOT-ingredient-name-in filter. Both are
      // honored from the args (not hardcoded) so a source regression that
      // drops isPublic or mode: "insensitive" makes the relevant tests fail.
      let out = db.recipes;
      if (args?.where?.isPublic !== undefined) {
        out = out.filter((r) => r.isPublic === args.where.isPublic);
      }
      const nameFilter = args?.where?.NOT?.ingredients?.some?.ingredient?.name;
      const notIn: string[] | undefined = nameFilter?.in;
      if (notIn) {
        const norm = (s: string) =>
          nameFilter.mode === "insensitive" ? s.toLowerCase() : s;
        const banned = new Set(notIn.map(norm));
        out = out.filter(
          (r) => !r.ingredients.some((ri: any) => banned.has(norm(ri.ingredient.name)))
        );
      }
      return out;
    },
  },
};

// Dynamic import so the assignment above runs before lib/db initialises.
const modPromise = import("./meal-plan");
async function build(patientId: string, start: Date, version = 1): Promise<BuildResult> {
  const { buildMealPlanMenus } = await modPromise;
  return buildMealPlanMenus(patientId, start, version);
}
async function planDayCalories(patientId: string, localDate: string): Promise<number | null> {
  const { getPlanDayCalories } = await modPromise;
  return getPlanDayCalories(patientId, localDate);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MT_B = { id: "mt-b", name: "Breakfast" };
const MT_L = { id: "mt-l", name: "Lunch" };
const MT_D = { id: "mt-d", name: "Dinner" };
const MT_S = { id: "mt-s", name: "Snack" };
const ALL_MT = [MT_B, MT_L, MT_D, MT_S];

function makePatient(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    profileCompleted: true,
    weight: null, weightUnit: null,
    height: null, heightUnit: null,
    birthday: null, sexAtBirth: null, gender: null,
    goalWeight: null, goalWeightUnit: null,
    physicalActivity: null,
    foodAllergies: [], foodToAvoid: [], healthConditions: [],
    foodPreferences: [], motivations: [], dishPreferences: [],
    ...overrides,
  };
}

type RecipeOpts = {
  id: string; mealTypeId: string | null; calories: number | null;
  dishType?: string | null; family?: string | null; subFamily?: string | null;
  protein?: number; carbs?: number; fat?: number; fiber?: number;
  ingredients?: string[]; description?: string | null; isPublic?: boolean;
};
function makeRecipe(o: RecipeOpts) {
  return {
    id: o.id,
    isPublic: o.isPublic ?? true,
    mealTypeId: o.mealTypeId,
    calories: o.calories,
    protein: o.protein ?? 0, carbs: o.carbs ?? 0, fat: o.fat ?? 0, fiber: o.fiber ?? 0,
    family: o.family ?? null,
    subFamily: o.subFamily ?? null,
    dishType: o.dishType === null || o.dishType === undefined
      ? (o.dishType === null ? null : { name: "Complete Meal" })
      : { name: o.dishType },
    ingredients: (o.ingredients ?? [`ing-${o.id}`]).map((n) => ({ ingredient: { name: n } })),
    description: o.description === undefined ? "desc" : o.description,
  };
}

function setDb(patient: unknown, mealTypes: unknown[], recipes: any[]) {
  db.patient = patient;
  db.mealTypes = mealTypes;
  db.recipes = recipes;
}

const START = new Date("2026-06-01T00:00:00");

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function dayKey(d: Date): string {
  return d.toDateString();
}
function groupByDay(rows: MenuRow[]): Map<string, MenuRow[]> {
  const m = new Map<string, MenuRow[]>();
  for (const r of rows) {
    const k = dayKey(r.date);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

// The maintain fallback (no caloric profile) plans a flat 2000 kcal/day:
// breakfast 400, lunch 700, dinner 600, snack 300; day budget 2100; 35 days.

// A pool with exactly one eligible complete meal per slot → fully deterministic.
function fourSlotPool() {
  return [
    makeRecipe({ id: "bf", mealTypeId: MT_B.id, calories: 400, family: "fam-b", subFamily: "sub-b" }),
    makeRecipe({ id: "lu", mealTypeId: MT_L.id, calories: 700, family: "fam-l", subFamily: "sub-l" }),
    makeRecipe({ id: "di", mealTypeId: MT_D.id, calories: 600, family: "fam-d", subFamily: "sub-d" }),
    makeRecipe({ id: "sn", mealTypeId: MT_S.id, calories: 300, family: "fam-s", subFamily: "sub-s" }),
  ];
}

// ─── Guard clauses ───────────────────────────────────────────────────────────

test("throws PATIENT_NOT_FOUND when the patient does not exist", async () => {
  setDb(null, ALL_MT, []);
  await assert.rejects(build("nope", START), /PATIENT_NOT_FOUND/);
});

test("throws PROFILE_INCOMPLETE when onboarding is unfinished", async () => {
  setDb(makePatient({ profileCompleted: false }), ALL_MT, []);
  await assert.rejects(build("p1", START), /PROFILE_INCOMPLETE/);
});

test("an empty recipe catalog yields an empty plan without crashing", async () => {
  setDb(makePatient(), ALL_MT, []);
  const { rows, builtForWeight } = await build("p1", START);
  assert.deepEqual(rows, []);
  assert.equal(builtForWeight, null);
});

// ─── Date math + row stamping (maintain fallback) ────────────────────────────

test("maintain fallback plan spans exactly 35 days from startDate", async () => {
  setDb(makePatient(), ALL_MT, fourSlotPool());
  const { rows, builtForWeight } = await build("p1", START, 7);

  assert.equal(rows.length, 35 * 4, "4 deterministic picks per day for 35 days");
  const days = groupByDay(rows);
  assert.equal(days.size, 35);
  assert.ok(days.has(dayKey(START)), "plan starts on startDate");
  assert.ok(days.has(dayKey(addDays(START, 34))), "last planned day is start + 34");
  assert.ok(!days.has(dayKey(addDays(START, 35))), "no rows past the 35th day");
  for (const r of rows) {
    assert.equal(r.patientId, "p1");
    assert.equal(r.planVersion, 7);
    assert.ok(r.date instanceof Date);
  }
  assert.equal(builtForWeight, null, "no weight on record → null drift anchor");
});

test("each day fills every slot with the matching meal-type recipe", async () => {
  setDb(makePatient(), ALL_MT, fourSlotPool());
  const { rows } = await build("p1", START);
  for (const [, dayRows] of groupByDay(rows)) {
    assert.deepEqual(
      dayRows.map((r) => `${r.mealTypeId}:${r.recipeId}`),
      ["mt-b:bf", "mt-l:lu", "mt-d:di", "mt-s:sn"]
    );
  }
});

test("meal slots are processed breakfast→lunch→dinner→snack regardless of DB order; unknown types get no rows", async () => {
  const scrambled = [MT_S, { id: "mt-x", name: "Brunch" }, MT_D, MT_B, MT_L];
  setDb(makePatient(), scrambled, fourSlotPool());
  const { rows } = await build("p1", START);
  const firstDay = groupByDay(rows).get(dayKey(START))!;
  assert.deepEqual(firstDay.map((r) => r.mealTypeId), ["mt-b", "mt-l", "mt-d", "mt-s"]);
  assert.ok(rows.every((r) => r.mealTypeId !== "mt-x"), "unrecognised meal type stays empty");
});

// ─── Full caloric profile: ramp length, unit wiring, builtForWeight ──────────

const PROFILE_INPUT = {
  sex: "female" as const,
  birthday: new Date("1994-01-01"),
  heightValue: 160, heightUnit: "cm" as const,
  cbwValue: 70, cbwUnit: "kg" as const,
  activityLevel: 2,
  utbwValue: 60, utbwUnit: "kg" as const,
};

// Expected plan length recomputed through the engine's public API: ramp days
// until the gradual deficit hits the plateau, plus a 35-day maintenance buffer.
function expectedLosePlanDays(): number {
  const profile = computeAllMetrics(PROFILE_INPUT);
  assert.equal(resolvePlanDirection(profile), "lose", "fixture must be a lose plan");
  const baseTDEE = Math.round(profile.tdeeCBW);
  const minCal = profile.minCaloriesValue;
  const maxDef = maxDailyDeficit(profile.cbmi);
  const plateau = Math.max(minCal, baseTDEE - maxDef);
  let rampEnd = 35;
  for (let d = 1; d <= 365; d++) {
    if (gradualDailyCals(baseTDEE, d, "lose", minCal, maxDef) <= plateau) { rampEnd = d; break; }
  }
  return rampEnd + 35;
}

function overweightPatient(overrides: Record<string, unknown> = {}) {
  return makePatient({
    weight: 70, weightUnit: "kg",
    height: 160, heightUnit: "cm",
    birthday: new Date("1994-01-01"),
    sexAtBirth: "female",
    goalWeight: 60, goalWeightUnit: "kg",
    physicalActivity: { level: 2 },
    ...overrides,
  });
}

// A calorie ladder of complete meals (no family/subFamily constraints) so a
// breakfast pick exists at every point of the declining calorie schedule.
function breakfastLadder() {
  const out: any[] = [];
  for (let cal = 100; cal <= 800; cal += 50) {
    out.push(makeRecipe({ id: `bl-${cal}`, mealTypeId: MT_B.id, calories: cal }));
  }
  return out;
}

test("lose plan runs the gradual ramp to its plateau plus a 35-day buffer", async () => {
  setDb(overweightPatient(), ALL_MT, breakfastLadder());
  const { rows, builtForWeight } = await build("p1", START);
  const expected = expectedLosePlanDays();
  assert.ok(expected > 35 && expected <= 365 + 35, "a real deficit ramp must outlast the flat maintain plan");
  const days = groupByDay(rows);
  assert.equal(days.size, expected, "one planned day per date up to ramp end + buffer");
  assert.ok(days.has(dayKey(addDays(START, expected - 1))));
  assert.ok(!days.has(dayKey(addDays(START, expected))));
  assert.equal(builtForWeight, 70, "drift anchor comes from the weight the plan was built with");
});

// Underweight fixture with a healthy-band goal above current weight → gain.
const GAIN_PROFILE_INPUT = {
  sex: "female" as const,
  birthday: new Date("1994-01-01"),
  heightValue: 170, heightUnit: "cm" as const,
  cbwValue: 50, cbwUnit: "kg" as const,
  activityLevel: 2,
  utbwValue: 60, utbwUnit: "kg" as const,
};

function expectedGainPlanDays(): number {
  const profile = computeAllMetrics(GAIN_PROFILE_INPUT);
  assert.equal(resolvePlanDirection(profile), "gain", "fixture must be a gain plan");
  const baseTDEE = Math.round(profile.tdeeCBW);
  const minCal = profile.minCaloriesValue;
  const maxDef = maxDailyDeficit(profile.cbmi);
  const ceiling = Math.round(baseTDEE + maxDef);
  let rampEnd = 35;
  for (let d = 1; d <= 365; d++) {
    if (gradualDailyCals(baseTDEE, d, "gain", minCal, maxDef) >= ceiling) { rampEnd = d; break; }
  }
  return rampEnd + 35;
}

test("gain plan ramps the surplus to its severity-scaled ceiling plus a 35-day buffer", async () => {
  setDb(makePatient({
    weight: 50, weightUnit: "kg",
    height: 170, heightUnit: "cm",
    birthday: new Date("1994-01-01"),
    sexAtBirth: "female",
    goalWeight: 60, goalWeightUnit: "kg",
    physicalActivity: { level: 2 },
  }), ALL_MT, breakfastLadder());
  const { rows, builtForWeight } = await build("p1", START);
  const expected = expectedGainPlanDays();
  assert.ok(expected > 35 && expected <= 365 + 35, "surplus ramp must outlast the flat maintain plan");
  const days = groupByDay(rows);
  assert.equal(days.size, expected, "one planned day per date up to ramp end + buffer");
  assert.ok(days.has(dayKey(addDays(START, expected - 1))));
  assert.ok(!days.has(dayKey(addDays(START, expected))));
  assert.equal(builtForWeight, 50);
});

test("sex resolution falls back to the gender relation when sexAtBirth is missing", async () => {
  setDb(overweightPatient({ sexAtBirth: null, gender: { name: "Female" } }), ALL_MT, breakfastLadder());
  const viaGender = await build("p1", START);
  assert.equal(groupByDay(viaGender.rows).size, expectedLosePlanDays(), "profile computed → ramp plan");

  setDb(overweightPatient({ sexAtBirth: null, gender: null }), ALL_MT, breakfastLadder());
  const noSex = await build("p1", START);
  assert.equal(groupByDay(noSex.rows).size, 35, "unresolvable sex → 2000 kcal maintain fallback");
});

// ─── Selection: dinner pool, dinner cap, family/subFamily constraints ────────

test("dinner draws from lunch-typed recipes but is stamped with the dinner meal type", async () => {
  // d1 (380 kcal) is below the lunch window minimum (385) so lunch always
  // takes lu1; dinner's eligible pool includes lunch-typed recipes.
  const pool = [
    makeRecipe({ id: "lu1", mealTypeId: MT_L.id, calories: 700, family: "A" }),
    makeRecipe({ id: "d1", mealTypeId: MT_L.id, calories: 380, family: "B" }),
  ];
  setDb(makePatient(), [MT_L, MT_D, MT_S], pool);
  const { rows } = await build("p1", START);
  const dinnerRows = rows.filter((r) => r.mealTypeId === MT_D.id);
  assert.ok(dinnerRows.length > 0, "dinner slot must be served from the lunch pool");
  assert.ok(dinnerRows.every((r) => r.recipeId === "d1"));
  assert.ok(rows.filter((r) => r.mealTypeId === MT_L.id).every((r) => r.recipeId === "lu1"));
});

test("dinner is capped below lunch when lunch was well-served", async () => {
  // Lunch hits its 700 target → dinner cap = 699 → the 750 kcal dish is out.
  setDb(makePatient(), [MT_L, MT_D, MT_S], [
    makeRecipe({ id: "lu1", mealTypeId: MT_L.id, calories: 700, family: "A" }),
    makeRecipe({ id: "big", mealTypeId: MT_D.id, calories: 750, family: "B" }),
  ]);
  const capped = await build("p1", START);
  assert.equal(capped.rows.filter((r) => r.mealTypeId === MT_D.id).length, 0,
    "an over-lunch dinner must not be planned");

  // Lunch under-performs (400 < 85% of 700) → cap released, 750 kcal fits.
  setDb(makePatient(), [MT_L, MT_D, MT_S], [
    makeRecipe({ id: "lu-small", mealTypeId: MT_L.id, calories: 400, family: "A" }),
    makeRecipe({ id: "big", mealTypeId: MT_D.id, calories: 750, family: "B" }),
  ]);
  const released = await build("p1", START);
  const dinner = released.rows.filter((r) => r.mealTypeId === MT_D.id);
  assert.ok(dinner.length > 0 && dinner.every((r) => r.recipeId === "big"),
    "cap must not cascade when lunch under-performed");
});

test("a family used earlier in the day blocks later picks that share it", async () => {
  setDb(makePatient(), [MT_L, MT_D, MT_S], [
    makeRecipe({ id: "lu1", mealTypeId: MT_L.id, calories: 700, family: "protein" }),
    makeRecipe({ id: "clash", mealTypeId: MT_D.id, calories: 500, family: "protein" }),
    makeRecipe({ id: "ok", mealTypeId: MT_D.id, calories: 500, family: "other" }),
  ]);
  const { rows } = await build("p1", START);
  const dinner = rows.filter((r) => r.mealTypeId === MT_D.id);
  assert.ok(dinner.length > 0);
  assert.ok(dinner.every((r) => r.recipeId === "ok"), "same-family dish must never be picked the same day");
});

test("beverages outside fruity/veggie families are exempt from the daily family constraint", async () => {
  const lunchSameFamily = makeRecipe({ id: "lu1", mealTypeId: MT_L.id, calories: 700, family: "fruit" });
  // Breakfast beverage, family "fruit": exempt → lunch may reuse the family.
  setDb(makePatient(), [MT_B, MT_L, MT_S], [
    makeRecipe({ id: "bev", mealTypeId: MT_B.id, calories: 400, dishType: "Beverage", family: "fruit" }),
    lunchSameFamily,
  ]);
  const withBev = await build("p1", START);
  assert.ok(withBev.rows.some((r) => r.mealTypeId === MT_L.id && r.recipeId === "lu1"),
    "beverage family must not block lunch");

  // Same shape but a solid breakfast dish: family sticks, lunch is blocked.
  setDb(makePatient(), [MT_B, MT_L, MT_S], [
    makeRecipe({ id: "solid", mealTypeId: MT_B.id, calories: 400, dishType: "Solid Dish", family: "fruit" }),
    lunchSameFamily,
  ]);
  const withSolid = await build("p1", START);
  assert.equal(withSolid.rows.filter((r) => r.mealTypeId === MT_L.id).length, 0,
    "non-beverage family must block the same-family lunch");

  // Fruity beverage: NOT exempt.
  setDb(makePatient(), [MT_B, MT_L, MT_S], [
    makeRecipe({ id: "fruity-bev", mealTypeId: MT_B.id, calories: 400, dishType: "Beverage", family: "fruity mix" }),
    makeRecipe({ id: "lu2", mealTypeId: MT_L.id, calories: 700, family: "fruity mix" }),
  ]);
  const withFruity = await build("p1", START);
  assert.equal(withFruity.rows.filter((r) => r.mealTypeId === MT_L.id).length, 0,
    "fruity beverage family must still block");
});

test("dessert tops up an under-target lunch but never repeats the meal's subFamily", async () => {
  setDb(makePatient(), [MT_L], [
    makeRecipe({ id: "lu1", mealTypeId: MT_L.id, calories: 500, family: "famA", subFamily: "pasta" }),
    makeRecipe({ id: "ds-clash", mealTypeId: MT_L.id, calories: 200, dishType: "Dessert", subFamily: "pasta" }),
    makeRecipe({ id: "ds-ok", mealTypeId: MT_L.id, calories: 200, dishType: "Dessert", subFamily: "cake" }),
  ]);
  const { rows } = await build("p1", START);
  for (const [, dayRows] of groupByDay(rows)) {
    assert.deepEqual(dayRows.map((r) => r.recipeId), ["lu1", "ds-ok"],
      "main then dessert, and never the subFamily clash");
  }
});

test("main dish + sides fill in priority order and stop once 90% of target is reached", async () => {
  // Lunch target 700: main 500 → veggie 100 → starchy 50 reaches 650 ≥ 630;
  // the fruity side must never be queried.
  setDb(makePatient(), [MT_L], [
    makeRecipe({ id: "main", mealTypeId: MT_L.id, calories: 500, dishType: "Main Dish", family: "fM" }),
    makeRecipe({ id: "veg", mealTypeId: MT_L.id, calories: 100, dishType: "Veggie Side Dish", family: "fV" }),
    makeRecipe({ id: "starch", mealTypeId: MT_L.id, calories: 50, dishType: "Starchy Side Dish", family: "fS" }),
    makeRecipe({ id: "fruit", mealTypeId: MT_L.id, calories: 50, dishType: "Fruity Side Dish", family: "fF" }),
  ]);
  const { rows } = await build("p1", START);
  for (const [, dayRows] of groupByDay(rows)) {
    assert.deepEqual(dayRows.map((r) => r.recipeId), ["main", "veg", "starch"]);
  }
  assert.ok(rows.every((r) => r.recipeId !== "fruit"), "fruity side skipped once target coverage reached");
});

test("generic filler is added when a meal stays under 70% of its target", async () => {
  // Lunch 400/700 = 57% → filler window [75, 330] picks the 200 kcal dish.
  setDb(makePatient(), [MT_L], [
    makeRecipe({ id: "lu-small", mealTypeId: MT_L.id, calories: 400, family: "A", subFamily: "sA" }),
    makeRecipe({ id: "filler", mealTypeId: MT_L.id, calories: 200, dishType: "Solid Dish", family: "B", subFamily: "sB" }),
  ]);
  const { rows } = await build("p1", START);
  for (const [, dayRows] of groupByDay(rows)) {
    assert.deepEqual(dayRows.map((r) => r.recipeId), ["lu-small", "filler"]);
  }
});

// ─── Weekly rotation ─────────────────────────────────────────────────────────

test("a recipe used one day is not repeated the next day while alternatives remain", async () => {
  setDb(makePatient(), [MT_L, MT_S], [
    makeRecipe({ id: "A", mealTypeId: MT_L.id, calories: 700 }),
    makeRecipe({ id: "B", mealTypeId: MT_L.id, calories: 700 }),
  ]);
  const { rows } = await build("p1", START);
  const byDay = groupByDay(rows);
  assert.equal(byDay.size, 35, "reuse fallback keeps every day planned even with a 2-recipe pool");
  const lunchOn = (n: number) => byDay.get(dayKey(addDays(START, n)))![0].recipeId;
  assert.notEqual(lunchOn(0), lunchOn(1), "day 2 must rotate away from day 1's pick");
  assert.notEqual(lunchOn(7), lunchOn(8), "rotation restarts cleanly after the weekly reset");
  assert.ok(rows.every((r) => r.recipeId === "A" || r.recipeId === "B"));
});

// ─── Allergy + banned-ingredient filtering ───────────────────────────────────

test("allergy names ban by word boundary: compounds and plurals match, substrings do not", async () => {
  const patient = makePatient({
    foodAllergies: [
      { food: { name: "Peanuts", bannedIngredients: [] } },
      { food: { name: "Egg", bannedIngredients: [] } },
      { food: { name: "Dairy", bannedIngredients: [{ name: "Milk" }] } },
    ],
  });
  setDb(patient, [MT_L, MT_S], [
    makeRecipe({ id: "roasted", mealTypeId: MT_L.id, calories: 700, ingredients: ["roasted peanuts"] }),
    makeRecipe({ id: "pb", mealTypeId: MT_L.id, calories: 700, ingredients: ["peanut butter"] }),
    makeRecipe({ id: "eggs", mealTypeId: MT_L.id, calories: 700, ingredients: ["eggs"] }),
    makeRecipe({ id: "milky", mealTypeId: MT_L.id, calories: 700, ingredients: ["whole milk"] }),
    makeRecipe({ id: "eggplant", mealTypeId: MT_L.id, calories: 700, ingredients: ["eggplant"] }),
    makeRecipe({ id: "peas", mealTypeId: MT_L.id, calories: 700, ingredients: ["pea", "rice"] }),
  ]);
  const { rows } = await build("p1", START);
  const picked = new Set(rows.map((r) => r.recipeId));
  for (const bannedId of ["roasted", "pb", "eggs", "milky"]) {
    assert.ok(!picked.has(bannedId), `${bannedId} contains an allergen and must never appear`);
  }
  // With only two safe recipes, weekly rotation guarantees both are used.
  assert.ok(picked.has("eggplant"), "'egg' must not ban 'eggplant' (word boundary)");
  assert.ok(picked.has("peas"), "'peanut' must not ban 'pea' (word boundary)");
});

test("foods-to-avoid are excluded via the exact-name DB filter", async () => {
  const patient = makePatient({ foodToAvoid: [{ food: { name: "Cilantro" } }] });
  setDb(patient, [MT_L, MT_S], [
    makeRecipe({ id: "with-cilantro", mealTypeId: MT_L.id, calories: 700, ingredients: ["cilantro", "rice"] }),
    makeRecipe({ id: "with-basil", mealTypeId: MT_L.id, calories: 700, ingredients: ["basil", "rice"] }),
  ]);
  const { rows } = await build("p1", START);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.recipeId === "with-basil"));
});

test("health-condition banned ingredients feed the exact-name DB filter", async () => {
  const patient = makePatient({
    healthConditions: [
      { condition: { name: "Gout", bannedIngredients: [{ name: "Anchovies" }] } },
    ],
  });
  setDb(patient, [MT_L, MT_S], [
    makeRecipe({ id: "with-anchovies", mealTypeId: MT_L.id, calories: 700, ingredients: ["anchovies", "rice"] }),
    makeRecipe({ id: "safe", mealTypeId: MT_L.id, calories: 700, ingredients: ["tofu", "rice"] }),
  ]);
  const { rows } = await build("p1", START);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.recipeId === "safe"));
});

test("non-public recipes are never planned", async () => {
  setDb(makePatient(), [MT_L, MT_S], [
    makeRecipe({ id: "private", mealTypeId: MT_L.id, calories: 700, isPublic: false }),
    makeRecipe({ id: "public", mealTypeId: MT_L.id, calories: 700 }),
  ]);
  const { rows } = await build("p1", START);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.recipeId === "public"),
    "isPublic: false must be excluded by the catalog query");
});

// ─── Motivation / preference scoring ─────────────────────────────────────────

test("motivation scoring: with 'Build muscle', the zero-protein recipe never survives the top-3 cut", async () => {
  const patient = makePatient({
    motivations: [{ motivation: { name: "Build muscle", bannedIngredients: [] } }],
  });
  const pool = [];
  for (let i = 1; i <= 9; i++) {
    pool.push(makeRecipe({ id: `p${i}`, mealTypeId: MT_L.id, calories: 500, protein: i * 5 }));
  }
  pool.push(makeRecipe({ id: "no-protein", mealTypeId: MT_L.id, calories: 500, protein: 0 }));
  setDb(patient, [MT_L, MT_S], pool);
  const { rows } = await build("p1", START);
  const lunches = rows.filter((r) => r.mealTypeId === MT_L.id);
  assert.equal(lunches.length, 35, "one lunch per day");
  // 10 candidates, ≤7 picks per weekly window: the lowest-scored recipe is
  // never inside the shuffled top-3, so it can never be selected.
  assert.ok(lunches.every((r) => r.recipeId !== "no-protein"));
});

test("liked-dish affinity: the only recipe missing the loved ingredient is never picked", async () => {
  const patient = makePatient({
    dishPreferences: [
      { liked: true, recipe: { ingredients: [{ ingredient: { name: "Tofu" } }] } },
    ],
  });
  const pool = [];
  for (let i = 1; i <= 9; i++) {
    pool.push(makeRecipe({ id: `t${i}`, mealTypeId: MT_L.id, calories: 500, ingredients: ["tofu", `extra-${i}`] }));
  }
  pool.push(makeRecipe({ id: "plain", mealTypeId: MT_L.id, calories: 500, ingredients: ["plain"] }));
  setDb(patient, [MT_L, MT_S], pool);
  const { rows } = await build("p1", START);
  assert.equal(rows.length, 35);
  assert.ok(rows.every((r) => r.recipeId !== "plain"));
});

test("novelty scoring: a recipe made only of already-seen ingredients ranks last and is never picked", async () => {
  const patient = makePatient({
    dishPreferences: [
      // Disliked → contributes to seen ingredients but not to affinity.
      { liked: false, recipe: { ingredients: [{ ingredient: { name: "Okra" } }] } },
    ],
  });
  const pool = [];
  for (let i = 1; i <= 9; i++) {
    pool.push(makeRecipe({ id: `n${i}`, mealTypeId: MT_L.id, calories: 500, ingredients: [`new-${i}`] }));
  }
  pool.push(makeRecipe({ id: "seen-only", mealTypeId: MT_L.id, calories: 500, ingredients: ["okra"] }));
  setDb(patient, [MT_L, MT_S], pool);
  const { rows } = await build("p1", START);
  assert.equal(rows.length, 35);
  assert.ok(rows.every((r) => r.recipeId !== "seen-only"));
});

// ─── Snack content relaxation + calorie top-up ───────────────────────────────

test("snack slot accepts bare items (no ingredients/description); other slots do not", async () => {
  setDb(makePatient(), ALL_MT, [
    makeRecipe({ id: "bare-snack", mealTypeId: MT_S.id, calories: 300, ingredients: [], description: null }),
    makeRecipe({ id: "bare-breakfast", mealTypeId: MT_B.id, calories: 400, ingredients: [], description: null }),
  ]);
  const { rows } = await build("p1", START);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.mealTypeId === MT_S.id && r.recipeId === "bare-snack"),
    "only the snack slot may serve content-incomplete recipes");
});

test("day top-up pads with snack recipes until ≥90% of the day target, max 4 extras", async () => {
  // Breakfast 400 → shortfall vs 2000; four 400 kcal snacks close it to 2000.
  const pool = [makeRecipe({ id: "bf", mealTypeId: MT_B.id, calories: 400 })];
  for (let i = 1; i <= 6; i++) {
    pool.push(makeRecipe({ id: `s${i}`, mealTypeId: MT_S.id, calories: 400, dishType: "Snack" }));
  }
  setDb(makePatient(), ALL_MT, pool);
  const { rows } = await build("p1", START);
  for (const [, dayRows] of groupByDay(rows)) {
    assert.equal(dayRows.length, 5, "1 breakfast + exactly 4 top-up snacks");
    assert.equal(dayRows[0].recipeId, "bf");
    const extras = dayRows.slice(1);
    assert.ok(extras.every((r) => r.mealTypeId === MT_S.id && r.recipeId.startsWith("s")));
    const total = 400 + extras.length * 400;
    assert.equal(total, 2000, "top-up stops once the 90% threshold (1800) is crossed");
  }
});

test("no top-up when the meal plan has no snack meal type at all", async () => {
  // Only breakfast/lunch/dinner meal types exist — no "snack" row in the DB.
  // Per-meal calories are deliberately above each step's filler thresholds so
  // exactly one recipe lands per meal, but the day total (1500) still lands
  // under the 90% top-up floor (1800) — the exact condition that used to
  // trigger a fallback top-up stamped with a non-snack meal type.
  const mealTypes = [MT_B, MT_L, MT_D];
  const pool = [
    makeRecipe({ id: "bf", mealTypeId: MT_B.id, calories: 350 }),
    makeRecipe({ id: "ln", mealTypeId: MT_L.id, calories: 650 }),
    makeRecipe({ id: "dn", mealTypeId: MT_D.id, calories: 500 }),
  ];
  const calsById: Record<string, number> = { bf: 350, ln: 650, dn: 500 };
  setDb(makePatient(), mealTypes, pool);
  const { rows } = await build("p1", START);
  for (const [, dayRows] of groupByDay(rows)) {
    assert.equal(dayRows.length, 3, "no snack meal type exists, so no top-up rows are added");
    assert.ok(
      dayRows.every((r) => r.mealTypeId === MT_B.id || r.mealTypeId === MT_L.id || r.mealTypeId === MT_D.id),
      "every row belongs to one of the three real meal types, never a borrowed one"
    );
    const total = dayRows.reduce((s, r) => s + calsById[r.recipeId], 0);
    assert.equal(total, 1500, "day lands under the 90% floor and stays there with no top-up attempted");
  }
});

test("planned day calories never exceed the 105% day budget", async () => {
  // Rich pool with zero family/subFamily constraints: the only thing keeping
  // days at ~target is the calorie-window clamping. Budget = 2000 * 1.05.
  const pool: any[] = [];
  const specs: Array<[string, string]> = [
    ["Complete Meal", "cm"], ["Main Dish", "md"], ["Dessert", "de"], ["Snack", "sk"],
  ];
  let n = 0;
  for (const [dish, tag] of specs) {
    for (let cal = 100; cal <= 900; cal += 100) {
      for (const mt of ALL_MT) {
        pool.push(makeRecipe({ id: `${tag}-${mt.id}-${cal}-${n++}`, mealTypeId: mt.id, calories: cal, dishType: dish }));
      }
    }
  }
  setDb(makePatient(), ALL_MT, pool);
  const { rows } = await build("p1", START);
  const calsById = new Map(pool.map((r) => [r.id, r.calories as number]));
  for (const [day, dayRows] of groupByDay(rows)) {
    const total = dayRows.reduce((s, r) => s + (calsById.get(r.recipeId) ?? 0), 0);
    assert.ok(total <= 2000 * 1.05 + 1e-9, `${day}: ${total} kcal exceeds the 2100 day budget`);
  }
});

// ─── getPlanDayCalories ──────────────────────────────────────────────────────
// One ramp computation shared by /api/meal-plan GET and tracking's daily
// target derivation. Reuses the same `db.patient` prisma stub as buildMealPlanMenus.

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("getPlanDayCalories: returns null when the patient is not found", async () => {
  setDb(null, [], []);
  assert.equal(await planDayCalories("missing", "2026-06-01"), null);
});

test("getPlanDayCalories: returns null when the caloric profile is incomplete (no mealPlanStartDate)", async () => {
  setDb(makePatient(), [], []); // all profile fields null by default
  assert.equal(await planDayCalories("p1", "2026-06-01"), null);
});

test("getPlanDayCalories: returns null when localDate precedes the plan start (dayNumber < 1)", async () => {
  setDb(
    makePatient({
      mealPlanStartDate: new Date("2026-06-10"),
      weight: 70, weightUnit: "kg", height: 165, heightUnit: "cm",
      birthday: new Date("1994-01-01"), sexAtBirth: "female",
      physicalActivity: { level: 2 },
    }),
    [], []
  );
  assert.equal(await planDayCalories("p1", "2026-06-01"), null);
});

test("getPlanDayCalories: matches a direct gradualDailyCals computation for day 1 of the plan", async () => {
  const planStart = new Date("2026-06-01");
  const patient = makePatient({
    mealPlanStartDate: planStart,
    weight: 70, weightUnit: "kg", height: 165, heightUnit: "cm",
    birthday: new Date("1994-01-01"), sexAtBirth: "female",
    physicalActivity: { level: 2 },
    goalWeight: 60, goalWeightUnit: "kg",
  });
  setDb(patient, [], []);

  const profile = computeAllMetrics({
    sex: "female", birthday: new Date("1994-01-01"),
    heightValue: 165, heightUnit: "cm",
    cbwValue: 70, cbwUnit: "kg",
    activityLevel: 2,
    utbwValue: 60, utbwUnit: "kg",
  });
  const expected = gradualDailyCals(
    Math.round(profile.tdeeCBW), 1, resolvePlanDirection(profile),
    profile.minCaloriesValue, maxDailyDeficit(profile.cbmi)
  );

  assert.equal(await planDayCalories("p1", toLocalDateStr(planStart)), expected);
});

test("getPlanDayCalories: falls back to gender when sexAtBirth is missing", async () => {
  const planStart = new Date("2026-06-01");
  setDb(
    makePatient({
      mealPlanStartDate: planStart,
      weight: 70, weightUnit: "kg", height: 165, heightUnit: "cm",
      birthday: new Date("1994-01-01"), sexAtBirth: null,
      gender: { name: "Female" },
      physicalActivity: { level: 2 },
    }),
    [], []
  );
  assert.notEqual(await planDayCalories("p1", toLocalDateStr(planStart)), null);
});

// ─── 2026-07-24 logic-audit Task 4: exact bans filter the pool by phrase ────
//
// The SQL exact-name pushdown ("name in [...]") let "brown sugar" through a
// "sugar" condition-ban. The pool now applies evaluateDishAgainstProfile
// in-memory (same two-stage pattern as the allergy matchers).

test("audit-T4: condition-ban 'sugar' excludes a 'brown sugar' recipe from the plan", async () => {
  const patient = makePatient({
    healthConditions: [{ condition: { name: "Diabetes", bannedIngredients: [{ name: "sugar" }] } }],
  });
  const pool = [
    makeRecipe({ id: "bf-sugar", mealTypeId: MT_B.id, calories: 400, family: "f1", subFamily: "s1", ingredients: ["brown sugar", "oats"] }),
    makeRecipe({ id: "bf-clean", mealTypeId: MT_B.id, calories: 400, family: "f2", subFamily: "s2", ingredients: ["oats"] }),
    makeRecipe({ id: "lu", mealTypeId: MT_L.id, calories: 700, family: "f3", subFamily: "s3" }),
    makeRecipe({ id: "d", mealTypeId: MT_D.id, calories: 600, family: "f4", subFamily: "s4" }),
    makeRecipe({ id: "sn", mealTypeId: MT_S.id, calories: 300, family: "f5", subFamily: "s5" }),
  ];
  setDb(patient, ALL_MT, pool);
  const { rows } = await build("p1", START);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.recipeId !== "bf-sugar"), "brown-sugar recipe must never be planned");
  assert.ok(rows.some((r) => r.recipeId === "bf-clean"), "clean breakfast still planned");
});

// ─── deriveLoggedRecipeIds (log-to-numbers sync fix, 2026-07-30) ────────────
test("deriveLoggedRecipeIds: unions journal completions with live intake logs, deduped, order-stable", async () => {
  const { deriveLoggedRecipeIds } = await modPromise;
  assert.deepEqual(deriveLoggedRecipeIds(["r1", "r2"], ["r2", "r3", "r3"]), ["r1", "r2", "r3"]);
});

test("deriveLoggedRecipeIds: either side empty passes the other through", async () => {
  const { deriveLoggedRecipeIds } = await modPromise;
  assert.deepEqual(deriveLoggedRecipeIds([], ["r9"]), ["r9"]);
  assert.deepEqual(deriveLoggedRecipeIds(["r1"], []), ["r1"]);
  assert.deepEqual(deriveLoggedRecipeIds([], []), []);
});
