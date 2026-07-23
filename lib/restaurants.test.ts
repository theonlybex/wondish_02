import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeListCursor,
  decodeListCursor,
  parseListQuery,
  paginateListRows,
  buildCuisineFacet,
  formatPrice,
  sortIngredientNames,
  computeVerdict,
  computeMatchSummary,
  serializeRestaurantListItem,
  serializeDish,
  serializeRestaurantDetail,
  buildRestaurantListWhere,
  RESTAURANT_LIST_ORDER_BY,
} from "./restaurants";
import { buildDietMatchers, derivePatientBans, type PatientDietGraph } from "./diet-match";

// ─── fixtures ───────────────────────────────────────────────────────────────

function emptyPatient(): PatientDietGraph {
  return {
    foodAllergies: [],
    foodToAvoid: [],
    healthConditions: [],
    foodPreferences: [],
    motivations: [],
  };
}

function peanutAllergyPatient(): PatientDietGraph {
  return {
    ...emptyPatient(),
    foodAllergies: [{ food: { name: "Peanut", bannedIngredients: [] } }],
  };
}

// ─── encodeListCursor / decodeListCursor — round-trip + malformed ──────────

test("encodeListCursor/decodeListCursor: round-trips name+id", () => {
  const encoded = encodeListCursor("Olive & Vine", "cid123");
  const decoded = decodeListCursor(encoded);
  assert.deepEqual(decoded, { name: "Olive & Vine", id: "cid123" });
});

test("decodeListCursor: rejects malformed base64/JSON", () => {
  assert.equal(decodeListCursor("not-valid-base64url-json!!!"), null);
  assert.equal(decodeListCursor(""), null);
});

test("decodeListCursor: rejects well-formed base64 JSON missing required fields", () => {
  const bogus = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64url");
  assert.equal(decodeListCursor(bogus), null);
});

// ─── parseListQuery — filters passthrough, limit clamping, cursor errors ───

test("parseListQuery: defaults limit to 25 when absent", () => {
  const r = parseListQuery({ cuisine: null, neighborhood: null, cursor: null, limit: null });
  assert.ok(r.ok);
  assert.equal(r.value.limit, 25);
  assert.equal(r.value.cuisine, null);
  assert.equal(r.value.neighborhood, null);
  assert.equal(r.value.cursor, null);
});

test("parseListQuery: clamps limit above 50 down to 50", () => {
  const r = parseListQuery({ cuisine: null, neighborhood: null, cursor: null, limit: "500" });
  assert.ok(r.ok);
  assert.equal(r.value.limit, 50);
});

test("parseListQuery: clamps limit below 1 up to 1", () => {
  const r = parseListQuery({ cuisine: null, neighborhood: null, cursor: null, limit: "0" });
  assert.ok(r.ok);
  assert.equal(r.value.limit, 1);
});

test("parseListQuery: non-numeric limit falls back to default 25", () => {
  const r = parseListQuery({ cuisine: null, neighborhood: null, cursor: null, limit: "abc" });
  assert.ok(r.ok);
  assert.equal(r.value.limit, 25);
});

test("parseListQuery: passes cuisine and neighborhood through literally", () => {
  const r = parseListQuery({ cuisine: "eth_123", neighborhood: "Miracle Mile", cursor: null, limit: null });
  assert.ok(r.ok);
  assert.equal(r.value.cuisine, "eth_123");
  assert.equal(r.value.neighborhood, "Miracle Mile");
});

test("parseListQuery: decodes a valid cursor", () => {
  const cursor = encodeListCursor("Olive & Vine", "cid123");
  const r = parseListQuery({ cuisine: null, neighborhood: null, cursor, limit: null });
  assert.ok(r.ok);
  assert.deepEqual(r.value.cursor, { name: "Olive & Vine", id: "cid123" });
});

test("parseListQuery: malformed cursor is rejected with 400", () => {
  const r = parseListQuery({ cuisine: null, neighborhood: null, cursor: "garbage!!", limit: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

// ─── paginateListRows — deterministic page slicing + nextCursor ───────────

test("paginateListRows: short page (fewer rows than limit) yields nextCursor null", () => {
  const rows = [{ name: "A", id: "1" }, { name: "B", id: "2" }];
  const { pageRows, nextCursor } = paginateListRows(rows, 25);
  assert.deepEqual(pageRows, rows);
  assert.equal(nextCursor, null);
});

test("paginateListRows: exact-limit-plus-one rows yields a cursor and trims the extra row", () => {
  const rows = [{ name: "A", id: "1" }, { name: "B", id: "2" }, { name: "C", id: "3" }];
  const { pageRows, nextCursor } = paginateListRows(rows, 2);
  assert.deepEqual(pageRows, rows.slice(0, 2));
  assert.equal(nextCursor, encodeListCursor("B", "2"));
});

// ─── buildRestaurantListWhere / RESTAURANT_LIST_ORDER_BY — filter+cursor shape ─

test("buildRestaurantListWhere: always scopes to PUBLISHED, no filters/cursor by default", () => {
  const where = buildRestaurantListWhere({ cuisine: null, neighborhood: null }, null);
  assert.deepEqual(where, { status: "PUBLISHED" });
});

test("buildRestaurantListWhere: cuisine filters by ethnicId literally", () => {
  const where = buildRestaurantListWhere({ cuisine: "eth_123", neighborhood: null }, null);
  assert.deepEqual(where, { status: "PUBLISHED", ethnicId: "eth_123" });
});

test("buildRestaurantListWhere: neighborhood is an exact string match", () => {
  const where = buildRestaurantListWhere({ cuisine: null, neighborhood: "Miracle Mile" }, null);
  assert.deepEqual(where, { status: "PUBLISHED", neighborhood: "Miracle Mile" });
});

test("buildRestaurantListWhere: cursor adds a compound (name, id) tie-break OR clause", () => {
  const where = buildRestaurantListWhere({ cuisine: null, neighborhood: null }, { name: "Olive & Vine", id: "cid1" });
  assert.deepEqual(where, {
    status: "PUBLISHED",
    OR: [{ name: { gt: "Olive & Vine" } }, { name: "Olive & Vine", id: { gt: "cid1" } }],
  });
});

test("RESTAURANT_LIST_ORDER_BY: orders by name asc, id asc", () => {
  assert.deepEqual(RESTAURANT_LIST_ORDER_BY, [{ name: "asc" }, { id: "asc" }]);
});

// ─── buildCuisineFacet — dedup + sort, nulls dropped ───────────────────────

test("buildCuisineFacet: dedups and sorts, dropping nulls", () => {
  const facet = buildCuisineFacet(["Italian", null, "Mediterranean", "Italian", "American"]);
  assert.deepEqual(facet, ["American", "Italian", "Mediterranean"]);
});

test("buildCuisineFacet: empty input yields empty array", () => {
  assert.deepEqual(buildCuisineFacet([]), []);
});

// ─── formatPrice — Decimal-shaped/number/string → "9.00" | null ───────────

test("formatPrice: null stays null", () => {
  assert.equal(formatPrice(null), null);
});

test("formatPrice: number formats to 2 decimals", () => {
  assert.equal(formatPrice(9), "9.00");
  assert.equal(formatPrice(9.5), "9.50");
});

test("formatPrice: Decimal-shaped object (toFixed) formats to 2 decimals", () => {
  const decimalLike = { toFixed: (dp: number) => (9).toFixed(dp) };
  assert.equal(formatPrice(decimalLike), "9.00");
});

test("formatPrice: string input formats to 2 decimals", () => {
  assert.equal(formatPrice("9"), "9.00");
});

// ─── sortIngredientNames — deterministic name asc ─────────────────────────

test("sortIngredientNames: sorts alphabetically without mutating input", () => {
  const input = ["Tahini", "Chickpeas", "Lemon"];
  const sorted = sortIngredientNames(input);
  assert.deepEqual(sorted, ["Chickpeas", "Lemon", "Tahini"]);
  assert.deepEqual(input, ["Tahini", "Chickpeas", "Lemon"]); // unmutated
});

// ─── computeVerdict — null vs computed, caution:false literal ─────────────

test("computeVerdict: matchers null (no profile) yields verdict null", () => {
  assert.equal(computeVerdict(["Peanuts"], null), null);
});

test("computeVerdict: passing dish with a real (zero-ban) profile computes passed:true, caution:false", () => {
  const matchers = buildDietMatchers(derivePatientBans(emptyPatient()));
  const verdict = computeVerdict(["Rice", "Beans"], matchers);
  assert.deepEqual(verdict, { passed: true, caution: false, violations: [] });
});

test("computeVerdict: caution is always literally false even on a failing dish", () => {
  const matchers = buildDietMatchers(derivePatientBans(peanutAllergyPatient()));
  const verdict = computeVerdict(["Peanuts"], matchers);
  assert.ok(verdict);
  assert.equal(verdict!.caution, false);
  assert.equal(verdict!.passed, false);
});

// ─── computeMatchSummary — mixed pass/fail, no-profile null, zero-dish ────

test("computeMatchSummary: matchers null (no profile) yields null", () => {
  assert.equal(computeMatchSummary([["Peanuts"], ["Rice"]], null), null);
});

test("computeMatchSummary: zero-dish restaurant yields {passed:0, total:0}", () => {
  const matchers = buildDietMatchers(derivePatientBans(emptyPatient()));
  assert.deepEqual(computeMatchSummary([], matchers), { passed: 0, total: 0 });
});

test("computeMatchSummary: counts mixed pass/fail dishes correctly", () => {
  const matchers = buildDietMatchers(derivePatientBans(peanutAllergyPatient()));
  const result = computeMatchSummary(
    [["Peanuts", "Oil"], ["Rice", "Beans"], ["Roasted Peanuts"]],
    matchers
  );
  assert.deepEqual(result, { passed: 1, total: 3 });
});

// ─── serializeRestaurantListItem — wire shape, cuisine null ───────────────

test("serializeRestaurantListItem: emits exact wire fields, cuisine null when no ethnic", () => {
  const row = { id: "r1", slug: "olive-and-vine", name: "Olive & Vine", neighborhood: "Miracle Mile", cuisineName: null };
  const item = serializeRestaurantListItem(row, null);
  assert.deepEqual(item, {
    id: "r1",
    slug: "olive-and-vine",
    name: "Olive & Vine",
    neighborhood: "Miracle Mile",
    cuisine: null,
    matchSummary: null,
  });
});

test("serializeRestaurantListItem: carries a computed matchSummary and cuisine name", () => {
  const row = { id: "r1", slug: "olive-and-vine", name: "Olive & Vine", neighborhood: "Miracle Mile", cuisineName: "Mediterranean" };
  const item = serializeRestaurantListItem(row, { passed: 7, total: 9 });
  assert.equal(item.cuisine, "Mediterranean");
  assert.deepEqual(item.matchSummary, { passed: 7, total: 9 });
});

// ─── serializeRestaurantDetail — wire shape, description/cuisine null ─────

test("serializeRestaurantDetail: emits exact wire fields", () => {
  const row = { id: "r1", slug: "olive-and-vine", name: "Olive & Vine", description: null, neighborhood: "Miracle Mile", cuisineName: null };
  assert.deepEqual(serializeRestaurantDetail(row), {
    id: "r1",
    slug: "olive-and-vine",
    name: "Olive & Vine",
    description: null,
    neighborhood: "Miracle Mile",
    cuisine: null,
  });
});

// ─── serializeDish — price "9.00"/null, verdict null vs computed ──────────

test("serializeDish: no profile → verdict null, price formatted, ingredients sorted", () => {
  const row = {
    id: "d1",
    name: "Hummus",
    description: null,
    price: 9,
    currency: "USD",
    section: "Starters",
    sortOrder: 0,
    isRecommended: false,
  };
  const dish = serializeDish(row, ["Tahini", "Chickpeas"], null);
  assert.deepEqual(dish, {
    id: "d1",
    name: "Hummus",
    description: null,
    ingredients: ["Chickpeas", "Tahini"],
    price: "9.00",
    currency: "USD",
    section: "Starters",
    sortOrder: 0,
    isRecommended: false,
    verdict: null,
  });
});

test("serializeDish: null price stays null", () => {
  const row = {
    id: "d1",
    name: "Mystery Special",
    description: null,
    price: null,
    currency: "USD",
    section: "Mains",
    sortOrder: 1,
    isRecommended: false,
  };
  const dish = serializeDish(row, [], null);
  assert.equal(dish.price, null);
});

test("serializeDish: with a real profile computes verdict (caution:false literal)", () => {
  const matchers = buildDietMatchers(derivePatientBans(emptyPatient()));
  const row = {
    id: "d1",
    name: "Hummus",
    description: null,
    price: 9,
    currency: "USD",
    section: "Starters",
    sortOrder: 0,
    isRecommended: false,
  };
  const dish = serializeDish(row, ["Chickpeas", "Tahini"], matchers);
  assert.deepEqual(dish.verdict, { passed: true, caution: false, violations: [] });
});

// ─── Hand-checked fixture: peanut-allergic profile / pad-thai-like dish ────
// Mirrors phase-1.md's "done" check: assert the EXACT wire shape for a
// failing verdict, field-by-field, per the pinned contract.

test("phase-1 'done' fixture: peanut allergy fails a pad-thai-like dish with exact wire violations", () => {
  const patient = peanutAllergyPatient();
  const matchers = buildDietMatchers(derivePatientBans(patient));

  const padThaiRow = {
    id: "dish_padthai",
    name: "Pad Thai",
    description: "Rice noodles, tofu, bean sprouts, crushed peanuts",
    price: 14,
    currency: "USD",
    section: "Mains",
    sortOrder: 2,
    isRecommended: false,
  };
  const ingredientNames = ["Rice Noodles", "Tofu", "Bean Sprouts", "Peanuts"];

  const dish = serializeDish(padThaiRow, ingredientNames, matchers);

  assert.equal(dish.verdict !== null, true);
  assert.deepEqual(dish.verdict, {
    passed: false,
    caution: false,
    violations: [{ ingredient: "Peanuts", term: "peanut", source: "allergy" }],
  });
});
