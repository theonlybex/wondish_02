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
