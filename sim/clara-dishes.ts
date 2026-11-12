// Dishes the FAKE dish model returns in sim/clara-first.sim.ts — the model's
// raw tool output (`suggest_recipes`), before any server-side gate.
//
// Two sources:
//   - hand-written templates over snapshot ingredient names (so the allergen
//     groups resolve the way persistence links them), several of which
//     naturally violate common rules (salmon for a fish allergy, soy sauce for
//     soy/wheat, yogurt for dairy, orzo for celiac …);
//   - library recipes from the read-only snapshot, turned into model output
//     (ingredients, per-serving amounts, the recipe's own steps and macros).
// Plus deliberate violations: a compliant dish with one of the person's banned
// ingredients slipped in (in the list, or only in a step), and a dish that
// says "cooking oil" (the oil repair must name an oil the person may have).
import type { Snapshot } from "./fake-db";

export type ModelDish = {
  name: string;
  description: string;
  emoji: string;
  usesIngredients: string[];
  missingIngredients: string[];
  steps: string[];
  mealType: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  amounts: { name: string; quantity: number; unit: string }[];
  perServing: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  fitsPlan: boolean;
  conflicts: string[];
};

type T = Omit<ModelDish, "mealType" | "servings" | "missingIngredients" | "fitsPlan" | "conflicts" | "emoji" | "usesIngredients"> & { meal: string };

const t = (meal: string, name: string, description: string, amounts: [string, number, string][], steps: string[], prep: number, cook: number, ps: [number, number, number, number, number]): T => ({
  meal,
  name,
  description,
  amounts: amounts.map(([n, q, u]) => ({ name: n, quantity: q, unit: u })),
  steps,
  prepMinutes: prep,
  cookMinutes: cook,
  perServing: { calories: ps[0], protein: ps[1], carbs: ps[2], fat: ps[3], fiber: ps[4] },
});

export const TEMPLATES: T[] = [
  t("Dinner", "Red Lentil and Spinach Stew", "A warming stew of red lentils, carrots and spinach.",
    [["red lentils", 70, "g"], ["spinach", 60, "g"], ["yellow onion", 80, "g"], ["carrots", 60, "g"], ["diced tomatoes", 120, "g"], ["olive oil", 1, "teaspoon"], ["ground cumin", 0.5, "teaspoon"], ["salt", 0.125, "teaspoon"]],
    ["Heat the olive oil in a pot over medium heat.", "Cook the onion and carrots for 5 minutes until soft.", "Add the red lentils, cumin and diced tomatoes, cover with water and simmer for 20 minutes until tender.", "Stir in the spinach and cook for 2 minutes until wilted.", "Season with the salt and serve."],
    10, 30, [330, 18, 50, 6, 14]),
  t("Dinner", "Baked Salmon with Quinoa and Broccoli", "Oven-baked salmon over quinoa with steamed broccoli and lemon.",
    [["salmon fillets", 140, "g"], ["quinoa", 50, "g"], ["broccoli", 100, "g"], ["olive oil", 1, "teaspoon"], ["lemon", 0.5, ""], ["salt", 0.125, "teaspoon"]],
    ["Heat the oven to 200°C.", "Rub the salmon fillets with the olive oil and bake for 15 minutes until the salmon flakes.", "Simmer the quinoa in water for 15 minutes until fluffy.", "Steam the broccoli for 5 minutes.", "Serve the salmon on the quinoa with the broccoli, squeeze over the lemon and season with the salt."],
    10, 20, [520, 38, 35, 24, 6]),
  t("Dinner", "Chicken and Brown Rice Bowl", "Pan-cooked chicken with peppers and broccoli over brown rice.",
    [["boneless chicken breasts", 150, "g"], ["brown rice", 60, "g"], ["red bell pepper", 80, "g"], ["broccoli", 80, "g"], ["olive oil", 1, "teaspoon"], ["garlic", 1, "clove"], ["salt", 0.125, "teaspoon"]],
    ["Simmer the brown rice in water for 30 minutes until tender.", "Heat the olive oil in a pan and cook the chicken breasts for 12 minutes until cooked through.", "Add the garlic, red bell pepper and broccoli and stir-fry for 5 minutes.", "Season with the salt and serve the chicken over the rice."],
    10, 35, [560, 48, 55, 14, 6]),
  t("Dinner", "Tofu and Broccoli Stir-Fry with Jasmine Rice", "Crisp tofu and broccoli in a soy glaze over jasmine rice.",
    [["extra-firm tofu", 150, "g"], ["jasmine rice", 60, "g"], ["broccoli", 80, "g"], ["red bell pepper", 60, "g"], ["olive oil", 1, "teaspoon"], ["soy sauce", 1, "tablespoon"]],
    ["Simmer the jasmine rice in water for 15 minutes.", "Heat the olive oil in a pan and fry the tofu for 8 minutes until golden.", "Add the broccoli and red bell pepper and stir-fry for 4 minutes.", "Stir in the soy sauce and serve over the rice."],
    10, 25, [480, 22, 60, 16, 4]),
  t("Dinner", "Chickpea and Sweet Potato Curry", "Chickpeas and sweet potato simmered with tomatoes, cumin and spinach.",
    [["chickpeas", 120, "g"], ["sweet potato", 150, "g"], ["spinach", 50, "g"], ["diced tomatoes", 100, "g"], ["olive oil", 1, "teaspoon"], ["ground cumin", 1, "teaspoon"], ["salt", 0.125, "teaspoon"]],
    ["Heat the olive oil in a pot and toast the cumin for 1 minute.", "Add the sweet potato and diced tomatoes and simmer for 20 minutes.", "Stir in the chickpeas and spinach and cook for 5 minutes.", "Season with the salt and serve."],
    10, 30, [420, 15, 70, 9, 15]),
  t("Dinner", "Garlic Shrimp Orzo with Zucchini", "Shrimp and zucchini tossed through buttery orzo.",
    [["shrimp", 120, "g"], ["orzo pasta", 70, "g"], ["zucchini", 100, "g"], ["garlic", 1, "clove"], ["butter", 1, "teaspoon"], ["salt", 0.125, "teaspoon"]],
    ["Boil the orzo pasta for 9 minutes and drain.", "Melt the butter in a pan and cook the shrimp for 4 minutes until pink.", "Add the garlic and zucchini and cook for 3 minutes.", "Toss with the orzo and season with the salt."],
    10, 20, [480, 32, 55, 12, 3]),
  t("Dinner", "Turkey and Black Bean Chili", "A hearty chili of ground turkey, black beans and tomatoes.",
    [["ground turkey", 120, "g"], ["black beans", 100, "g"], ["diced tomatoes", 150, "g"], ["yellow onion", 60, "g"], ["olive oil", 1, "teaspoon"], ["ground cumin", 1, "teaspoon"], ["salt", 0.125, "teaspoon"]],
    ["Heat the olive oil in a pot and cook the onion for 4 minutes.", "Add the ground turkey and brown it for 6 minutes until cooked through.", "Stir in the cumin, black beans and diced tomatoes and simmer for 20 minutes.", "Season with the salt and serve."],
    10, 30, [450, 38, 40, 14, 12]),
  t("Lunch", "Quinoa Chickpea Salad", "Quinoa, chickpeas, cucumber and tomatoes with lemon and olive oil.",
    [["quinoa", 50, "g"], ["chickpeas", 100, "g"], ["cucumber", 80, "g"], ["cherry tomatoes", 80, "g"], ["olive oil", 1, "tablespoon"], ["lemon", 0.5, ""], ["salt", 0.125, "teaspoon"]],
    ["Simmer the quinoa in water for 15 minutes, then let it cool.", "Chop the cucumber and halve the cherry tomatoes.", "Toss the quinoa, chickpeas, cucumber and tomatoes with the olive oil, the lemon juice and the salt."],
    10, 15, [430, 16, 58, 15, 12]),
  t("Lunch", "Turkey and Avocado Sandwich", "Sliced turkey breast, avocado and spinach on whole wheat bread.",
    [["whole wheat bread", 2, "slice"], ["turkey breast", 80, "g"], ["avocado", 0.5, ""], ["spinach", 20, "g"]],
    ["Toast the whole wheat bread for 2 minutes.", "Mash the avocado onto the toast.", "Layer the turkey breast and spinach and close the sandwich."],
    5, 2, [390, 28, 36, 15, 9]),
  t("Lunch", "Black Bean and Sweet Potato Bowl", "Roasted sweet potato with black beans, avocado and lemon.",
    [["sweet potato", 150, "g"], ["black beans", 100, "g"], ["avocado", 0.5, ""], ["olive oil", 1, "teaspoon"], ["lemon", 0.5, ""], ["salt", 0.125, "teaspoon"]],
    ["Heat the oven to 200°C.", "Toss the sweet potato with the olive oil and roast for 25 minutes.", "Warm the black beans in a pan for 3 minutes.", "Serve the sweet potato and beans with the avocado, the lemon juice and the salt."],
    10, 28, [470, 14, 68, 16, 18]),
  t("Breakfast", "Oatmeal with Blueberries and Chia Seeds", "Creamy oats cooked in water, topped with blueberries and chia.",
    [["rolled oats", 50, "g"], ["blueberries", 80, "g"], ["chia seeds", 1, "tablespoon"], ["almond butter", 1, "tablespoon"]],
    ["Simmer the rolled oats in water for 5 minutes, stirring.", "Spoon into a bowl and top with the blueberries, chia seeds and almond butter."],
    2, 6, [370, 11, 48, 16, 11]),
  t("Breakfast", "Spinach Scrambled Eggs on Toast", "Soft scrambled eggs with spinach on whole wheat toast.",
    [["large eggs", 2, ""], ["spinach", 40, "g"], ["olive oil", 1, "teaspoon"], ["whole wheat bread", 1, "slice"], ["salt", 1, "pinch"]],
    ["Toast the whole wheat bread for 2 minutes.", "Heat the olive oil in a pan and wilt the spinach for 1 minute.", "Add the eggs and stir gently for 3 minutes until just set.", "Season with the salt and serve the eggs on the toast."],
    3, 6, [330, 18, 18, 20, 4]),
  t("Breakfast", "Greek Yogurt with Strawberries and Walnuts", "Thick yogurt with fresh strawberries and toasted walnuts.",
    [["plain greek yogurt", 170, "g"], ["strawberries", 80, "g"], ["walnuts", 15, "g"]],
    ["Spoon the plain greek yogurt into a bowl.", "Top with the strawberries and walnuts and serve."],
    5, 0, [280, 19, 16, 15, 3]),
  t("Breakfast", "Tofu Scramble with Spinach", "Turmeric-free tofu scramble with spinach and cumin.",
    [["extra-firm tofu", 120, "g"], ["spinach", 40, "g"], ["olive oil", 1, "teaspoon"], ["ground cumin", 0.5, "teaspoon"], ["salt", 1, "pinch"]],
    ["Heat the olive oil in a pan.", "Crumble in the tofu with the cumin and cook for 5 minutes.", "Add the spinach and cook for 1 minute until wilted, then season with the salt."],
    3, 6, [220, 18, 6, 14, 3]),
  t("Snack", "Apple with Almond Butter", "Apple slices with a spoon of almond butter.",
    [["apple", 1, ""], ["almond butter", 1, "tablespoon"]],
    ["Slice the apple.", "Serve with the almond butter for dipping."],
    3, 0, [195, 4, 25, 9, 5]),
  t("Snack", "Carrot Sticks with Hummus", "Crunchy carrot sticks with hummus.",
    [["carrots", 100, "g"], ["hummus", 50, "g"]],
    ["Cut the carrots into sticks.", "Serve with the hummus."],
    5, 0, [170, 5, 20, 8, 6]),
];

/** A template as the model would write it for a meal and a number of people. */
export function fromTemplate(tp: T, servings: number): ModelDish {
  return {
    name: tp.name,
    description: tp.description,
    emoji: "🍽️",
    usesIngredients: tp.amounts.map((a) => a.name),
    missingIngredients: [],
    steps: [...tp.steps],
    mealType: tp.meal,
    servings,
    prepMinutes: tp.prepMinutes,
    cookMinutes: tp.cookMinutes,
    amounts: tp.amounts.map((a) => ({ ...a })),
    perServing: { ...tp.perServing },
    fitsPlan: true,
    conflicts: [],
  };
}

/** A library recipe as model output: its ingredients, per-serving amounts, steps and macros. */
export function fromLibrary(snap: Snapshot, ingById: Map<string, { name: string }>, recipe: Snapshot["recipes"][number], meal: string, servings: number): ModelDish | null {
  const per = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
  const amounts = recipe.ingredients
    .map((ri) => ({ name: ingById.get(ri.ingredientId)?.name ?? "", quantity: ri.quantity == null ? 0 : ri.quantity / per, unit: ri.unit ?? "" }))
    .filter((a) => a.name && a.quantity > 0);
  if (amounts.length === 0 || !Array.isArray(recipe.steps) || recipe.steps.length === 0) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v / per : 0);
  return {
    name: recipe.name,
    description: recipe.description ?? recipe.name,
    emoji: recipe.emoji ?? "🍽️",
    usesIngredients: amounts.map((a) => a.name),
    missingIngredients: [],
    steps: [...recipe.steps],
    mealType: meal,
    servings,
    prepMinutes: recipe.prepTime ?? 10,
    cookMinutes: recipe.cookTime ?? 20,
    amounts,
    perServing: { calories: n(recipe.calories), protein: n(recipe.protein), carbs: n(recipe.carbs), fat: n(recipe.fat), fiber: n(recipe.fiber) },
    fitsPlan: true,
    conflicts: [],
  };
}

/** The same dish with one banned ingredient slipped in: listed, or only named in a step. */
export function withSlippedIn(d: ModelDish, ingredient: string, where: "list" | "step"): ModelDish {
  const out: ModelDish = { ...d, usesIngredients: [...d.usesIngredients], amounts: d.amounts.map((a) => ({ ...a })), steps: [...d.steps] };
  if (where === "list") {
    out.usesIngredients.push(ingredient);
    out.amounts.push({ name: ingredient, quantity: 30, unit: "g" });
    out.steps.splice(out.steps.length - 1, 0, `Stir in the ${ingredient.toLowerCase()}.`);
  } else {
    out.steps.push(`Finish with a little ${ingredient.toLowerCase()} on top.`);
  }
  return out;
}

/** The same dish cooked in "cooking oil": the server must name a real oil the person may have. */
export function withGenericOil(d: ModelDish): ModelDish {
  const swap = (s: string) => s.replace(/\bolive oil\b/gi, "cooking oil");
  return {
    ...d,
    usesIngredients: d.usesIngredients.map(swap),
    amounts: d.amounts.map((a) => ({ ...a, name: swap(a.name) })),
    steps: d.steps.map(swap),
  };
}

/** A model dish in the generator's structured-output item shape (lib/clara/dish-output.ts). */
export function toOutputItem(d: ModelDish) {
  const byName = new Map(d.amounts.map((a) => [a.name.toLowerCase(), a]));
  return {
    name: d.name,
    description: d.description,
    prepMinutes: d.prepMinutes,
    cookMinutes: d.cookMinutes,
    ingredients: d.usesIngredients.map((n) => {
      const a = byName.get(n.toLowerCase());
      return { name: n, quantity: a?.quantity ?? 0, unit: a?.unit ?? "" };
    }),
    steps: d.steps,
    perServing: d.perServing,
  };
}

export type FakeStreamMode =
  | { kind: "dishes"; dishes: ModelDish[] }
  | { kind: "garbage" } // not the schema: truncated, half-parsed text
  | { kind: "hang" }; // never answers: only the deadline ends it

/**
 * The raw stream events the real SDK yields for `messages.create({stream: true})`
 * with a JSON output format: message_start, text deltas in small chunks,
 * message_delta, message_stop. Honours the abort signal like the SDK does.
 */
export async function* fakeDishStream(mode: FakeStreamMode, signal?: AbortSignal): AsyncGenerator<any> {
  const aborted = () => {
    const e = new Error("Request was aborted.");
    e.name = "APIUserAbortError";
    return e;
  };
  yield { type: "message_start", message: { usage: { input_tokens: 1500, output_tokens: 1 } } };
  yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
  if (mode.kind === "hang") {
    await new Promise<void>((_, reject) => {
      if (signal?.aborted) reject(aborted());
      signal?.addEventListener("abort", () => reject(aborted()), { once: true });
    });
    return;
  }
  const text = mode.kind === "garbage"
    ? '{"dishes":[{"name":"Broken","ingredients":[{"name":"rice","quantity":50,"g"}], "steps": "not a list", "perServing": {"calories": "lots"}}, {"name": "Cut off mid'
    : JSON.stringify({ dishes: mode.dishes.map(toOutputItem) });
  for (let i = 0; i < text.length; i += 40) {
    if (signal?.aborted) throw aborted();
    yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 40) } };
  }
  yield { type: "content_block_stop", index: 0 };
  yield { type: "message_delta", delta: { stop_reason: mode.kind === "garbage" ? "max_tokens" : "end_turn" }, usage: { output_tokens: Math.ceil(text.length / 4) } };
  yield { type: "message_stop" };
}
