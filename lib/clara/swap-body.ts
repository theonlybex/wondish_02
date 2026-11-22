// The body of POST /api/clara/dish/swap, validated. Pure.
import { validateRecipe } from "./cook";
import type { ClaraRecipe } from "./parts";

export const SWAP_MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type SwapMeal = (typeof SWAP_MEALS)[number];
const MAX_FOOD = 80;

export type SwapBody =
  | { action: "options"; recipe: ClaraRecipe; ingredient: string }
  | { action: "apply"; mealType: SwapMeal; today: string; recipe: ClaraRecipe; ingredient: string; replacement: string }
  | { action: "without"; mealType: SwapMeal; today: string; recipe: ClaraRecipe; ingredient: string };

const food = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= MAX_FOOD ? t : null;
};

/** null for anything that is not exactly one of the three actions with its fields. */
export function parseSwapBody(raw: unknown): SwapBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const recipe = validateRecipe(o.recipe);
  const ingredient = food(o.ingredient);
  if (!recipe || !ingredient) return null;
  if (o.action === "options") return { action: "options", recipe, ingredient };
  const mealType = SWAP_MEALS.find((m) => m === o.mealType);
  const today = typeof o.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.today) ? o.today : null;
  if (!mealType || !today) return null;
  if (o.action === "without") return { action: "without", mealType, today, recipe, ingredient };
  if (o.action === "apply") {
    const replacement = food(o.replacement);
    return replacement ? { action: "apply", mealType, today, recipe, ingredient, replacement } : null;
  }
  return null;
}
