import test from "node:test";
import assert from "node:assert/strict";
import { splitKeptFoods } from "./kept-foods";
import { homeProteins } from "./dish-protein";
import { FAMILIES, familyOf, swapOptions, plainSwap, swapInRecipe, MAX_SWAP_OPTIONS } from "./exchange";
import { parseSwapBody } from "./swap-body";
import type { ClaraRecipe } from "./parts";

const row = (name: string, groupKey = "produce") => ({ name, groupKey, atHome: true, favorite: false });
const KEPT = splitKeptFoods([row("Salmon fillets", "proteins"), row("Ground beef", "proteins"), row("Large eggs", "dairy"), row("Kale"), row("Russet potatoes"), row("Jasmine rice", "grains"), row("Cremini mushrooms")]);
const AT_HOME = [...KEPT.proteinNames, ...KEPT.atHome];
const HOME = homeProteins(KEPT);
const opts = (ingredient: string, over: object = {}) =>
  swapOptions({ ingredient, inDish: ["salmon fillets", "spinach", "jasmine rice", "olive oil", "garlic"], atHome: AT_HOME, home: HOME, allowed: () => true, ...over });

test("familyOf: the families of the design, and names that only sound like one", () => {
  const fam = (n: string) => familyOf(n)?.key ?? null;
  assert.equal(fam("baby spinach"), "leafy greens");
  assert.equal(fam("Russet potatoes"), "potatoes");
  assert.equal(fam("jasmine rice"), "grains");
  assert.equal(fam("rice vinegar"), "vinegars");
  assert.equal(fam("chicken stock"), "stock");
  assert.equal(fam("olive oil"), "oils");
  assert.equal(fam("sesame oil"), "oils");
  assert.equal(fam("unsalted butter"), "oils");
  assert.equal(fam("peanut butter"), "nuts");
  assert.equal(fam("lemon"), "citrus");
  assert.equal(fam("red bell pepper"), "peppers");
  assert.equal(fam("Bell peppers"), "peppers");
  assert.equal(fam("pepper"), null); // the seasoning
  assert.equal(fam("Yellow onions"), "onions");
  assert.equal(fam("Garlic"), null); // nothing is like garlic
  assert.equal(fam("feta"), "soft cheese");
  assert.equal(fam("fresh parsley"), "fresh herbs");
  assert.equal(fam("dried oregano"), "dried herbs");
  assert.equal(fam("thyme"), "dried herbs");
  assert.equal(fam("shredded cheddar cheese"), "hard cheese");
  // Not a family: proteins, spices, sauces.
  for (const n of ["salmon fillets", "eggs", "black beans", "black pepper", "garlic powder", "tomato paste", "soy sauce", "paprika", "salt", "water"]) assert.equal(fam(n), null, n);
  assert.equal(new Set(FAMILIES.map((f) => f.key)).size, FAMILIES.length);
});

test("swapOptions: at-home foods of the family first, then common ones; never a food already in the dish", () => {
  assert.deepEqual(opts("spinach"), { protein: false, options: [{ name: "Kale", atHome: true }, { name: "chard", atHome: false }, { name: "arugula", atHome: false }] });
  // Rice is in the dish; potatoes are another family.
  assert.deepEqual(opts("jasmine rice").options.map((o) => o.name), ["quinoa", "couscous", "bulgur"]);
  // A food the table does not know: nothing to offer ("Nothing similar" only).
  assert.deepEqual(opts("paprika"), { protein: false, options: [] });
  // The diet takes its share.
  assert.deepEqual(opts("spinach", { allowed: (f: string) => f !== "chard" }).options.map((o) => o.name), ["Kale", "arugula"]);
  assert.ok(opts("olive oil").options.length <= MAX_SWAP_OPTIONS);
});

test("swapOptions: a protein is offered the other proteins at home, then a dish without one", () => {
  const r = opts("salmon fillets");
  assert.equal(r.protein, true);
  assert.deepEqual(r.options, [
    { name: "Ground beef", atHome: true }, { name: "Large eggs", atHome: true },
    { name: "Cremini mushrooms", atHome: true }, { name: "beans", atHome: false },
  ]);
  // Potatoes are no stand-in in a dish that already has rice; in one without a starch they are.
  assert.ok(opts("salmon fillets", { inDish: ["salmon fillets", "spinach"] }).options.some((o) => o.name === "Russet potatoes"));
  // At-home options before the rest, whatever the table's order.
  const some = swapOptions({ ingredient: "salmon fillets", inDish: ["salmon fillets"], atHome: ["Russet potatoes"], home: [], allowed: () => true });
  assert.deepEqual(some.options.map((o) => [o.name, o.atHome]), [["Russet potatoes", true], ["mushrooms", false], ["beans", false], ["lentils", false]]);
  // Nothing else at home: the non-protein options by their plain names.
  const bare = swapOptions({ ingredient: "ground chicken", inDish: ["ground chicken", "rice"], atHome: [], home: [], allowed: () => true });
  assert.deepEqual(bare.options.map((o) => [o.name, o.atHome]), [["mushrooms", false], ["beans", false], ["lentils", false]]);
});

test("plainSwap and swapInRecipe: a like-for-like exchange changes the line, the steps and the name, and nothing else", () => {
  assert.equal(plainSwap("spinach", "Kale"), true);
  assert.equal(plainSwap("jasmine rice", "Russet potatoes"), false);
  assert.equal(plainSwap("salmon fillets", "Ground beef"), false);
  const recipe: ClaraRecipe = {
    name: "Salmon and Spinach Rice Bowl", servings: 1, minutes: 25,
    ingredients: [{ name: "salmon fillets", quantity: 150, unit: "g" }, { name: "baby spinach", quantity: 60, unit: "g" }, { name: "jasmine rice", quantity: 60, unit: "g" }],
    steps: ["Simmer the jasmine rice for 15 minutes.", "Sear the salmon fillets for 4 minutes a side.", "Wilt the spinach and serve."],
    perServing: { calories: 560, protein: 36, carbs: 50, fat: 22, fibre: 3, sodium: null },
  };
  const out = swapInRecipe(recipe, "baby spinach", "Kale")!;
  assert.equal(out.name, "Salmon and Kale Rice Bowl");
  assert.deepEqual(out.ingredients[1], { name: "kale", quantity: 60, unit: "g" });
  assert.equal(out.steps[2], "Wilt the kale and serve.");
  assert.deepEqual([out.steps[0], out.steps[1], out.perServing], [recipe.steps[0], recipe.steps[1], recipe.perServing]);
  assert.equal(swapInRecipe(recipe, "broccoli", "Kale"), null);
  // Singular and plural: the name says "Potato", the line says "potatoes" (live swap run, 2026-11-22).
  const hash: ClaraRecipe = {
    ...recipe, name: "Ground Beef and Russet Potato Skillet",
    ingredients: [{ name: "ground beef", quantity: 120, unit: "g" }, { name: "russet potatoes", quantity: 200, unit: "g" }],
    steps: ["Dice the russet potatoes.", "Brown the ground beef, then return the potatoes to the pan."],
  };
  const sweet = swapInRecipe(hash, "russet potatoes", "sweet potatoes")!;
  assert.equal(sweet.name, "Ground Beef and Sweet Potato Skillet");
  assert.deepEqual(sweet.steps, ["Dice the sweet potatoes.", "Brown the ground beef, then return the sweet potatoes to the pan."]);
  // A mention the replacement cannot reach (another word for the food) refuses the exchange rather than leave it in.
  const stray: ClaraRecipe = { ...recipe, steps: [...recipe.steps, "Scatter the greens over the bowl."] };
  assert.ok(swapInRecipe(stray, "baby spinach", "Kale"));
  const left: ClaraRecipe = { ...hash, name: "Beef and Spud Skillet", steps: ["Boil each potato whole.", "Mash with the ground beef."], ingredients: [{ name: "ground beef", quantity: 120, unit: "g" }, { name: "new potatoes", quantity: 200, unit: "g" }] };
  assert.equal(swapInRecipe(left, "new potatoes", "sweet potatoes")?.steps[0], "Boil each sweet potato whole.");
  assert.equal(swapInRecipe({ ...left, steps: ["Peel the potato-like tubers."] }, "new potatoes", "quinoa")?.steps[0] ?? null, "Peel the quinoa-like tubers.");
});

test("parseSwapBody: exactly the three actions, with a real recipe", () => {
  const recipe = {
    name: "Salmon Bowl", servings: 1, minutes: 20, ingredients: [{ name: "salmon", quantity: 150, unit: "g" }], steps: ["Sear the salmon."],
    perServing: { calories: 400, protein: 30, carbs: 20, fat: 20, fibre: 2, sodium: null },
  };
  assert.equal(parseSwapBody({ action: "options", recipe, ingredient: "salmon" })?.action, "options");
  assert.equal(parseSwapBody({ action: "apply", mealType: "dinner", today: "2026-11-22", recipe, ingredient: "salmon", replacement: " Ground  beef " })?.action, "apply");
  assert.equal((parseSwapBody({ action: "apply", mealType: "dinner", today: "2026-11-22", recipe, ingredient: "salmon", replacement: " Ground  beef " }) as any).replacement, "Ground beef");
  assert.equal(parseSwapBody({ action: "without", mealType: "lunch", today: "2026-11-22", recipe, ingredient: "salmon" })?.action, "without");
  for (const bad of [
    null, [], { action: "options", recipe, ingredient: "" }, { action: "options", recipe: { ...recipe, steps: "x" }, ingredient: "salmon" },
    { action: "apply", mealType: "brunch", today: "2026-11-22", recipe, ingredient: "salmon", replacement: "beef" },
    { action: "apply", mealType: "dinner", today: "22/11/2026", recipe, ingredient: "salmon", replacement: "beef" },
    { action: "apply", mealType: "dinner", today: "2026-11-22", recipe, ingredient: "salmon" },
    { action: "apply", mealType: "dinner", today: "2026-11-22", recipe, ingredient: "salmon", replacement: "x".repeat(81) },
    { action: "delete", mealType: "dinner", today: "2026-11-22", recipe, ingredient: "salmon" },
  ]) assert.equal(parseSwapBody(bad), null, JSON.stringify(bad)?.slice(0, 80));
});
