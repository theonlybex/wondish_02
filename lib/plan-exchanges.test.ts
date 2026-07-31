import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toExchangeDTO,
  splitByStatus,
  displacedMenuIdSet,
  localDayWindow,
  type ExchangeRowLike,
} from "./plan-exchanges";

const base: ExchangeRowLike = {
  id: "x1",
  localDate: "2026-07-30",
  planVersion: 3,
  status: "PENDING",
  displacedMenuId: null,
  servings: 1,
  name: "Salmon Teriyaki",
  createdAt: new Date("2026-07-30T10:00:00Z"),
  calories: 620,
  protein: 40,
  carbs: 55,
  fat: 22,
  fiber: 4,
};

describe("toExchangeDTO", () => {
  it("maps a restaurant row: originLabel = restaurantName, emoji null, incomplete carried", () => {
    const dto = toExchangeDTO({ ...base, restaurantName: "Ristorante Roma", incomplete: true }, "RESTAURANT", new Set());
    assert.equal(dto.originLabel, "Ristorante Roma");
    assert.equal(dto.emoji, null);
    assert.equal(dto.incomplete, true);
    assert.equal(dto.source, "RESTAURANT");
    assert.equal(dto.eaten, false);
    assert.equal(dto.perServing.calories, 620);
  });

  it("maps a fridge row: originLabel 'Your fridge', incomplete false, emoji carried", () => {
    const dto = toExchangeDTO({ ...base, emoji: "🍳" }, "FRIDGE", new Set());
    assert.equal(dto.originLabel, "Your fridge");
    assert.equal(dto.emoji, "🍳");
    assert.equal(dto.incomplete, false);
  });

  it("derives eaten from the id set", () => {
    const dto = toExchangeDTO({ ...base, restaurantName: "R" }, "RESTAURANT", new Set(["x1"]));
    assert.equal(dto.eaten, true);
  });
});

describe("splitByStatus / displacedMenuIdSet", () => {
  const p = toExchangeDTO({ ...base, restaurantName: "R" }, "RESTAURANT", new Set());
  const r = toExchangeDTO(
    { ...base, id: "x2", status: "RESOLVED", displacedMenuId: "m9", restaurantName: "R" },
    "RESTAURANT",
    new Set()
  );

  it("splits pending vs resolved", () => {
    const s = splitByStatus([p, r]);
    assert.deepEqual(s.pending.map((d) => d.id), ["x1"]);
    assert.deepEqual(s.resolved.map((d) => d.id), ["x2"]);
  });

  it("collects displaced menu ids from RESOLVED rows only", () => {
    assert.deepEqual([...displacedMenuIdSet([p, r])], ["m9"]);
  });
});

describe("localDayWindow", () => {
  it("returns local midnight → end-of-day", () => {
    const w = localDayWindow("2026-07-30");
    assert.ok(w);
    assert.equal(w!.start.getHours(), 0);
    assert.equal(w!.end.getHours(), 23);
    assert.equal(w!.start.getDate(), 30);
  });

  it("rejects garbage", () => {
    assert.equal(localDayWindow("2026-7-30"), null);
  });
});

// ── parseRestaurantExchangeInput (Task E3) ──────────────────────────────────
import { parseRestaurantExchangeInput } from "./plan-exchanges";

describe("parseRestaurantExchangeInput", () => {
  it("accepts minimal valid input, defaults servings to 1", () => {
    const r = parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30" });
    assert.ok(r.ok && r.value.servings === 1 && r.value.restaurantDishId === "d1");
  });

  it("rejects missing dish id, bad localDate, out-of-range servings", () => {
    assert.equal(parseRestaurantExchangeInput({ localDate: "2026-07-30" }).ok, false);
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "yesterday" }).ok, false);
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30", servings: 0 }).ok, false);
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30", servings: 21 }).ok, false);
  });

  it("rejects client-supplied macros — server prices RESTAURANT (standing rule 3)", () => {
    assert.equal(parseRestaurantExchangeInput({ restaurantDishId: "d1", localDate: "2026-07-30", calories: 100 }).ok, false);
  });
});

// ── parseFridgeExchangeInput (Task E4) ──────────────────────────────────────
import { parseFridgeExchangeInput } from "./plan-exchanges";

describe("parseFridgeExchangeInput", () => {
  const recipe = {
    id: "f1", name: "Veggie Omelette", description: "", emoji: "🍳",
    usesIngredients: ["eggs"], missingIngredients: [], steps: ["whisk"],
    mealType: "breakfast", servings: 1,
    perServing: { calories: 320, protein: 22, carbs: 4, fat: 24, fiber: 1 },
    fitsPlan: true, conflicts: [],
  };

  it("accepts valid input, defaults servings to 1", () => {
    const r = parseFridgeExchangeInput({ localDate: "2026-07-30", recipe });
    assert.ok(r.ok && r.value.recipe.name === "Veggie Omelette" && r.value.servings === 1);
    assert.ok(r.ok && r.value.fridgeRecipeId === null);
  });

  it("carries fridgeRecipeId provenance when sent", () => {
    const r = parseFridgeExchangeInput({ localDate: "2026-07-30", recipe, fridgeRecipeId: "frg_1" });
    assert.ok(r.ok && r.value.fridgeRecipeId === "frg_1");
  });

  it("rejects invalid recipe or localDate", () => {
    assert.equal(parseFridgeExchangeInput({ localDate: "2026-07-30", recipe: { name: 1 } }).ok, false);
    assert.equal(parseFridgeExchangeInput({ localDate: "nope", recipe }).ok, false);
  });
});

// ── resolveGuard (Task E5) ──────────────────────────────────────────────────
import { resolveGuard } from "./plan-exchanges";

describe("resolveGuard", () => {
  const row = { ...base };                                                    // PENDING, v3, 2026-07-30
  const menu = { id: "m1", patientId: "p1", date: new Date(2026, 6, 30, 12) }; // July = month 6
  const ok = { row, activePlanVersion: 3, menu, patientId: "p1", alreadyDisplaced: false, menuEaten: false };

  it("passes the happy path", () => assert.equal(resolveGuard(ok), null));

  it("rejects non-PENDING row", () =>
    assert.match(resolveGuard({ ...ok, row: { ...row, status: "RESOLVED" as const } })!, /not pending/i));

  it("rejects stale planVersion", () =>
    assert.match(resolveGuard({ ...ok, activePlanVersion: 4 })!, /plan changed/i));

  it("rejects missing/foreign menu", () => {
    assert.match(resolveGuard({ ...ok, menu: null })!, /menu not found/i);
    assert.match(resolveGuard({ ...ok, menu: { ...menu, patientId: "px" } })!, /menu not found/i);
  });

  it("rejects a menu outside the exchange's localDate", () =>
    assert.match(resolveGuard({ ...ok, menu: { ...menu, date: new Date(2026, 6, 31, 12) } })!, /different day/i));

  it("rejects already-displaced and already-eaten menus", () => {
    assert.match(resolveGuard({ ...ok, alreadyDisplaced: true })!, /already exchanged/i);
    assert.match(resolveGuard({ ...ok, menuEaten: true })!, /already eaten/i);
  });
});

// ── wire contract (Task E6) ─────────────────────────────────────────────────
describe("wire contract", () => {
  it("spreading an undefined exchanges key leaves the default body unchanged", () => {
    const exchanges = undefined as { pending: unknown[] } | undefined;
    const body = {
      menus: [], mealPlanStartDate: null, loggedRecipeIds: [], mealRatings: {},
      dailyCalorieTarget: null, ...(exchanges ? { exchanges } : {}),
    };
    assert.deepEqual(Object.keys(body), ["menus", "mealPlanStartDate", "loggedRecipeIds", "mealRatings", "dailyCalorieTarget"]);
  });
});
