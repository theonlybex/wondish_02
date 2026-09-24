// Can this dish's stated amounts possibly contain its stated macros?
//
// Cycle 2 made a dish's calories agree with its own macro rows. Cycle 3 showed
// that neither then agrees with the FOOD: a dinner listing "150 g Brown rice"
// (step 1: "cook in a pot with 1 cup water until tender, about 45 minutes", so
// dry) declared 535 kcal and 48 g of carbohydrate for the whole plate — while
// the rice alone is about 115 g of carbohydrate and 545 kcal. Across one week
// 17 of 28 dishes were understated on that reading, averaging roughly +750
// kcal/day against a 1,938 kcal weight-loss target.
//
// The ingredient catalog cannot settle it: `unit` is null on all 766 rows and
// the grains carry no nutrition at all. What CAN be checked is the arithmetic
// of a handful of dense staples whose composition is textbook and stable. If a
// dish says it contains 150 g of rice, it contains at least the carbohydrate
// in 150 g of rice, whatever else is on the plate.
//
// Deliberately narrow:
//   - only staples dense enough for the error to matter, and stable enough to
//     hard-code (rice, pasta, oats, flour, sugar, oil, butter…);
//   - only a LOWER bound, so a dish is never rejected for declaring more;
//   - a wide tolerance, so rounding, a cooked-weight reading of a soft
//     ingredient, or an unusual variety never trips it.
// It exists to catch a dish that is out by a factor, not one out by a tenth.

/** Carbohydrate and fat per 100 g, as bought (dry for grains). */
const DENSITY: { match: RegExp; carbs: number; fat: number; gramsPerCup: number }[] = [
  // Grains and pasta, dry. ~75 g carbs/100 g is true of every rice, and of
  // pasta, couscous and most flours within a few grams.
  { match: /\b(rice)\b/i, carbs: 78, fat: 1, gramsPerCup: 185 },
  { match: /\b(pasta|spaghetti|macaroni|penne|noodle|couscous|orzo)\b/i, carbs: 75, fat: 2, gramsPerCup: 100 },
  { match: /\b(oats?|oatmeal|rolled oats)\b/i, carbs: 66, fat: 7, gramsPerCup: 90 },
  { match: /\b(quinoa|bulgur|farro|barley|millet)\b/i, carbs: 70, fat: 6, gramsPerCup: 170 },
  { match: /\b(flour|cornmeal|breadcrumbs?)\b/i, carbs: 76, fat: 1, gramsPerCup: 120 },
  { match: /\b(lentils?|chickpeas?|black beans?|kidney beans?|white beans?)\b/i, carbs: 60, fat: 2, gramsPerCup: 190 },
  { match: /\b(sugar|honey|maple syrup)\b/i, carbs: 95, fat: 0, gramsPerCup: 200 },
  // Fats. Oil is the one ingredient that is essentially 100% fat.
  { match: /\b(oil)\b/i, carbs: 0, fat: 100, gramsPerCup: 218 },
  { match: /\b(butter|ghee)\b/i, carbs: 0, fat: 81, gramsPerCup: 227 },
];

const GRAMS_PER_UNIT: { match: RegExp; grams: number | "cup" }[] = [
  { match: /^\s*(g|gram|grams|gr)\s*$/i, grams: 1 },
  { match: /^\s*(kg|kilogram|kilograms)\s*$/i, grams: 1000 },
  { match: /^\s*(oz|ounce|ounces)\s*$/i, grams: 28.35 },
  { match: /^\s*(lb|lbs|pound|pounds)\s*$/i, grams: 453.6 },
  { match: /^\s*(cup|cups)\s*$/i, grams: "cup" },
  { match: /^\s*(tbsp|tablespoon|tablespoons)\s*$/i, grams: "cup" }, // 1/16 cup, scaled below
  { match: /^\s*(tsp|teaspoon|teaspoons)\s*$/i, grams: "cup" }, // 1/48 cup
];
const CUP_FRACTION: { match: RegExp; fraction: number }[] = [
  { match: /^\s*(cup|cups)\s*$/i, fraction: 1 },
  { match: /^\s*(tbsp|tablespoon|tablespoons)\s*$/i, fraction: 1 / 16 },
  { match: /^\s*(tsp|teaspoon|teaspoons)\s*$/i, fraction: 1 / 48 },
];

/** Grams of `name` implied by `quantity` `unit`, or null when not convertible. */
export function gramsOf(name: string, quantity: number | null | undefined, unit: string | null | undefined): number | null {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null;
  const u = unit ?? "";
  const density = DENSITY.find((d) => d.match.test(name));
  const conv = GRAMS_PER_UNIT.find((c) => c.match.test(u));
  if (!conv) return null;
  if (conv.grams === "cup") {
    if (!density) return null; // volume needs the food's own cup weight
    const frac = CUP_FRACTION.find((c) => c.match.test(u))?.fraction ?? 1;
    return quantity * frac * density.gramsPerCup;
  }
  return quantity * conv.grams;
}

export interface MacroFloor {
  carbs: number;
  fat: number;
  /** The staples that produced the floor, for the log line. */
  from: string[];
}

// Whether a unit pins the amount down well enough to argue from.
//
// Mass does: "150 g brown rice" is 150 g of rice however it is later cooked.
// Volume does not: three quarters of a cup of rice is ~139 g dry and ~145 g
// COOKED, and the second is a third of the carbohydrate. Applying the floor to
// cup measures flagged honest dishes that had simply been written on a cooked
// basis, so volume is left out and the prompt asks for grains by weight
// instead. A rule that cannot tell which of two readings a number used has no
// business calling the dish wrong.
const isMassUnit = (unit: string | null | undefined): boolean =>
  /^\s*(g|gram|grams|gr|kg|kilogram|kilograms|oz|ounce|ounces|lb|lbs|pound|pounds)\s*$/i.test(unit ?? "");

/** The least carbohydrate and fat these ingredients can contain. */
export function macroFloor(
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null }[]
): MacroFloor {
  let carbs = 0;
  let fat = 0;
  const from: string[] = [];
  for (const ing of ingredients) {
    const density = DENSITY.find((d) => d.match.test(ing.name));
    if (!density) continue;
    if (!isMassUnit(ing.unit)) continue;
    const grams = gramsOf(ing.name, ing.quantity, ing.unit);
    if (grams == null || grams <= 0) continue;
    carbs += (grams * density.carbs) / 100;
    fat += (grams * density.fat) / 100;
    from.push(`${ing.name} ${ing.quantity}${ing.unit ? ` ${ing.unit}` : ""}`);
  }
  return { carbs, fat, from };
}

/**
 * How far below the floor a dish's declared macros may sit.
 *
 * Generous on purpose. Grains lose nothing cooking, but a cook may weigh rice
 * cooked rather than dry, varieties differ, and the model rounds — so only a
 * dish out by a wide margin is refused. At 0.6 a dinner declaring 48 g of carbs
 * over 150 g of rice (floor 117 g) is refused, while one declaring 44 g over
 * 60 g of rice (floor 47 g) is not.
 */
export const MACRO_FLOOR_TOLERANCE = 0.6;

// Below these the arithmetic is not worth acting on: a teaspoon of oil is 5 g
// of fat, and a dish rounding that to zero is untidy rather than misleading.
// Measured against the live pool, this also stops the rule firing on rows
// like "avocado oil 0.25 gr" whose floor is a fraction of a gram.
const MIN_CARB_FLOOR = 25;
const MIN_FAT_FLOOR = 10;

/** Do the declared macros contradict the amounts? Returns the reason, or null. */
export function macrosContradictAmounts(
  declared: { carbs?: number | null; fat?: number | null },
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null }[]
): string | null {
  const floor = macroFloor(ingredients);
  if (floor.from.length === 0) return null;
  const carbs = declared.carbs ?? 0;
  const fat = declared.fat ?? 0;
  if (floor.carbs >= MIN_CARB_FLOOR && carbs < floor.carbs * MACRO_FLOOR_TOLERANCE) {
    return `carbs ${Math.round(carbs)}g below the ${Math.round(floor.carbs)}g in ${floor.from.join(", ")}`;
  }
  if (floor.fat >= MIN_FAT_FLOOR && fat < floor.fat * MACRO_FLOOR_TOLERANCE) {
    return `fat ${Math.round(fat)}g below the ${Math.round(floor.fat)}g in ${floor.from.join(", ")}`;
  }
  return null;
}
