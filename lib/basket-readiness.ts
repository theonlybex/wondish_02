import { classifyIngredient, type CategoryKey } from "./ingredient-categories";

// A basket must be big enough AND cover the core food groups before a week can
// be generated — this is the gate that guarantees "no empty days" without
// filler. Shared by the server route and the client counter so they agree.
export const MIN_BASKET = 12;
const REQUIRED: CategoryKey[] = ["protein", "carb", "vegetable"];

/**
 * Something you could put in front of someone at 8am.
 *
 * A QA basket of 15 items — four kinds of rice, four meats, six vegetables, no
 * eggs, no oats, no bread, no yoghurt, no fruit — passed this gate as "enough
 * to fill a full week", and the builder then shipped seven breakfasts it could
 * not make properly: rice porridge with no protein, and a dish called "Oatmeal"
 * built on brown rice. Asked for a breakfast with eggs, the swap answered
 * "Clara could only think of dishes that need something you don't have."
 *
 * The gate was measuring protein/carb/vegetable, which a bag of rice and some
 * chicken satisfies. Breakfast is the meal a savoury-dinner pantry cannot make,
 * so it is the one that has to be asked about by name.
 */
// NB the explicit plurals: /\begg\b/ does not match "Large eggs", because the
// word boundary fails before the "s". The first version of this list was
// written with singulars and silently did not recognise eggs, oats or berries —
// the three most obvious breakfast foods in the catalog.
const BREAKFAST_CAPABLE =
  /\b(eggs?|oats?|oatmeal|granola|muesli|yogh?urt|bread|toast|muffins?|bagels?|tortillas?|pancakes?|waffles?|bananas?|(?:straw|blue|rasp|black|cran)?berr(?:y|ies)|apples?|oranges?|melon|fruit|milk|cheese|cottage|peanut butter|almond butter|honey|jam)\b/i;

export function hasBreakfastStaple(names: string[]): boolean {
  return names.some((n) => BREAKFAST_CAPABLE.test(n));
}

export function computeBasketReadiness(names: string[]): {
  count: number;
  min: number;
  ready: boolean;
  missingCategories: CategoryKey[];
  /** True when nothing in the basket belongs at breakfast. */
  missingBreakfast: boolean;
} {
  const present = new Set(names.map(classifyIngredient));
  const missingCategories = REQUIRED.filter((c) => !present.has(c));
  const count = names.length;
  const missingBreakfast = !hasBreakfastStaple(names);
  return {
    count,
    min: MIN_BASKET,
    ready: count >= MIN_BASKET && missingCategories.length === 0 && !missingBreakfast,
    missingCategories,
    missingBreakfast,
  };
}

/**
 * What the user has to do next, in one sentence.
 *
 * One composer, three screens. /pantry built the compound message correctly —
 * "Add 12 more (including a protein, a carb, a vegetable) — and something for
 * breakfast" — while /meal-plan and the new-week route both tested
 * missingBreakfast FIRST, so an empty basket was told to add breakfast and
 * nothing about the eleven other things it needed. QA hit it: two screens
 * contradicted each other about the same basket, and getting unblocked took two
 * rounds instead of one.
 *
 * Ordered by the size of the gap, not by which flag reads most specific: the
 * count, then the food groups, then breakfast — except the one case where
 * naming breakfast really is the whole answer, which is a basket that has
 * everything else.
 */
export function basketBlockerText(status: {
  count: number;
  min: number;
  ready: boolean;
  missingCategories: readonly string[];
  missingBreakfast?: boolean;
}): string | null {
  if (status.ready) return null;
  const breakfast = status.missingBreakfast === true;
  const groups = status.missingCategories;
  const short = status.min - status.count;

  // Plenty of food, none of it breakfast — the case that IS just breakfast.
  if (breakfast && short <= 0 && groups.length === 0) {
    return "Add something for breakfast — eggs, oats, bread, yoghurt or fruit.";
  }
  if (short > 0) {
    return (
      `Add ${short} more ingredient${short === 1 ? "" : "s"}` +
      (groups.length ? ` (including a ${groups.join(", a ")})` : "") +
      (breakfast ? " — and something for breakfast (eggs, oats, bread, yoghurt)" : "") +
      "."
    );
  }
  return (
    `Add a ${groups.join(" and a ")}` +
    (breakfast ? ", and something for breakfast," : "") +
    " to cover a full week."
  );
}
