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

/**
 * Per 100 g as bought (dry for grains, raw for meat), for the foods this
 * catalog actually uses. Textbook reference values.
 *
 * Extended 2026-09-24 from carbs+fat on staples to full macros on the common
 * foods, because a lower bound on grains was not enough: QA found a dish
 * declaring 32 g of protein over 70 g of chicken breast (~16 g), and two
 * oat breakfasts declaring exactly DOUBLE the carbohydrate their oats contain.
 * A floor catches under-declaration; over-declaration needs a priced dish.
 */
const DENSITY: {
  match: RegExp;
  carbs: number;
  fat: number;
  protein?: number;
  gramsPerCup: number;
  /**
   * True when a volume measure means the same thing however the food is
   * cooked, so it can be priced without evidence from the steps.
   *
   * A cup of rice is ~185 g dry and ~195 g cooked with a third of the
   * carbohydrate, which is why grains need the dry-grain test. A tablespoon of
   * oil is 13.6 g of oil in every kitchen in the world. Gating oil behind the
   * GRAIN test is what QA found next: a dish whose steps lacked
   * grain-cooking language had its oil row left unpriced, coverage fell below
   * the bar, the model's numbers stood, and 5 dishes in one week declared less
   * total fat than their oil alone contains — one of them 11 g of fat over
   * 20.4 g of poured oil.
   */
  volumeUnambiguous?: boolean;
}[] = [
  // Grains and pasta, dry. ~75 g carbs/100 g is true of every rice, and of
  // pasta, couscous and most flours within a few grams.
  { match: /\b(rice)\b/i, carbs: 78, fat: 1, protein: 7, gramsPerCup: 185 },
  { match: /\b(pasta|spaghetti|macaroni|penne|noodle|couscous|orzo)\b/i, carbs: 75, fat: 2, protein: 13, gramsPerCup: 100 },
  { match: /\b(oats?|oatmeal)\b/i, carbs: 66, fat: 7, protein: 13, gramsPerCup: 90 },
  { match: /\b(quinoa|bulgur|farro|barley|millet)\b/i, carbs: 70, fat: 6, protein: 13, gramsPerCup: 170 },
  { match: /\b(flour|cornmeal|breadcrumbs?)\b/i, carbs: 76, fat: 1, protein: 10, gramsPerCup: 120 },
  { match: /\b(lentils?|chickpeas?|black beans?|kidney beans?|white beans?)\b/i, carbs: 60, fat: 2, protein: 24, gramsPerCup: 190 },
  { match: /\b(sugar|honey|maple syrup)\b/i, carbs: 95, fat: 0, protein: 0, gramsPerCup: 200 , volumeUnambiguous: true },
  // Fats. Oil is the one ingredient that is essentially 100% fat.
  { match: /\b(oil)\b/i, carbs: 0, fat: 100, protein: 0, gramsPerCup: 218 , volumeUnambiguous: true },
  { match: /\b(butter|ghee)\b/i, carbs: 0, fat: 81, protein: 1, gramsPerCup: 227 , volumeUnambiguous: true },
  // Proteins, raw. Enough to tell 16 g of protein from a claimed 32 g.
  { match: /\b(chicken breasts?|turkey breast)\b/i, carbs: 0, fat: 3, protein: 23, gramsPerCup: 140 },
  { match: /\b(chicken thighs?)\b/i, carbs: 0, fat: 11, protein: 19, gramsPerCup: 140 },
  { match: /\b(ground beef|beef|steak|sirloin)\b/i, carbs: 0, fat: 15, protein: 20, gramsPerCup: 225 },
  { match: /\b(ground turkey|ground chicken)\b/i, carbs: 0, fat: 8, protein: 19, gramsPerCup: 225 },
  { match: /\b(ground pork|pork|bacon|ham)\b/i, carbs: 0, fat: 14, protein: 20, gramsPerCup: 225 },
  { match: /\b(salmon)\b/i, carbs: 0, fat: 13, protein: 20, gramsPerCup: 150 },
  { match: /\b(tuna|cod|tilapia|haddock|white fish)\b/i, carbs: 0, fat: 2, protein: 22, gramsPerCup: 150 },
  { match: /\b(shrimp|prawns?)\b/i, carbs: 1, fat: 1, protein: 20, gramsPerCup: 145 },
  { match: /\b(eggs?)\b/i, carbs: 1, fat: 10, protein: 13, gramsPerCup: 243 },
  { match: /\b(tofu|tempeh)\b/i, carbs: 4, fat: 8, protein: 17, gramsPerCup: 250 },
  // Bread and dairy.
  { match: /\b(bread|muffin|bagel|tortilla|pita|toast)\b/i, carbs: 49, fat: 3, protein: 9, gramsPerCup: 120 },
  { match: /\b(greek yogurt)\b/i, carbs: 4, fat: 4, protein: 9, gramsPerCup: 245 , volumeUnambiguous: true },
  { match: /\b(yogurt|milk)\b/i, carbs: 5, fat: 3, protein: 3, gramsPerCup: 245 , volumeUnambiguous: true },
  { match: /\b(cheddar|parmesan|feta|mozzarella|cheese)\b/i, carbs: 2, fat: 28, protein: 24, gramsPerCup: 110 },
  { match: /\b(almonds?|walnuts?|peanuts?|cashews?|nuts)\b/i, carbs: 22, fat: 50, protein: 21, gramsPerCup: 140 },
  { match: /\b(peanut butter|almond butter)\b/i, carbs: 20, fat: 50, protein: 25, gramsPerCup: 258 },
  { match: /\b(avocado)\b/i, carbs: 9, fat: 15, protein: 2, gramsPerCup: 150 },
  // Vegetables and fruit, as a group: little of anything, but not nothing.
  // "bell peppers", not "peppers?": a bare "pepper" is the seasoning, and
  // matching it here put "pepper 0.1 teaspoon" into the floor as a vegetable.
  { match: /\b(broccoli|cauliflower|zucchini|spinach|carrots?|bell peppers?|tomato(es)?|onions?|celery|cucumber|lettuce|cabbage|mushrooms?|greens?|kale|asparagus|green beans?)\b/i, carbs: 6, fat: 0, protein: 2, gramsPerCup: 120 },
  { match: /\b(potato(es)?|sweet potato(es)?|corn|peas)\b/i, carbs: 18, fat: 0, protein: 2, gramsPerCup: 150 },
  { match: /\b(apples?|bananas?|berries|strawberries|blueberries|oranges?|grapes?|pears?|melon)\b/i, carbs: 13, fat: 0, protein: 1, gramsPerCup: 150 },
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
// Mass always does: "150 g brown rice" is 150 g of rice however it is cooked.
const isMassUnit = (unit: string | null | undefined): boolean =>
  /^\s*(g|gram|grams|gr|kg|kilogram|kilograms|oz|ounce|ounces|lb|lbs|pound|pounds)\s*$/i.test(unit ?? "");

// A grain measured by volume is DRY unless the recipe says otherwise.
//
// This started as the opposite default. A cup of rice is ~185 g dry and ~195 g
// cooked with a third of the carbohydrate, so volume was excluded entirely and
// the prompt was asked for grams; then the steps were read as evidence that the
// grain started dry. Both versions kept the same hole, and four generated weeks
// measured it: every cup-measured grain row was understated (ratios 0.29-0.63),
// every gram-measured row was accurate, and no week ever produced a cup row
// that meant cooked rice. The evidence-matching only moved the boundary around
// — "Cook 0.25 cup dry brown rice" and "Cook the jasmine rice in a rice cooker"
// both slipped past it, and both dishes declared less carbohydrate for the
// whole plate than their rice alone contains.
//
// So the default inverts to match the data: dry, unless a step actually says
// the grain is already cooked. That is the reading under which the numbers are
// right when they are right, and it fails safe — a dish that really did mean
// cooked rice is rejected as understating itself and regenerated, which costs
// one dish; the other way round costs a user 250 kcal a day they never see.
const ALREADY_COOKED =
  /\b(pre-?cooked|already cooked|cooked (rice|pasta|quinoa|grain|noodles)|leftover (rice|pasta)|day-old rice|from the fridge)\b/i;

export function grainIsMeasuredDry(steps: readonly string[] | null | undefined): boolean {
  if (!steps || steps.length === 0) return true; // no steps to contradict it
  return !ALREADY_COOKED.test(steps.join(" "));
}

/**
 * The least carbohydrate and fat these ingredients can contain.
 *
 * `steps` is how a volume-measured grain earns its place in the floor: see
 * grainIsMeasuredDry. Without steps, only mass units count.
 */
export function macroFloor(
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null }[],
  steps?: readonly string[] | null
): MacroFloor {
  const volumeCountsAsDry = grainIsMeasuredDry(steps);
  let carbs = 0;
  let fat = 0;
  const from: string[] = [];
  for (const ing of ingredients) {
    const density = DENSITY.find((d) => d.match.test(ing.name));
    if (!density) continue;
    if (!isMassUnit(ing.unit) && !density.volumeUnambiguous && !volumeCountsAsDry) continue;
    // A seasoning-sized amount contributes nothing worth arguing about and
    // only clutters the explanation ("…the 78 g in pepper 0.1 teaspoon").
    if (/\b(tsp|teaspoons?|pinch|dash)\b/i.test(ing.unit ?? "") && (ing.quantity ?? 0) <= 1) continue;
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
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null }[],
  steps?: readonly string[] | null
): string | null {
  const floor = macroFloor(ingredients, steps);
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


// ── Pricing a whole dish ────────────────────────────────────────────────────
//
// The floor above grades the model's numbers. This computes them instead, and
// it exists because grading did not scale: three QA cycles running, the model
// declared macros for a COOKED portion beside an amount written as DRY, and
// once the floor covered volume units too it was rejecting 16 of 29 generated
// dishes — refusing most of the catalog to catch a mistake it keeps making.
//
// So when every ingredient that carries macros is one this table knows, the
// dish's nutrition is DERIVED from its own amounts and the model's figures are
// discarded. Clara proposes the food and the method; the arithmetic is ours.
// Where an ingredient is unknown (a sauce, a speciality item), coverage falls
// below the bar and her numbers stand, checked by the floor as before.

export interface PricedDish {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Fraction of macro-bearing grams the table could price. */
  coverage: number;
}

/** Ingredients that carry no meaningful macros, so they never count against coverage. */
const NEGLIGIBLE =
  /\b(salt|pepper|peppercorns?|water|vinegar|spice|seasoning|powder|paprika|cumin|oregano|thyme|basil|rosemary|parsley|cilantro|cinnamon|turmeric|ginger|bay leaf|chili flakes|cayenne|herbs?|stock|broth|lemon juice|lime juice|zest|extract|baking powder|baking soda|mustard|hot sauce|soy sauce)\b/i;

export function priceDish(
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null }[],
  steps?: readonly string[] | null
): PricedDish | null {
  let priced = 0;
  let unpriced = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  const volumeOk = grainIsMeasuredDry(steps);

  for (const ing of ingredients) {
    if (NEGLIGIBLE.test(ing.name)) continue;
    const density = DENSITY.find((d) => d.match.test(ing.name));
    const grams = density ? gramsOf(ing.name, ing.quantity, ing.unit) : null;
    // A volume amount is only usable when the steps show the grain starts dry;
    // otherwise the same number could mean three times the food.
    const usable = grams != null && (isMassUnit(ing.unit) || density?.volumeUnambiguous === true || volumeOk);
    if (!density || !usable) {
      // Weight unknown, so it cannot be weighed against what IS known. Count
      // it as one average portion of unpriced food so coverage reflects it.
      unpriced += 100;
      continue;
    }
    priced += grams;
    protein += (grams * (density.protein ?? 0)) / 100;
    carbs += (grams * density.carbs) / 100;
    fat += (grams * density.fat) / 100;
  }

  const total = priced + unpriced;
  if (total === 0) return null;
  const coverage = priced / total;
  return {
    calories: Math.round(protein * 4 + carbs * 4 + fat * 9),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    coverage,
  };
}

/** Coverage at or above which a dish's own amounts decide its nutrition. */
export const PRICING_COVERAGE_MIN = 0.9;


/** How far a priced dish's declared calories may sit from the arithmetic. */
export const PRICING_TOLERANCE = 0.25;

/**
 * Do the declared numbers disagree with what the amounts price out at?
 *
 * The floor above is one-sided — it catches a dish claiming LESS than its
 * staples contain — and most of what QA found was the other direction: a lunch
 * with no starch declaring 82 g of carbohydrate over ~11 g of vegetables, two
 * oat breakfasts declaring double their oats, a 70 g chicken breast declaring
 * 32 g of protein. Over-declaring is not the gentler error: a diabetic tester
 * dosing insulin off 82 g of carbohydrate in an 11 g dish is the reason this
 * check is two-sided.
 *
 * Only for dishes the table can price in full, and 25% wide, because raw-vs-
 * cooked weights, cuts and absorbed oil all move the true figure a little.
 */
export function macrosDisagreeWithPricing(
  declared: { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null },
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null }[],
  steps?: readonly string[] | null
): string | null {
  const priced = priceDish(ingredients, steps);
  if (!priced || priced.coverage < PRICING_COVERAGE_MIN) return null;

  const kcal = declared.calories ?? 0;
  if (kcal > 0) {
    const off = Math.abs(priced.calories - kcal) / kcal;
    if (off > PRICING_TOLERANCE) {
      return `declared ${Math.round(kcal)} kcal, amounts price at ${priced.calories} kcal (${Math.round(((priced.calories - kcal) / kcal) * 100)}%)`;
    }
  }

  // Per MACRO, not just per calorie. Offsetting errors cancel: a lunch
  // declaring 52 g of protein against 36 g available and 16 g of fat against
  // 26 g came out within 1% on calories, because +16 g of protein (64 kcal)
  // and -10 g of fat (90 kcal) very nearly annul each other. Three dishes in
  // one week did that, and protein is the number this audience watches — the
  // macro rings are the whole reason they are here.
  for (const [label, got, want] of [
    ["protein", declared.protein, priced.protein],
    ["carbs", declared.carbs, priced.carbs],
    ["fat", declared.fat, priced.fat],
  ] as const) {
    if (got == null) continue;
    const gap = Math.abs(got - want);
    // Both a floor in grams and a ratio: 4 g out on 8 g of fat is noise on the
    // plate, 16 g out on 36 g of protein is a third of a meal's worth.
    if (gap <= MACRO_GRAM_SLACK) continue;
    if (want > 0 && gap / want <= PRICING_TOLERANCE) continue;
    return `declared ${Math.round(got)}g ${label}, amounts price at ${want}g`;
  }
  return null;
}

/** Grams of any single macro that are never worth rejecting a dish over. */
const MACRO_GRAM_SLACK = 6;
