import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankLibrary, type LibraryAsk, type LibraryRecipe } from "./dish-library";
import { NO_KEPT_FOODS, splitKeptFoods, type KeptFoods } from "./kept-foods";
import type { DietMatchers } from "../diet-match";

const noBans: DietMatchers = { allergyMatchers: [], exactBanned: [], bannedGroups: new Set() };
const patient = { dishPreferences: [], journalEntries: [] };
const recent = { recipeIds: new Set<string>(), names: new Set<string>() };
const never = () => false;

function recipe(id: string, name: string, ingredientNames: string[]): LibraryRecipe {
  return {
    id, name, steps: ["Cook it."], calories: 400, protein: 20, carbs: 40, fat: 10, fiber: 5, sodium: 300,
    prepTime: 10, cookTime: 10, servings: 1,
    ingredients: ingredientNames.map((n) => ({ quantity: 1, unit: "cup", ingredient: { name: n } })),
  };
}

const ask: LibraryAsk = { mealType: "dinner", little: [], aLot: [] };
const person = (extra: { kept?: KeptFoods; proteinRule?: boolean } = {}) => ({ patient, matchers: noBans, seed: "s", ...extra });
const rank = (pool: LibraryRecipe[], a: LibraryAsk = ask, extra: { kept?: KeptFoods; proteinRule?: boolean } = {}) =>
  rankLibrary(pool, a, person(extra), recent, never).map((r) => r.name);

const pool = [
  recipe("1", "Lentil Soup", ["Lentils", "Carrot"]),
  recipe("2", "Baked Salmon", ["Salmon", "Lemon"]),
  recipe("3", "Ground Chicken Lettuce Wraps", ["Ground Chicken", "Lettuce"]),
  recipe("4", "Beef Chili", ["Ground Beef", "Beans"]),
];
const kept = splitKeptFoods([
  { name: "Salmon", groupKey: "proteins", atHome: true, favorite: false },
  { name: "Ground Beef", groupKey: "proteins", atHome: true, favorite: false },
]);

describe("rankLibrary with kept foods", () => {
  it("order is unchanged without kept", () => {
    assert.deepEqual(rank(pool), rank(pool, ask, { kept: NO_KEPT_FOODS }));
  });
  it("drops a recipe whose meat is not at home", () => {
    const names = rank(pool, ask, { kept });
    assert.ok(!names.includes("Ground Chicken Lettuce Wraps"));
    assert.ok(names.includes("Lentil Soup"));
    assert.ok(names.includes("Baked Salmon"));
  });
  it("keeps it when the request names a protein", () => {
    assert.ok(rank(pool, { ...ask, wants: "chicken" }, { kept }).includes("Ground Chicken Lettuce Wraps"));
  });
  it("keeps it with proteinRule: false", () => {
    assert.ok(rank(pool, ask, { kept, proteinRule: false }).includes("Ground Chicken Lettuce Wraps"));
  });
  it("a favourite comes first among equals", () => {
    const two = [recipe("a", "Apple Bowl", ["Apple", "Oats"]), recipe("b", "Berry Bowl", ["Blueberry", "Yogurt"])];
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const fav = { ...NO_KEPT_FOODS, favorites: ["Blueberry"] };
      const out = rankLibrary(two, ask, { patient, matchers: noBans, seed, kept: fav }, recent, never).map((r) => r.name);
      assert.equal(out[0], "Berry Bowl");
    }
  });
  it("at-home foods add at most 2", () => {
    const two = [recipe("a", "Plain Bowl", ["Apple", "Oats"]), recipe("b", "Home Bowl", ["Blueberry", "Yogurt", "Honey", "Rice"])];
    const home = { ...NO_KEPT_FOODS, atHome: ["Blueberry", "Yogurt", "Honey"], favorites: ["Rice"] };
    for (const seed of ["s1", "s2", "s3"]) {
      const out = rankLibrary(two, ask, { patient, matchers: noBans, seed, kept: home }, recent, never).map((r) => r.name);
      assert.equal(out[0], "Home Bowl");
    }
  });
  it("a recipe named for the request outranks a favourite", () => {
    const two = [recipe("a", "Mushroom Omelette", ["Egg", "Mushroom"]), recipe("b", "Spinach Muffin", ["Egg", "Spinach"])];
    const fav = { ...NO_KEPT_FOODS, favorites: ["Spinach"] };
    for (const seed of ["s1", "s2", "s3"]) {
      const out = rankLibrary(two, { ...ask, wants: "omelette" }, { patient, matchers: noBans, seed, kept: fav }, recent, never);
      assert.equal(out.length, 1);
    }
    const two2 = [recipe("a", "Egg Omelette", ["Egg", "Mushroom"]), recipe("b", "Egg Spinach Bake", ["Egg", "Omelette Mix"])];
    const out = rankLibrary(two2, { ...ask, wants: "omelette" }, { patient, matchers: noBans, seed: "x", kept: { ...NO_KEPT_FOODS, favorites: ["Omelette Mix"] } }, recent, never).map((r) => r.name);
    assert.equal(out[0], "Egg Omelette");
  });
});
