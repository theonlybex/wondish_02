import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugify,
  coercePrice,
  parseIngredients,
  checkDishPublishGate,
  isRestaurantStatus,
  isDishStatus,
  RESTAURANT_STATUSES,
  DISH_STATUSES,
} from "./admin-restaurants";

// ─── slugify — name → URL-safe slug ─────────────────────────────────────────

test("slugify: lowercases and hyphenates spaces", () => {
  assert.equal(slugify("Miracle Mile Kitchen"), "miracle-mile-kitchen");
});

test("slugify: strips punctuation/symbols", () => {
  assert.equal(slugify("Tony's Pizza & Grill!"), "tonys-pizza-grill");
});

test("slugify: collapses repeated separators, trims edge hyphens, strips diacritics", () => {
  assert.equal(slugify("  Café   ---  Deluxe  "), "cafe-deluxe");
});

test("slugify: handles empty/whitespace-only input", () => {
  assert.equal(slugify("   "), "");
});

// ─── coercePrice — string in, Decimal-ready string (or null) out ───────────

test("coercePrice: undefined/null pass through as null (no price)", () => {
  assert.deepEqual(coercePrice(undefined), { ok: true, value: null });
  assert.deepEqual(coercePrice(null), { ok: true, value: null });
});

test("coercePrice: empty string treated as no price", () => {
  assert.deepEqual(coercePrice(""), { ok: true, value: null });
  assert.deepEqual(coercePrice("   "), { ok: true, value: null });
});

test("coercePrice: valid decimal strings pass through trimmed", () => {
  assert.deepEqual(coercePrice("12"), { ok: true, value: "12" });
  assert.deepEqual(coercePrice("12.5"), { ok: true, value: "12.5" });
  assert.deepEqual(coercePrice(" 9.99 "), { ok: true, value: "9.99" });
  assert.deepEqual(coercePrice("0"), { ok: true, value: "0" });
});

test("coercePrice: rejects non-numeric garbage", () => {
  const res = coercePrice("abc");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 400);
});

test("coercePrice: rejects negative values", () => {
  const res = coercePrice("-5.00");
  assert.equal(res.ok, false);
});

test("coercePrice: rejects more than 2 decimal places", () => {
  const res = coercePrice("5.999");
  assert.equal(res.ok, false);
});

test("coercePrice: rejects non-string input types", () => {
  const res = coercePrice(9.99 as unknown);
  assert.equal(res.ok, false);
});

// ─── parseIngredients — shape validation + dedupe-by-name (replace-all) ────

test("parseIngredients: accepts a well-formed list", () => {
  const res = parseIngredients([
    { name: "Rice noodles", quantity: 200, unit: "g" },
    { name: "Peanuts" },
  ]);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.value, [
      { name: "Rice noodles", quantity: 200, unit: "g" },
      { name: "Peanuts", quantity: null, unit: null },
    ]);
  }
});

test("parseIngredients: rejects non-array input", () => {
  const res = parseIngredients({ name: "Peanuts" });
  assert.equal(res.ok, false);
});

test("parseIngredients: rejects items missing a non-empty name", () => {
  assert.equal(parseIngredients([{ quantity: 1 }]).ok, false);
  assert.equal(parseIngredients([{ name: "" }]).ok, false);
  assert.equal(parseIngredients([{ name: "   " }]).ok, false);
});

test("parseIngredients: rejects non-numeric quantity", () => {
  const res = parseIngredients([{ name: "Salt", quantity: "a lot" }]);
  assert.equal(res.ok, false);
});

test("parseIngredients: rejects negative quantity", () => {
  const res = parseIngredients([{ name: "Salt", quantity: -1 }]);
  assert.equal(res.ok, false);
});

test("parseIngredients: dedupes by name, last write wins (composite PK safety)", () => {
  const res = parseIngredients([
    { name: "Peanuts", quantity: 10, unit: "g" },
    { name: "Peanuts", quantity: 25, unit: "g" },
  ]);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.length, 1);
    assert.equal(res.value[0].quantity, 25);
  }
});

test("parseIngredients: trims ingredient names", () => {
  const res = parseIngredients([{ name: "  Basil  " }]);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value[0].name, "Basil");
});

test("parseIngredients: empty array is valid (explicit clear)", () => {
  const res = parseIngredients([]);
  assert.deepEqual(res, { ok: true, value: [] });
});

// ─── checkDishPublishGate — spec-mandated: no PUBLISHED with 0 ingredients ─

test("checkDishPublishGate: rejects PUBLISHED with zero ingredients", () => {
  const res = checkDishPublishGate("PUBLISHED", 0);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 400);
});

test("checkDishPublishGate: allows PUBLISHED with at least one ingredient", () => {
  const res = checkDishPublishGate("PUBLISHED", 1);
  assert.equal(res.ok, true);
});

test("checkDishPublishGate: DRAFT is never blocked, even with zero ingredients", () => {
  const res = checkDishPublishGate("DRAFT", 0);
  assert.equal(res.ok, true);
});

// ─── status enum validation ─────────────────────────────────────────────────

test("isRestaurantStatus: accepts exactly the three known values", () => {
  for (const s of RESTAURANT_STATUSES) assert.equal(isRestaurantStatus(s), true);
  assert.equal(isRestaurantStatus("PUBLISHED"), true);
  assert.equal(isRestaurantStatus("published"), false);
  assert.equal(isRestaurantStatus("DELETED"), false);
  assert.equal(isRestaurantStatus(undefined), false);
  assert.equal(isRestaurantStatus(123), false);
});

test("isDishStatus: accepts exactly DRAFT/PUBLISHED", () => {
  for (const s of DISH_STATUSES) assert.equal(isDishStatus(s), true);
  assert.equal(isDishStatus("ARCHIVED"), false);
  assert.equal(isDishStatus(null), false);
});
