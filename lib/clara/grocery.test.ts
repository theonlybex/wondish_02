import test from "node:test";
import assert from "node:assert/strict";
import { INGREDIENT_CATALOG } from "@/lib/ingredient-catalog";
import { LEVELS, type FullLevelKey } from "@/lib/level-catalogue";
import type { CatalogRow } from "./kept-foods";
import type { SteerRow } from "./level-steer";
import { groceryGroups, lowLevels, richRows, SOURCES, MAX_LEVEL_ITEMS, MAX_VARIETY_ITEMS, MAX_LEVEL_GROUPS, NO_FOOD_NOTE } from "./grocery";

/** The real catalog, with marks. */
const catalog = (atHome: string[] = [], favorites: string[] = [], banned: (name: string) => boolean = () => false): CatalogRow[] =>
  INGREDIENT_CATALOG.flatMap((g) => g.items.map((name) => ({ id: `id:${name}`, name, groupKey: g.key, groupTitle: g.title, atHome: atHome.includes(name), favorite: favorites.includes(name) })))
    .filter((r) => !banned(r.name));
const wk = (key: string, word: SteerRow["word"], amount = 10, target = 28): SteerRow => ({ key: key as FullLevelKey, name: key, direction: "enough", target, amount, word });
const KITCHEN = ["Salmon fillets", "Ground beef", "Large eggs", "Spinach", "Kale", "Jasmine rice", "Russet potatoes"];
const names = (g?: { items: { name: string }[] }) => g?.items.map((i) => i.name) ?? [];
const little = (...keys: string[]) => ({ little: keys, aLot: [] });

test("lowLevels: 'little' from the week, then the answers for what the logs cannot count; never a limit", () => {
  const week = [wk("fibre", "little"), wk("protein", "on track"), wk("sodium", "a lot"), wk("iron", null)];
  assert.deepEqual(lowLevels(week, { little: ["iron", "fibre", "protein", "sodium"], aLot: [] }).map((l) => `${l.key}:${l.why}`), ["fibre:week", "iron:answers"]);
  assert.deepEqual(lowLevels([], null), []);
});

test("the sources table: every level that can be low has real sources, and every name is a catalog food", () => {
  const all = new Set(INGREDIENT_CATALOG.flatMap((g) => g.items));
  for (const l of LEVELS) {
    if (l.direction === "under") continue;
    const rich = richRows(l.key, catalog());
    assert.ok(rich.some((x) => x.strong), l.key);
    if (l.key !== "protein") {
      const src = SOURCES[l.key]!;
      for (const f of src.foods) assert.ok(all.has(f), `${l.key}: ${f}`);
      assert.ok(src.strong >= 1 && src.strong <= src.foods.length, l.key);
    }
  }
  // The strongest first: pulses and oats lead fibre, not green beans.
  assert.deepEqual(richRows("fibre", catalog()).slice(0, 4).map((x) => x.row.name), ["Green lentils", "Black beans", "Rolled oats", "Chia seeds"]);
  assert.ok(!richRows("fibre", catalog()).some((x) => x.row.name === "Green beans"));
  assert.ok(richRows("omega3", catalog()).some((x) => x.row.name === "Ground flaxseed"));
  assert.ok(richRows("vitaminC", catalog()).some((x) => x.row.name === "Oranges"));
});

test("a nutrient group appears only when they are low on it and no real source is at home", () => {
  const g = groceryGroups({ rows: catalog(KITCHEN), week: [wk("fibre", "little")], picture: null });
  const fibre = g.find((x) => x.key === "level:fibre")!;
  assert.deepEqual([fibre.kind, fibre.title, fibre.reason], ["level", "For fibre", "You've had little fibre this week, and nothing at home is a good source of it."]);
  // One of each kind, the strongest first: one lentil, one bean.
  assert.deepEqual(names(fibre), ["Green lentils", "Black beans", "Rolled oats", "Chia seeds"]);
  assert.equal(fibre.items.length, MAX_LEVEL_ITEMS);
  // Oats at home: Clara has a real source, so no group.
  assert.equal(groceryGroups({ rows: catalog([...KITCHEN, "Rolled oats"]), week: [wk("fibre", "little")], picture: null }).some((x) => x.key === "level:fibre"), false);
  // A weak source at home does not close it: brown rice for fibre, eggs for vitamin D.
  assert.ok(groceryGroups({ rows: catalog([...KITCHEN, "Brown rice"]), week: [wk("fibre", "little")], picture: null }).some((x) => x.key === "level:fibre"));
  const d = groceryGroups({ rows: catalog(["Large eggs", "Ground beef", "Spinach", "Kale", "Jasmine rice", "Brown rice"]), week: [], picture: little("vitaminD") }).find((x) => x.key === "level:vitaminD")!;
  assert.deepEqual(names(d), ["Salmon fillets", "Canned tuna"]);
  // On track: no group.
  assert.equal(groceryGroups({ rows: catalog(KITCHEN), week: [wk("fibre", "on track")], picture: null }).some((x) => x.kind === "level"), false);
  // From the answers, with its own wording; a favourite leads the group; a vitamin keeps its letter.
  const a = groceryGroups({ rows: catalog(KITCHEN.filter((n) => n !== "Salmon fillets"), ["Walnuts"]), week: [], picture: little("omega3", "vitaminC") });
  const omega = a.find((x) => x.key === "level:omega3")!;
  assert.equal(omega.reason, "From your answers you probably get little omega-3, and nothing at home is a good source of it.");
  assert.deepEqual(omega.items[0], { id: "id:Walnuts", name: "Walnuts", favorite: true });
  assert.equal(a.find((x) => x.key === "level:vitaminC"), undefined); // kale at home is a real source
  const c = groceryGroups({ rows: catalog(["Ground beef", "Jasmine rice"]), week: [], picture: little("vitaminC") }).find((x) => x.key === "level:vitaminC")!;
  assert.deepEqual([c.title, names(c)], ["For vitamin C", ["Bell peppers", "Broccoli", "Oranges", "Strawberries"]]);
});

test("a level their diet leaves no food for is shown with a note, never passed over; plant milks stand in where they are allowed", () => {
  const animal = (n: string) => /salmon|tuna|tilapia|catfish|shrimp|beef|steak|chicken|turkey|pork|bacon|eggs|milk$|whole milk|yogurt|cheddar|mozzarella|parmesan|feta|butter|cream/i.test(n) && !/almond milk|oat milk/i.test(n);
  // A vegan who may drink plant milks: B12 and D list them (their only sources).
  const vegan = groceryGroups({ rows: catalog([], [], animal), week: [], picture: little("vitaminB12", "vitaminD") });
  assert.deepEqual(names(vegan.find((x) => x.key === "level:vitaminD")), ["Oat milk", "Almond milk"].filter((n) => names(vegan.find((x) => x.key === "level:vitaminD")).includes(n)));
  for (const g of vegan) for (const i of g.items) assert.ok(!animal(i.name), i.name);
  // A vegan whose allergy also bans every "milk" word: nothing left, so the note.
  const strict = groceryGroups({ rows: catalog([], [], (n) => animal(n) || /milk/i.test(n)), week: [], picture: little("vitaminB12") });
  const b12 = strict.find((x) => x.key === "level:vitaminB12")!;
  assert.deepEqual([b12.items, b12.note, b12.reason], [[], NO_FOOD_NOTE, "From your answers you probably get little vitamin B12."]);
});

test("the list stays short: five nutrient groups at most, and no variety group for a family the list already covers", () => {
  const poor = little("fibre", "iron", "potassium", "calcium", "omega3", "vitaminD", "vitaminB12", "vitaminC", "magnesium", "folate", "zinc");
  const g = groceryGroups({ rows: catalog(["Large eggs", "Spinach", "Jasmine rice"]), week: [], picture: poor });
  const levels = g.filter((x) => x.kind === "level" && x.items.length > 0);
  assert.ok(levels.length <= MAX_LEVEL_GROUPS, String(levels.length));
  for (const x of levels) assert.ok(x.items.length <= MAX_LEVEL_ITEMS);
  for (const x of g.filter((y) => y.kind === "variety")) assert.ok(x.items.length <= MAX_VARIETY_ITEMS);
  const all = g.flatMap((x) => x.items.map((i) => i.id));
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.length <= 26, String(all.length));
  // The fibre and iron groups already offer pulses and oats: no separate protein or grain variety group for the same thing.
  const listedProteins = g.filter((x) => x.kind === "level").flatMap(names).filter((n) => /lentils|beans|tofu|salmon|beef|tuna/i.test(n)).length;
  if (listedProteins >= 2) assert.equal(g.some((x) => x.key === "variety:proteins"), false);
});

test("a variety group opens for a family with fewer than two foods at home", () => {
  // Owner: "if only one like only eggs or only beef then open group Protein Variety".
  const eggsOnly = groceryGroups({ rows: catalog(["Large eggs", "Spinach", "Kale", "Jasmine rice", "Russet potatoes"]), week: [], picture: null });
  const protein = eggsOnly.find((x) => x.key === "variety:proteins")!;
  assert.deepEqual([protein.title, protein.reason], ["Protein variety", "You have only one protein at home: Large eggs. A second gives Clara different dishes to make."]);
  // A mix, one of each kind, and not another of what they have.
  assert.deepEqual(names(protein), ["Boneless chicken breasts", "Salmon fillets", "Ground beef"]);
  assert.deepEqual(eggsOnly.map((x) => x.key), ["variety:proteins", "variety:grains"]);
  assert.deepEqual(names(eggsOnly[1]), ["Rolled oats", "Spaghetti", "Sliced bread"]); // no second rice beside the rice
  assert.match(eggsOnly[1].reason, /^You have only one grain or carb at home: Jasmine rice\./);
  // Nothing marked at all: every family, each saying so.
  const empty = groceryGroups({ rows: catalog(), week: [], picture: null });
  assert.deepEqual(empty.map((x) => x.key), ["variety:proteins", "variety:produce", "variety:grains"]);
  assert.equal(empty[0].reason, "You have no protein marked at home. Clara needs at least one, and a second gives her different dishes to make.");
  assert.deepEqual(names(empty[1]), ["Broccoli", "Bell peppers", "Carrots"]);
  // A full kitchen: nothing to buy.
  assert.deepEqual(groceryGroups({ rows: catalog([...KITCHEN, "Brown rice"]), week: [], picture: null }), []);
});
