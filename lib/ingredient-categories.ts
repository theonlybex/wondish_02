// Keyword ingredient classification. Shared by the basket-readiness gate and
// (later) the leveled swipe deck. First matching keyword wins; unknown → other.
export type CategoryKey = "protein" | "carb" | "vegetable" | "fruit" | "dairy" | "fat" | "other";

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  protein: "protein",
  carb: "grain or carb",
  vegetable: "vegetable",
  fruit: "fruit",
  dairy: "dairy",
  fat: "fat or oil",
  other: "other",
};

const KEYWORDS: [CategoryKey, string[]][] = [
  ["protein", ["chicken", "beef", "steak", "pork", "bacon", "sausage", "turkey", "lamb", "fish", "salmon", "tuna", "cod", "tilapia", "catfish", "shrimp", "prawn", "egg", "tofu", "tempeh", "seitan", "bean", "lentil", "chickpea", "ham"]],
  ["carb", ["rice", "pasta", "spaghetti", "penne", "noodle", "bread", "potato", "oat", "flour", "quinoa", "tortilla", "couscous", "barley", "cornmeal", "cereal", "bagel", "bun", "cracker", "wrap"]],
  ["vegetable", ["broccoli", "spinach", "carrot", "tomato", "onion", "garlic", "pepper", "mushroom", "lettuce", "cucumber", "zucchini", "cabbage", "kale", "corn", "pea", "bean sprout", "cauliflower", "celery", "asparagus", "eggplant", "squash", "scallion", "brussels"]],
  ["fruit", ["apple", "banana", "berry", "strawberry", "blueberry", "orange", "lemon", "lime", "mango", "grape", "peach", "pear", "pineapple", "melon", "cherry"]],
  ["dairy", ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream"]],
  ["fat", ["oil", "olive", "avocado", "nut", "almond", "peanut", "seed", "tahini"]],
];

// Substring keywords misfire on a few vegetables ("green beans" → bean →
// protein, "eggplant" → egg → protein): a vegetables-only basket passed the
// readiness gate as if it had a protein (QA 2026-09-11). Checked first.
const OVERRIDES: [string, CategoryKey][] = [
  ["green bean", "vegetable"],
  ["bean sprout", "vegetable"],
  ["eggplant", "vegetable"],
];

export function classifyIngredient(name: string): CategoryKey {
  const n = name.toLowerCase();
  for (const [w, cat] of OVERRIDES) if (n.includes(w)) return cat;
  for (const [cat, words] of KEYWORDS) if (words.some((w) => n.includes(w))) return cat;
  return "other";
}
