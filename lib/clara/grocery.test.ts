import test from "node:test";
import assert from "node:assert/strict";
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import type { CatalogRow } from "./kept-foods";
import type { SteerRow } from "./level-steer";
import { groceryGroups, lowLevels, richRows, MAX_GROCERY_ITEMS } from "./grocery";

/** The real catalog, with marks. */
const catalog = (atHome: string[] = [], favorites: string[] = [], banned: string[] = []): CatalogRow[] =>
  INGREDIENT_CATALOG.flatMap((g) => g.items.map((name) => ({ id: `id:${name}`, name, groupKey: g.key, groupTitle: g.title, atHome: atHome.includes(name), favorite: favorites.includes(name) })))
    .filter((r) => !banned.includes(r.name));
const wk = (key: string, word: SteerRow["word"], amount = 10, target = 28): SteerRow => ({ key: key as FullLevelKey, name: key, direction: "enough", target, amount, word });
const KITCHEN = ["Salmon fillets", "Ground beef", "Large eggs", "Spinach", "Kale", "Jasmine rice", "Russet potatoes"];
const names = (g?: { items: { name: string }[] }) => g?.items.map((i) => i.name) ?? [];

test("lowLevels: 'little' from the week, then the answers for what the logs cannot count; never a limit", () => {
  const week = [wk("fibre", "little"), wk("protein", "on track"), wk("sodium", "a lot"), wk("iron", null)];
  assert.deepEqual(lowLevels(week, { little: ["iron", "fibre", "protein", "sodium"], aLot: [] }).map((l) => `${l.key}:${l.why}`), ["fibre:week", "iron:answers"]);
  assert.deepEqual(lowLevels([], null), []);
});

test("richRows: every level that can be low names at least one catalog food", () => {
  for (const l of LEVELS) {
    if (l.direction === "under") continue;
    assert.ok(richRows(l.key, catalog()).length > 0, l.key);
  }
  assert.ok(richRows("fibre", catalog()).some((r) => r.name === "Rolled oats"));
  assert.ok(richRows("fibre", catalog()).some((r) => r.name === "Green lentils"));
  assert.ok(richRows("protein", catalog()).some((r) => r.name === "Salmon fillets"));
  assert.ok(!richRows("protein", catalog()).some((r) => r.name === "Whole milk"));
});

test("a nutrient group appears only when they are low on it and nothing at home helps", () => {
  // Low on fibre, nothing fibre-rich at home: a group, grouped by the nutrient.
  const g = groceryGroups({ rows: catalog(KITCHEN), week: [wk("fibre", "little")], picture: null });
  const fibre = g.find((x) => x.key === "level:fibre")!;
  assert.deepEqual([fibre.kind, fibre.title, fibre.reason], ["level", "For fibre", "You've had little fibre this week, and nothing at home is rich in it."]);
  assert.ok(fibre.items.length > 0 && fibre.items.length <= MAX_GROCERY_ITEMS);
  for (const i of fibre.items) assert.ok(!KITCHEN.includes(i.name), i.name);
  // Oats at home: Clara has something to cook with, so no group.
  assert.equal(groceryGroups({ rows: catalog([...KITCHEN, "Rolled oats"]), week: [wk("fibre", "little")], picture: null }).some((x) => x.key === "level:fibre"), false);
  // On track: no group.
  assert.equal(groceryGroups({ rows: catalog(KITCHEN), week: [wk("fibre", "on track")], picture: null }).some((x) => x.kind === "level"), false);
  // From the answers, with its own wording; a favourite leads the group.
  const a = groceryGroups({ rows: catalog(KITCHEN.filter((n) => n !== "Salmon fillets"), ["Walnuts"]), week: [], picture: { little: ["omega3"], aLot: [] } });
  const omega = a.find((x) => x.key === "level:omega3")!;
  assert.equal(omega.reason, "From your answers you probably get little omega-3, and nothing at home is rich in it.");
  // A vitamin keeps its letter, and a paste is not the food.
  const c = groceryGroups({ rows: catalog(["Ground beef", "Jasmine rice"]), week: [], picture: { little: ["vitaminC"], aLot: [] } }).find((x) => x.key === "level:vitaminC")!;
  assert.deepEqual([c.title, c.reason], ["For vitamin C", "From your answers you probably get little vitamin C, and nothing at home is rich in it."]);
  assert.ok(!names(c).includes("Tomato paste") && names(c).includes("Bell peppers"), names(c).join(", "));
  assert.deepEqual(omega.items[0], { id: "id:Walnuts", name: "Walnuts", favorite: true });
  // The diet takes its share: banned foods never reach the list.
  const noFish = groceryGroups({ rows: catalog(["Ground beef", "Spinach"], [], ["Salmon fillets", "Tilapia fillets", "Catfish fillets", "Canned tuna", "Shrimp", "Walnuts"]), week: [], picture: { little: ["omega3"], aLot: [] } });
  for (const x of noFish) for (const i of x.items) assert.doesNotMatch(i.name, /salmon|tilapia|catfish|tuna|shrimp|walnut/i);
});

test("a variety group opens for a family with fewer than two foods at home", () => {
  // Owner: "if only one like only eggs or only beef then open group Protein Variety".
  const eggsOnly = groceryGroups({ rows: catalog(["Large eggs", "Spinach", "Kale", "Jasmine rice", "Russet potatoes"]), week: [], picture: null });
  const protein = eggsOnly.find((x) => x.key === "variety:proteins")!;
  assert.deepEqual([protein.title, protein.reason], ["Protein variety", "You have only one protein at home: Large eggs. A second gives Clara different dishes to make."]);
  assert.ok(protein.items.length > 0 && !names(protein).includes("Large eggs"));
  // One of each kind: not five cuts of chicken, and not another rice beside the rice they have.
  assert.deepEqual(names(protein), ["Boneless chicken breasts", "Salmon fillets", "Ground beef", "Extra-firm tofu", "Black beans"]);
  assert.deepEqual(names(eggsOnly.find((x) => x.key === "variety:grains")), ["Spaghetti", "Penne", "Quinoa", "Couscous", "Barley"]);
  // Rice is the only grain: a grain group; vegetables are three, so none.
  assert.deepEqual(eggsOnly.map((x) => x.key), ["variety:proteins", "variety:grains"]);
  assert.match(eggsOnly[1].reason, /^You have only one grain or carb at home: Jasmine rice\./);
  // Nothing marked at all: every family, each saying so.
  const empty = groceryGroups({ rows: catalog(), week: [], picture: null });
  assert.deepEqual(empty.map((x) => x.key), ["variety:proteins", "variety:produce", "variety:grains"]);
  assert.equal(empty[0].reason, "You have no protein marked at home. Two or more give Clara different dishes to make.");
  // A full kitchen: nothing to buy.
  assert.deepEqual(groceryGroups({ rows: catalog([...KITCHEN, "Brown rice"]), week: [], picture: null }), []);
});

test("a food is listed once, in the first group that names it", () => {
  const g = groceryGroups({ rows: catalog(["Spinach", "Kale", "Jasmine rice", "Brown rice"]), week: [wk("protein", "little", 20, 100)], picture: null });
  assert.deepEqual(g.map((x) => x.key), ["level:protein", "variety:proteins"]);
  const all = g.flatMap((x) => x.items.map((i) => i.id));
  assert.equal(new Set(all).size, all.length);
});
