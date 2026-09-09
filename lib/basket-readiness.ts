import { classifyIngredient, type CategoryKey } from "./ingredient-categories";

// A basket must be big enough AND cover the core food groups before a week can
// be generated — this is the gate that guarantees "no empty days" without
// filler. Shared by the server route and the client counter so they agree.
export const MIN_BASKET = 12;
const REQUIRED: CategoryKey[] = ["protein", "carb", "vegetable"];

export function computeBasketReadiness(names: string[]): {
  count: number;
  min: number;
  ready: boolean;
  missingCategories: CategoryKey[];
} {
  const present = new Set(names.map(classifyIngredient));
  const missingCategories = REQUIRED.filter((c) => !present.has(c));
  const count = names.length;
  return {
    count,
    min: MIN_BASKET,
    ready: count >= MIN_BASKET && missingCategories.length === 0,
    missingCategories,
  };
}
