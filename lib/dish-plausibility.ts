// Is this dish fit to put in front of a person, in this slot?
//
// Written 2026-09-24 after a QA run found the gates in lib/clara/
// recipe-generation.ts were doing nothing for the thing users actually see.
// Those gates run when a dish is CREATED. The plan builder selects from the
// whole public Recipe table, so every dish generated before a gate existed
// flows into a plan with no re-check: 7 of 25 dishes in that week measured the
// user's bell peppers in teaspoons, and 4 of 7 breakfasts were a 40-minute
// roast-dinner plate. The fix is to stop treating validation as a one-time
// admission test and make it a property the builder re-checks at selection.
//
// So this module is the single predicate, shared by both ends:
//   generation — reject before persisting, and ask the model again
//   selection  — skip the row, whenever it was written
//
// It is deliberately storage-shaped rather than model-shaped (names, units,
// minutes) so a Prisma row and a freshly generated recipe both satisfy it.
import { ingredientTokens } from "@/lib/basket-match";
import { BASKET_STAPLES } from "@/lib/basket-coverage";
import { displayDishName } from "@/lib/dish-name";
import { macrosContradictAmounts, macrosDisagreeWithPricing, gramsOf } from "@/lib/staple-density";

export const BREAKFAST_MAX_MINUTES = 30;

/**
 * A snack is grab-and-eat. Two QA weeks running, 7 of 7 snacks were 23-40
 * minute cook-from-raw rice-and-protein plates served at 3pm — the slot is a
 * ~300 kcal top-up, and nobody simmers rice for it. The breakfast ceiling
 * works; this is the same idea for the other slot with a shape.
 *
 * 20 minutes, not the 15 the prompt asks for: the ceiling has to leave the
 * library's honest quick snacks in (35 rows at 20, 23 at 15) while refusing
 * the 40-minute plates. Most of the library's 263 "snack" rows are full meals
 * mislabelled by meal type, so this slot rebuilds from generation, where the
 * prompt now says what a snack is.
 */
export const SNACK_MAX_MINUTES = 20;

/**
 * A snack is also SMALL, which the timing rule cannot express.
 *
 * Twenty minutes was the only thing asked of a snack, and QA measured what got
 * through: 104 of 143 generated snack rows at 250 kcal or more, the worst
 * "Broccoli and Salmon Fried Rice" at 876 — and every offender sits at 17-20
 * minutes, just inside the ceiling. /pantry offered "Turkey and Bell Pepper
 * Stir-Fry with Jasmine Rice — Snack · 516 kcal" as something to make.
 *
 * The plan builder never served those, because it caps a dish at 1.25x its
 * slot's calorie target — so this was invisible in a built week and plainly
 * visible on the screen that lists dishes by their stored meal type. A rule
 * about a dish has to live where the dish does, not only in the builder.
 *
 * 400 kcal is that same arithmetic rather than a new opinion: a snack slot is
 * 15% of a ~2,100 kcal day, and 1.25x of 315 is 394. Costs 15 of 112 usable
 * snacks and refuses every one of the plated dinners.
 */
export const SNACK_MAX_KCAL = 400;

/**
 * Max salt per serving: 1 teaspoon, and half that for a small dish.
 *
 * 1 tsp is ~2,325 mg of sodium — essentially a whole day's guideline. The flat
 * cap let a 396 kcal breakfast of four ingredients carry exactly 1 tsp and
 * pass, which is a day's sodium before 9am for someone who may be managing
 * blood pressure. Scaling by the size of the dish keeps a large shared-style
 * plate workable while refusing that.
 */
export const MAX_SALT_TSP = 1;
export const MAX_SALT_TSP_SMALL_DISH = 0.5;
export const SMALL_DISH_KCAL = 450;

/**
 * What a serving is SEASONED with, as opposed to what is absurd in one.
 *
 * MAX_SALT_TSP above refuses the absurd, and that is all it can do — a ceiling
 * per dish says nothing about a day. Measured on the live catalog 2026-09-25:
 * 983 of 1,040 generated salt rows are above an eighth of a teaspoon, 290 of
 * them at a half. Each is individually legal and three of them are a day: a
 * profile with no conditions at all came out over the 2,300 mg guideline on 6
 * days of 7, once at 3,023 mg, with every dish in the week passing every gate.
 *
 * So the amount is CLAMPED rather than the dish refused — the same disposal as
 * a lying title. Four dishes at these caps come to ~1,740 mg of added salt,
 * which leaves room for the sodium already in the food. It is safe to rewrite
 * because the steps do not repeat the figure: of 151 generated steps that
 * looked like they stated a salt amount, every one sampled was an oil or herb
 * amount standing next to the word "salt" ("toss with 1.5 tbsp olive oil, 1/2
 * tsp dried thyme, salt, and pepper"). The instruction is "season with salt";
 * this decides how much that is.
 *
 * Under-seasoning is the right way to be wrong here. A diner can add salt at
 * the table and cannot take it out, and the app shows them the number either
 * way.
 */
export const SEASONING_SALT_TSP = 0.25;
export const SEASONING_SALT_TSP_SMALL_DISH = 0.125;
const SALT_TSP_PER_GRAM = 1 / 6;

export function addedSaltCapTsp(calories?: number | null): number {
  return calories != null && calories < SMALL_DISH_KCAL ? SEASONING_SALT_TSP_SMALL_DISH : SEASONING_SALT_TSP;
}

/** A salt row's amount in teaspoons, or null when it is not measurable as one. */
export function saltRowTsp(quantity?: number | null, unit?: string | null): number | null {
  if (quantity == null || !(quantity > 0)) return null;
  const u = unit ?? "";
  if (/\b(tsp|teaspoons?)\b/i.test(u)) return quantity;
  if (/\b(tbsp|tablespoons?)\b/i.test(u)) return quantity * 3;
  if (/^\s*(g|gram|grams|gr)\s*$/i.test(u)) return quantity * SALT_TSP_PER_GRAM;
  return null; // a pinch, or an unrecognised unit: too small or too vague to clamp
}

/**
 * Clamp added salt to a seasoning amount, leaving everything else alone.
 * Returns the same array when nothing changed, so callers can cheaply tell.
 */
export function clampAddedSalt<T extends { name: string; quantity?: number | null; unit?: string | null }>(
  ingredients: readonly T[],
  calories?: number | null
): { ingredients: T[]; changed: boolean } {
  const cap = addedSaltCapTsp(calories);
  let changed = false;
  const out = ingredients.map((i) => {
    if (!/\bsalt\b/i.test(i.name)) return i;
    const tsp = saltRowTsp(i.quantity, i.unit);
    if (tsp === null || tsp <= cap) return i;
    changed = true;
    return { ...i, quantity: cap, unit: "teaspoon" };
  });
  return changed ? { ingredients: out, changed } : { ingredients: [...ingredients], changed: false };
}

/**
 * Cooking fat per serving: a tablespoon, or a teaspoon for a small dish.
 *
 * Measured on the live catalog 2026-09-25: added cooking oil is 59% of ALL fat
 * in the generated dishes — 432 of 912 rows above a tablespoon per serving, 112
 * above a tablespoon and a half — and a built week came out at 44-55% of
 * calories from fat. That is the single largest reason the plan misses its own
 * displayed fat target.
 *
 * Unlike salt, this CANNOT simply be clamped, and the reason is the step text.
 * The model writes the amount into the instructions too ("toss with 1.5
 * tablespoons olive oil"), often split across two steps that sum to the row. Of
 * 641 rows whose steps state an amount, 543 AGREE with the row: those recipes
 * genuinely use that much oil, and rewriting the row alone would leave the card
 * contradicting itself. So the clamp below is deliberately narrow, and the rest
 * is handled where it can be: the generation prompt states the budget, so new
 * dishes are written lean and self-consistent from the start.
 */
export const COOKING_FAT_G = 14; // one tablespoon
export const COOKING_FAT_G_SMALL_DISH = 5; // one teaspoon

export function cookingFatCapG(calories?: number | null): number {
  return calories != null && calories < SMALL_DISH_KCAL ? COOKING_FAT_G_SMALL_DISH : COOKING_FAT_G;
}

const FAT_ROW = /\b(oils?|butters?|ghee|margarine|lard|tallow)\b/i;
// "1.5 tablespoons extra virgin olive oil", "2 tbsp butter", "10 g of ghee".
// Unicode fractions and "1/2" count as amounts. They did not, and that turned a
// safety margin into a defect I shipped: a step reading "lightly oil a baking
// dish with ½ tablespoon olive oil" looked SILENT to this pattern, so
// clampCookingFat treated the dish as safe to rewrite and set the row to 0.37
// tablespoon — leaving the card contradicting its own instructions, which is the
// exact harm the clamp was written narrow to avoid. QA found it in two weeks.
const FRACTION_WORDS: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
const FAT_IN_STEP =
  /(\d+(?:\.\d+)?|\d+\s*\/\s*\d+|[½⅓⅔¼¾⅛⅜⅝⅞])\s*(tsp|teaspoons?|tbsp|tablespoons?|g|grams?|ml)\b(?:\s+[\w-]+){0,3}?\s*(oils?|butters?|ghee|margarine)\b/gi;

/** A step's amount as a number, accepting "0.5", "1/2" and "½". */
function amountToNumber(raw: string): number {
  const t = raw.trim();
  if (FRACTION_WORDS[t] != null) return FRACTION_WORDS[t];
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

/**
 * How many grams of cooking fat the STEPS commit to, or null when they name no
 * amount. Null is the permissive answer: it means nothing in the prose will be
 * contradicted by changing the row.
 */
export function fatStatedInSteps(steps?: readonly string[] | null): number | null {
  if (!steps || steps.length === 0) return null;
  let total = 0;
  let found = false;
  for (const s of steps) {
    for (const m of s.matchAll(FAT_IN_STEP)) {
      const q = amountToNumber(m[1]);
      const u = m[2];
      if (!Number.isFinite(q) || q <= 0) continue;
      total += /tsp|teaspoon/i.test(u) ? q * 4.7 : /tbsp|tablespoon/i.test(u) ? q * 14 : /ml/i.test(u) ? q * 0.92 : q;
      found = true;
    }
  }
  return found ? total : null;
}

/**
 * Bring a dish's cooking fat down, but only where doing so contradicts nothing.
 *
 * Two cases, and no others:
 *   - the steps name no amount → clamp to the per-serving budget
 *   - the steps name LESS than the row → clamp to what the steps say, because
 *     the row is over-declared against the recipe's own instructions
 *
 * Where the steps agree with the row, the dish is left exactly as it is. On the
 * live catalog that is 543 of 1,014 rows, and 266 are reachable: 98 that
 * over-declare against their own steps and 168 whose steps are silent, together
 * about 2,200 g of fat.
 *
 * Rows are scaled proportionally rather than rewritten one at a time, so a dish
 * using both oil and butter keeps their ratio, and each row keeps its own unit.
 */
export function clampCookingFat<T extends { name: string; quantity?: number | null; unit?: string | null }>(
  ingredients: readonly T[],
  steps?: readonly string[] | null,
  calories?: number | null
): { ingredients: T[]; changed: boolean } {
  const fats = ingredients.filter((i) => FAT_ROW.test(i.name));
  if (fats.length === 0) return { ingredients: [...ingredients], changed: false };
  let total = 0;
  for (const f of fats) total += gramsOf(f.name, f.quantity, f.unit) ?? 0;
  if (total <= 0) return { ingredients: [...ingredients], changed: false };

  const stated = fatStatedInSteps(steps);
  let target: number;
  if (stated === null) {
    target = Math.min(total, cookingFatCapG(calories));
  } else if (total > stated * 1.1) {
    target = stated; // the row over-declares against the recipe's own steps
  } else {
    return { ingredients: [...ingredients], changed: false }; // the prose agrees; leave it
  }
  // A hair over is not over. Without this margin the clamp never reaches a
  // fixpoint: rounding a scaled quantity to two decimals can leave it a
  // fraction of a gram above the cap, which re-triggers the clamp on the next
  // run, and the backfill reported the same 136 dishes every time it was run
  // (233 g of fat between them — under 2 g each, all of it rounding).
  if (target >= total * 0.98) return { ingredients: [...ingredients], changed: false };

  const factor = target / total;
  return {
    ingredients: ingredients.map((i) =>
      FAT_ROW.test(i.name) && i.quantity != null
        ? { ...i, quantity: measurableAmount(i.quantity * factor, i.unit) }
        : i
    ),
    changed: true,
  };
}

/**
 * The nearest amount a person can actually measure, at or below `raw`.
 *
 * Scaling a quantity by an arbitrary factor produces arbitrary numbers, and QA
 * read them off the rendered card: "0.37 tablespoon" on five dishes, "Cooking
 * oil 1.03 teaspoon", "Extra virgin olive oil 1.1 teaspoon". Nobody owns a
 * 0.37-tablespoon spoon. A clamp that makes the number unusable has traded one
 * defect for another.
 *
 * Spoons round to the eighths a measuring set actually has; grams and millilitres
 * round to whole units. Always DOWN, so the clamp's ceiling still holds.
 */
export function measurableAmount(raw: number, unit?: string | null): number {
  const u = (unit ?? "").trim();
  if (/^\s*(tsp|teaspoons?|tbsp|tablespoons?|cups?)\s*$/i.test(u)) {
    const eighths = Math.floor(raw * 8) / 8;
    // Never round a real amount away to nothing.
    return eighths >= 0.125 ? eighths : 0.125;
  }
  const whole = Math.floor(raw);
  return whole >= 1 ? whole : Math.round(raw * 10) / 10;
}

export interface PlausibleIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  /** Ingredient.groceryCategory when the caller has it. Sharpens rule 3. */
  category?: string | null;
}

export interface PlausibleDish {
  name: string;
  mealTypeName: string;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  ingredients: PlausibleIngredient[];
  /** The dish's own description sentence, when the caller has it. */
  description?: string | null;
  /** The cooking steps, when the caller has them. */
  steps?: readonly string[] | null;
  /** Declared per-serving macros, for the arithmetic in lib/staple-density.ts. */
  macros?: { protein?: number | null; carbs?: number | null; fat?: number | null } | null;
  /** Declared per-serving calories, which scale the salt cap. */
  calories?: number | null;
  /**
   * True for a dish Clara wrote. Gates the title check ONLY — the physical
   * rules (salt, seasoning quantities, breakfast timing) apply to every dish
   * whatever wrote it.
   *
   * Measured on the live library 2026-09-24: the title rule flags 487 of 1759
   * public recipes, and 362 of those are curated rows where the name is not a
   * lie — "Beef & Broccoli" made with sirloin steak, "Scrambled Egg Whites"
   * whose ingredient is "Large eggs", "Hummus & Veggie Sticks", "Caribbean
   * Casserole". Human editors name dishes by cut, cuisine and dish format;
   * Clara names them after what she MEANT to cook and then lists something
   * else, which is the failure this rule was written for. Applying it to the
   * whole catalog would delete a fifth of the library to catch her mistakes.
   */
  generated?: boolean;
}

export type DishProblem =
  | "breakfast-too-slow"
  | "snack-too-slow"
  | "not-breakfast-food"
  | "dinner-protein-at-breakfast"
  | "method-not-used"
  | "oversalted"
  | "seasoning-quantity-on-food"
  | "title-promises-missing-food"
  | "description-promises-missing-food"
  | "no-quantities"
  | "missing-macros"
  | "macros-contradict-amounts"
  | "cooks-without-listing-fat"
  | "step-outlasts-stated-time"
  | "raw-protein-never-cooked"
  | "breakfast-starch-with-savoury-protein"
  | "snack-too-large";

const SEASONING_UNIT = /\b(tsp|teaspoons?|pinch|pinches|dash(es)?)\b/i;
const TABLESPOON = /\b(tbsp|tablespoons?)\b/i;

// Words that mark a name as a jar/bottle item, for which a teaspoon IS the
// natural unit. Measured against the live database on 2026-09-24: the
// name-collision rule below flagged 129 ingredient links, but 54 of them were
// real seasonings whose names happen to contain a staple word — "Crushed red
// pepper flakes", "lemon pepper seasoning blend", "salt free mexican seasoning
// blend", "salt-free citrus seasoning". Every one carries a marker here; the
// actual defect ("Bell peppers — 0.1 teaspoon", 71 links) carries none.
const PANTRY_MARKER =
  /\b(seasoning|blend|flakes?|powder|ground|dried|spice|mix|rub|extract|essence|sauce|paste|vinegar|syrup|juice|zest|oil|salt)\b/i;

// A name IS a staple only when it means the same thing as one — equal token
// sets, the same rule lib/basket-match.ts uses to decide whether a basket entry
// may claim a staple. Subset matching cannot be used here: "pepper" is itself a
// staple, so {bell, pepper} ⊇ {pepper} would classify the user's bell peppers
// as seasoning and wave through the exact defect this module exists to catch.
// "Extra virgin olive oil" still resolves ({olive, oil} both sides) because
// ingredientTokens drops descriptor words.
const isStapleName = (lowered: string): boolean => {
  if (BASKET_STAPLES.has(lowered)) return true;
  const tokens = ingredientTokens(lowered);
  if (tokens.size === 0) return false;
  for (const st of BASKET_STAPLES) {
    const stt = ingredientTokens(st);
    if (stt.size !== tokens.size) continue;
    if ([...stt].every((t) => tokens.has(t))) return true;
  }
  return false;
};

/**
 * Rule 3a — a FOOD measured as if it were the SEASONING its name contains.
 *
 * "Bell peppers 0.5 teaspoon" is the signature of a resolver that read the
 * word "pepper" in "season with salt and pepper" and attributed it to the
 * ingredient the user actually owns. The tell is structural: the ingredient's
 * tokens are a PROPER superset of a staple's ({bell,pepper} ⊃ {pepper}), and
 * it is measured in a seasoning unit. A real bell pepper is 90 g, never 0.1 tsp.
 *
 * lib/basket-match.ts now prevents this at write time; this catches the rows
 * written before it did, and any future resolver that regresses.
 */
function seasoningQuantityOnFood(ing: PlausibleIngredient): boolean {
  const unit = ing.unit ?? "";
  const seasoningSized =
    (SEASONING_UNIT.test(unit) && (ing.quantity ?? 0) <= 1) ||
    (TABLESPOON.test(unit) && (ing.quantity ?? 0) < 1);
  if (!seasoningSized) return false;

  const lowered = ing.name.trim().toLowerCase();
  if (isStapleName(lowered)) return false; // oil, dried herbs, salt: correct at this size
  if (PANTRY_MARKER.test(lowered)) return false; // a jar the staple list does not happen to name

  // What remains is the name-collision case only. A genuine pantry item the
  // staple list does not know ("soy sauce 1 tsp", "honey 0.5 tbsp") is left
  // alone rather than thinning the pool over a guess — and so is the library's
  // legitimate use of small units for chopped produce ("Fresh cilantro 1 tbsp",
  // "Garlic 0.5 tsp", "Yellow onions 0.5 tbsp"), which a category-based rule
  // would have rejected by the hundred.
  const tokens = ingredientTokens(lowered);
  if (tokens.size === 0) return false;
  for (const st of BASKET_STAPLES) {
    const stt = ingredientTokens(st);
    if (stt.size === 0 || stt.size >= tokens.size) continue;
    if ([...stt].every((t) => tokens.has(t))) return true; // proper superset
  }
  return false;
}

// Cooking that needs a fat in the pan, and the fats that satisfy it.
//
// "sauté" is matched without a trailing \b, because \b after a non-ASCII
// letter is never a word boundary — /saut[ée]\b/ is false for "sauté the
// onions" and the `u` flag does not change that. The commonest way a step is
// written was therefore invisible to this check, at generation and at
// selection alike, and a QA sweep found a frittata sautéing in an oil it never
// listed while dishProblem returned null for all 25 dishes in the week.
const FAT_METHOD =
  /(\bsear(ed|ing)?\b|saut[ée]|\bfry\b|\bfried\b|\bfrying\b|pan-?fry|\bbrown the\b|stir-?fr(y|ied)|\bgrease\b|coat the pan)/i;
const FAT_NAME = /\b(oil|butter|ghee|margarine|cooking spray|lard|tallow|bacon fat|drippings?)\b/i;

/**
 * The longest single duration any step claims, in minutes. Ranges take the top
 * of the range ("simmer for 35-40 minutes" → 40) because that is the number a
 * cook has to allow for; hours are converted.
 */
export function longestStepMinutes(steps: readonly string[]): number {
  let longest = 0;
  for (const step of steps) {
    for (const m of step.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi)) {
      const top = Number(m[2] ?? m[1]);
      if (!Number.isFinite(top)) continue;
      const isHours = /^h/i.test(m[3]);
      longest = Math.max(longest, isHours ? top * 60 : top);
    }
  }
  return longest;
}

/**
 * A dish claiming the Breakfast slot has to be a breakfast. The only property
 * checkable deterministically is how long it takes: nobody braises beef for
 * 33 minutes before work. Dishes with no timings are left alone rather than
 * guessed at.
 */
/**
 * The minutes a dish takes, from its fields or — failing those — its own steps.
 *
 * `total === 0 → pass` was a silent bypass of both timing ceilings, and it was
 * not a rare case: 1,083 public rows carry no usable prepTime/cookTime, and 764
 * of them state a time in their steps. "Baked Chicken With Vegetables" with a
 * 20-minute step and null timings passed the 20-minute SNACK ceiling, because
 * the only question asked was of two empty fields.
 *
 * The longest single step, not the sum, for the same reason the
 * step-outlasts-stated-time rule uses it: steps overlap ("while the rice
 * cooks"), so a sum over-states the dish and would refuse honest quick food. One
 * step that alone exceeds the ceiling is proof enough — a lower bound that
 * cannot produce a false refusal.
 */
export function statedOrImpliedMinutes(d: PlausibleDish): number {
  const stated = (d.prepMinutes ?? 0) + (d.cookMinutes ?? 0);
  if (stated > 0) return stated;
  return longestStepMinutes(d.steps ?? []);
}

export function breakfastIsQuickEnough(d: PlausibleDish): boolean {
  if (d.mealTypeName.toLowerCase() !== "breakfast") return true;
  const total = statedOrImpliedMinutes(d);
  if (total === 0) return true; // nothing on file and nothing in the steps
  return total <= BREAKFAST_MAX_MINUTES;
}

/**
 * Does a breakfast contain anything anybody eats at breakfast?
 *
 * The 30-minute ceiling catches a braise and lets "Baked Chicken Breast with
 * Carrots and Jasmine Rice" through at 25 minutes — which QA reported twice,
 * along with "Oatmeal with Carrots and Ground Beef" and a salmon-and-rice bowl
 * at 8am. Timing was never the property that made those wrong.
 *
 * One recognisable breakfast food is enough, and it is a low bar on purpose: a
 * savoury egg hash, beans on toast and a yoghurt bowl all pass, while a plated
 * dinner does not.
 *
 * Generated dishes only, for the same reason the title rule is: a human put the
 * curated library's rows in the breakfast slot deliberately, and 31% of them
 * would fail a keyword test written for Clara's mistakes. The dishes QA caught
 * at 8am — "Baked Chicken Breast with Carrots and Jasmine Rice", "Oatmeal with
 * Carrots and Ground Beef", a salmon-and-rice bowl — were all generated. That
 * leaves 303 anchored breakfasts in the pool, so the slot stays deep either way.
 */
// Explicit plurals, for the same reason as lib/basket-readiness.ts: /\begg\b/
// does not match "Large eggs", so a singular-only list rejected egg dishes as
// "not breakfast food".
const BREAKFAST_FOODS =
  /\b(eggs?|omelettes?|omelets?|frittatas?|oats?|oatmeal|porridge|granola|muesli|yogh?urt|bread|toast|muffins?|bagels?|croissants?|pancakes?|waffles?|crepes?|bananas?|(?:straw|blue|rasp|black|cran)?berr(?:y|ies)|apples?|oranges?|grapefruit|melon|fruit|milk|cheese|cottage|peanut butter|almond butter|honey|jam|smoothies?|beans?|avocados?|bacon|sausages?|hash browns?|potato(es)?)\b/i;

export function breakfastLooksLikeBreakfast(d: PlausibleDish): boolean {
  if (!d.generated) return true;
  if (d.mealTypeName.toLowerCase() !== "breakfast") return true;
  const text = `${displayDishName(d.name)} ${d.ingredients.map((i) => i.name).join(" ")}`;
  return BREAKFAST_FOODS.test(text);
}

// Proteins nobody builds breakfast on, and the ones people do.
//
// The rule above asks whether a breakfast food is PRESENT, and that is not the
// same question as what the dish is built on. "Oatmeal with Ground Beef and
// Spinach" contains oats and passes; it is still a dinner protein at 8am, and
// QA reported that exact shape in three consecutive cycles ("Rolled Oats with
// Ground Beef and Carrots", "Salmon Fillet with Roasted Carrots and Toast",
// "Oatmeal with Chicken and Zucchini") while the letter of the rule was met.
//
// Eggs, yoghurt, cheese, nut butter, bacon and sausage are breakfast proteins,
// so a dish carrying one of those is fine whatever else is in it — this refuses
// only a breakfast whose ONLY protein is a dinner protein. On the live catalog
// that is 28 of 378 usable breakfasts, which the slot can afford.
// "chicken", not "chicken thighs": QA found "Chicken Breast with Carrots and
// Rolled Oats" served at 8am, and the rule let it through because only thighs
// were listed. A chicken breast on porridge is the same dish shape with a
// leaner cut.
const DINNER_PROTEIN =
  /\b(ground beef|beef|steaks?|sirloin|lamb|veal|pork|salmon|tuna|cod|tilapia|halibut|shrimps?|prawns?|chickens?|turkeys?|mince|mackerel|sardines?)\b/i;
const BREAKFAST_PROTEIN =
  /\b(eggs?|yogh?urt|cottage|cheese|bacon|sausages?|milk|peanut butter|almond butter|almonds?|walnuts?|pecans?|tofu|beans?|lentils?|smoked salmon)\b/i;

export function breakfastIsBuiltOnBreakfastFood(d: PlausibleDish): boolean {
  if (!d.generated) return true;
  if (d.mealTypeName.toLowerCase() !== "breakfast") return true;
  const text = `${displayDishName(d.name)} ${d.ingredients.map((i) => i.name).join(" ")}`;
  if (BREAKFAST_PROTEIN.test(text)) return true;
  // No breakfast protein AND a dinner protein: a dinner at 8am.
  if (DINNER_PROTEIN.test(text)) return false;
  // No protein of any kind. QA found a breakfast that was 60 g of oats, one
  // slice of bread and cinnamon, served alongside a second slice of bread — 14 g
  // of protein for the whole meal, and the rule passed it because "a dinner
  // protein is absent" was the only question being asked. A breakfast of nothing
  // but starch is not a meal, and the day's protein target has to come from
  // somewhere.
  return STARCH_ONLY_EXEMPT.test(text) || !isStarchOnly(text);
}

// Starches, and the foods that make a starch into a breakfast.
const STARCH = /\b(oats?|oatmeal|porridge|granola|breads?|toast|muffins?|bagels?|tortillas?|rice|pasta|noodles?|quinoa|potato(es)?|crackers?|buns?)\b/i;
// Fruit and juice do not carry protein, but fruit on porridge is a real
// breakfast and refusing it would leave the slot thinner for no gain.
const STARCH_ONLY_EXEMPT =
  /\b(bananas?|apples?|(?:straw|blue|rasp|black|cran)?berr(?:y|ies)|peach(es)?|oranges?|mangos?|raisins?|honey|jam|maple syrup|smoothies?)\b/i;
const ANY_PROTEIN_FOOD =
  /\b(eggs?|yogh?urt|cottage|cheese|milks?|bacon|sausages?|hams?|nuts?|almonds?|walnuts?|pecans?|peanut butter|almond butter|seeds?|tofu|tempeh|beans?|lentils?|chickpeas?|protein powder|chickens?|turkeys?|beef|salmon|tuna|fish)\b/i;

function isStarchOnly(text: string): boolean {
  return STARCH.test(text) && !ANY_PROTEIN_FOOD.test(text);
}

export function snackIsSmallEnough(d: PlausibleDish): boolean {
  if (d.mealTypeName.toLowerCase() !== "snack") return true;
  if (d.calories == null || d.calories <= 0) return true; // nothing on file to judge
  return d.calories <= SNACK_MAX_KCAL;
}

export function snackIsQuickEnough(d: PlausibleDish): boolean {
  if (d.mealTypeName.toLowerCase() !== "snack") return true;
  const total = statedOrImpliedMinutes(d);
  if (total === 0) return true; // nothing on file and nothing in the steps
  return total <= SNACK_MAX_MINUTES;
}

/**
 * The food words a dish name may only use when the dish contains them.
 *
 * Built from the HEAD NOUN of each catalog name, not every token. Feeding in
 * every token poisons the vocabulary with the adjectives inside multi-word
 * ingredient names — "Creamy peanut butter" contributes "creamy", "Red bell
 * peppers" contributes "red", "Mixed greens" contributes "mixed", "Sweet
 * potatoes" contributes "sweet" — and those words then have to be "contained"
 * in the dish. Measured against 400 real generated dishes on 2026-09-24: the
 * every-token vocabulary flagged 45% of them, almost all for prose like
 * "savory-sweet skillet" or "roasted red bell pepper" where the dish was
 * exactly what it said. Head nouns keep every real catch — "lemon" from
 * "Lemons", "almond" from "Almonds", "cinnamon" — and drop the adjectives.
 */
export function catalogFoodVocabulary(ingredientNames: Iterable<string>): Set<string> {
  const vocab = new Set<string>();
  for (const name of ingredientNames) {
    const tokens = ingredientTokens(name);
    if (tokens.size === 0) continue;
    if (tokens.size === 1) {
      for (const t of tokens) vocab.add(t);
      continue;
    }
    let head: string | null = null;
    for (const t of tokens) head = t; // insertion order: the last word
    if (head) vocab.add(head);
  }
  return vocab;
}

/** Words describing how a dish is made or served, not what is in it. */
export const TITLE_NON_FOOD = new Set([
  // Preparations MADE from the listed ingredients rather than bought. A
  // "lemon-cilantro dressing" over listed oil, lemon and cilantro is a
  // description of technique, not a missing shopping item.
  "sauce", "dressing", "glaze", "marinade", "drizzle", "dip", "broth", "stock",
  "puree", "mash", "crumble", "topping", "mixture", "batter", "dough", "filling",
  // FORMS of an ingredient that is listed. "Crisp carrot and celery sticks",
  // "finished with lemon juice" over a listed lemon — the knife does not add a
  // shopping item. Each of these was a false rejection of a correct dish.
  "juice", "zest", "peel", "slice", "stick", "strip", "wedge", "cube", "chunk",
  "spear", "ribbon", "round", "crumb", "meal", "green", "sliver", "shred",
  // CATEGORY words are handled separately, in CATEGORY_MEMBERS below — a name
  // saying "cheese" over listed feta is accurate, but a name saying "cheese"
  // over no cheese at all is not, and exempting the word outright allowed the
  // second. They are NOT listed here.
  // connectors
  "with", "and", "on", "in", "over", "of", "a", "an", "the", "plus", "topped", "served", "side",
  // methods
  "grilled", "roasted", "baked", "braised", "poached", "seared", "pan", "fried", "fry",
  "stir", "stirfry", "sauteed", "sautéed", "steamed", "boiled", "toasted", "toast",
  "scrambled", "scramble", "simmered", "glazed", "marinated", "crusted", "rubbed",
  "seasoned", "smashed", "mashed", "shredded", "crumbled", "crispy", "crisp",
  // formats
  "bowl", "salad", "hash", "skillet", "patty", "patties", "meatball", "meatballs",
  "stew", "soup", "wrap", "taco", "tacos", "plate", "mix", "medley", "casserole",
  "bake", "burger", "sandwich", "stirfried", "saute", "omelette", "omelet", "porridge",
  // generic nouns and flourish
  "vegetable", "vegetables", "veggie", "veggies", "protein", "herb", "herbs",
  "seasoning", "seasonings", "spice", "spices", "greens", "style", "homemade",
  "classic", "simple", "easy", "quick", "hearty", "warm", "tender", "golden",
  "savory", "savoury", "light", "fresh", "breakfast", "lunch", "dinner", "snack",
]);

/**
 * Does this phrase promise food the dish does not contain? Returns the
 * offending word, or null.
 *
 * Vocabulary-driven rather than word-listed: a token only has to be satisfied
 * when the ingredient CATALOG knows it as food. "Oatmeal", "Taco Bowl" and
 * "Skillet" are ignored; "lemon", "cinnamon" and "brown" (from brown rice)
 * must appear in the dish. Only what the dish LISTS satisfies the promise —
 * staples are free to use, but a name is a claim about the recipe.
 */
/**
 * A category word, and the foods that satisfy it.
 *
 * These used to sit in TITLE_NON_FOOD, exempt outright, for a good reason: a
 * name saying "cheese" over listed feta is accurate, and requiring the hypernym
 * itself to be an ingredient rejects a dish for being MORE precise than its own
 * title.
 *
 * But exempting the word entirely allowed the opposite. QA found "Cheese and
 * Bell Pepper Oat Bowl" whose ingredients are oats, bell pepper, tomato, oil,
 * salt and pepper — no cheese of any kind — with step 6 reading "top with the
 * diced bell pepper, tomato, and crumbled cheese". The declared 245 kcal
 * excludes the cheese, so the numbers describe a dish the title and the steps do
 * not. Naming a whole category the dish has no member of is the same lie as
 * naming a specific food it lacks.
 *
 * So the word is satisfied by ANY member, and refused when there is none.
 */
// `word` is written out rather than derived, and `token` is what
// ingredientTokens reduces the category to.
//
// Deriving the title pattern as `\b${word}s?\b` was wrong twice over, and QA
// caught both within hours of it shipping:
//   - `\bberrys?\b` cannot match "berries", so "Oatmeal with Berries and
//     Cinnamon" — no berry of any kind — passed the very check written for it.
//     The plural trap, for the sixth time in this file.
//   - and because the word was no longer exempt, the token loop below then
//     refused "Oatmeal with Berries" over listed BLUEBERRIES, whose token is
//     "blueberry", not "berry" — rejecting a dish for being more precise than
//     its own title, the exact regression the old exemption existed to prevent.
//
// So the category check is the sole authority on these words: it decides, and
// the token loop skips them entirely rather than getting a second vote.
const CATEGORY_MEMBERS: { word: RegExp; token: string; members: RegExp }[] = [
  { word: /\bcheeses?\b/i, token: "cheese", members: /\b(cheeses?|cheddar|parmesan|feta|mozzarella|ricotta|cottage|halloumi|gouda|brie|goat|paneer|queso)\b/i },
  { word: /\bberr(y|ies)\b/i, token: "berry", members: /\b(berr(y|ies)|strawberr(y|ies)|blueberr(y|ies)|raspberr(y|ies)|blackberr(y|ies)|cranberr(y|ies))\b/i },
  { word: /\bnuts?\b/i, token: "nut", members: /\b(nuts?|almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|peanuts?|macadamias?)\b/i },
  { word: /\bcitrus\b/i, token: "citrus", members: /\b(lemons?|limes?|oranges?|grapefruits?|citrus|clementines?|mandarins?)\b/i },
  { word: /\bfish\b/i, token: "fish", members: /\b(fish|salmon|tuna|cod|tilapia|halibut|haddock|catfish|trout|sardines?|mackerel|anchov(y|ies)|pollock|sole)\b/i },
  { word: /\bseafood\b/i, token: "seafood", members: /\b(fish|salmon|tuna|cod|shrimps?|prawns?|scallops?|mussels?|clams?|crab|lobster|squid|calamari|seafood)\b/i },
  { word: /\bpoultry\b/i, token: "poultry", members: /\b(chickens?|turkeys?|ducks?|poultry)\b/i },
  { word: /\bmelons?\b/i, token: "melon", members: /\b(melons?|watermelons?|cantaloupes?|honeydew)\b/i },
  { word: /\bpastas?\b/i, token: "pasta", members: /\b(pasta|spaghetti|macaroni|penne|orzo|fusilli|rigatoni|linguine|tagliatelle|noodles?|couscous)\b/i },
  { word: /\bnoodles?\b/i, token: "noodle", members: /\b(noodles?|pasta|spaghetti|ramen|udon|soba|vermicelli)\b/i },
  { word: /\blegumes?\b/i, token: "legume", members: /\b(beans?|lentils?|chickpeas?|garbanzos?|peas?|legumes?|edamame)\b/i },
  { word: /\bsquash(es)?\b/i, token: "squash", members: /\b(squash(es)?|zucchini|courgettes?|pumpkins?|butternut|marrow)\b/i },
  { word: /\bgrains?\b/i, token: "grain", members: /\b(grains?|rice|quinoa|oats?|barley|bulgur|farro|millet|wheat|couscous)\b/i },
  { word: /\bmeats?\b/i, token: "meat", members: /\b(meats?|beef|pork|lamb|veal|chickens?|turkeys?|steaks?|mince|bacon|sausages?|hams?)\b/i },
];
/** The tokens the category check owns; the token loop must not re-judge them. */
const CATEGORY_TOKENS = new Set(CATEGORY_MEMBERS.map((c) => c.token));

/** A category the phrase names that the dish has no member of, or null. */
export function categoryWithNoMember(
  phrase: string,
  ingredientNames: readonly string[]
): string | null {
  const said = displayDishName(phrase);
  const listed = ingredientNames.join(" | ");
  for (const { word, token, members } of CATEGORY_MEMBERS) {
    if (!word.test(said)) continue;
    if (members.test(listed)) continue;
    return token;
  }
  return null;
}

export function phrasePromisesMissingFood(
  phrase: string,
  ingredientNames: readonly string[],
  catalogFoodTokens: Set<string>
): string | null {
  const claim = healthClaimNotListed(phrase, ingredientNames);
  if (claim) return claim;
  const category = categoryWithNoMember(phrase, ingredientNames);
  if (category) return category;

  const have = new Set<string>();
  for (const n of ingredientNames) for (const t of ingredientTokens(n)) have.add(t);
  for (const t of ingredientTokens(phrase)) {
    if (TITLE_NON_FOOD.has(t)) continue;
    // A category word was already adjudicated above, against every food that
    // could satisfy it. Letting the token rule vote again refuses "Berries" over
    // listed Blueberries, because their tokens differ.
    if (CATEGORY_TOKENS.has(t)) continue;
    if (!catalogFoodTokens.has(t)) continue;
    if (!have.has(t)) return t;
  }
  return null;
}

// Seasonings, fats and aromatics a dish is never NAMED after. A dish named
// after its salt is not named.
//
// Matched on head nouns rather than as a substring, for the same reason
// isStapleName above refuses subset matching: `/\bpeppers?\b/` excludes "Bell
// peppers", and a bell pepper is a vegetable that happens to have "pepper" in
// its name. That conflation is the original sin this whole module was written
// to catch, and it reappeared here the moment the rule was written as a regex
// over the raw name (caught by the test, 2026-09-25).
const SEASONING_HEAD = new Set([
  "salt", "pepper", "peppercorn", "water", "oil", "butter", "ghee", "margarine",
  "vinegar", "spice", "seasoning", "stock", "broth", "powder", "flake", "zest", "extract",
  "cilantro", "coriander", "basil", "parsley", "oregano", "thyme", "rosemary", "sage",
  "dill", "chive", "mint", "paprika", "cumin", "cinnamon", "nutmeg", "clove", "turmeric",
]);
// Words that say which VARIETY of a thing, not which thing: "black
// peppercorns" and "sea salt" are still seasonings, "bell peppers" are not.
const VARIETY_WORD =
  /^(black|white|red|green|pink|yellow|sea|kosher|table|coarse|fine|whole|cracked|dried|fresh|raw|light|dark|extra|virgin|ground|chopped|minced|sliced|grated|toasted|roasted|unsalted|salted)$/;

// Deliberately WITHOUT "pepper": a bell pepper's head noun is "pepper", so
// putting it here excludes a vegetable (caught by the test, 2026-09-25).
// Peppercorns need no entry — the substantive-token rule below strips "black"
// as a variety word and is left with a pure seasoning.
const HEAD_IS_NEVER_THE_DISH = new Set([
  "oil", "vinegar", "salt", "broth", "stock", "seasoning",
  "powder", "extract", "essence", "zest", "syrup", "water",
]);

function notAHeadline(name: string): boolean {
  const tokens = [...ingredientTokens(name)];
  if (tokens.length === 0) return true;
  // Some head nouns are never the dish, however the variety is qualified: an
  // oil is a cooking medium whatever it is pressed from, and "Apple cider
  // vinegar" is a dressing, not an apple dish. Judged on the HEAD noun so the
  // qualifier cannot smuggle it back in — the substantive-token rule below
  // passed "Avocados with Arugula and Apple Cider Vinegar" because "apple" and
  // "cider" are foods (observed on the live catalog, 2026-09-25).
  //
  // Butter is deliberately absent: "Almond butter" is a food a dish is named
  // after, plain butter is not, and the rule below separates them on its own
  // ({almond,butter} keeps a substantive token, {butter} does not).
  const head = tokens[tokens.length - 1];
  if (HEAD_IS_NEVER_THE_DISH.has(head)) return true;
  const substantive = tokens.filter((t) => !VARIETY_WORD.test(t));
  return substantive.length > 0 && substantive.every((t) => SEASONING_HEAD.has(t));
}

// What a reader calls the dish. Two tiers, because "Greek Yogurt Veggie
// Omelette" is an egg dish and cheese is a topping on most dishes that carry it.
const HEADLINE_ANCHOR =
  /\b(chicken|turkey|beef|pork|lamb|veal|salmon|tuna|cod|tilapia|halibut|sardines?|mackerel|shrimps?|prawns?|fish|eggs?|tofu|tempeh|seitan|lentils?|chickpeas?|garbanzos?|beans?)\b/i;
const HEADLINE_DAIRY = /\b(yogh?urt|cheese|feta|paneer|cottage|ricotta|mozzarella|parmesan)\b/i;

const NAME_CONNECTORS = new Set(["with", "and", "of", "in", "on", "the", "a", "an"]);
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && NAME_CONNECTORS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ");
}

/**
 * A name built from the dish's own ingredients, in the library's convention:
 * "Chicken Breast with Brown Rice and Broccoli".
 *
 * The counterpart to phrasePromisesMissingFood. That predicate answers "does
 * this name lie?", and for a long time the only available response was to throw
 * the dish away — 8 of 16 rejections in a measured generation batch, and 134
 * rows already in the catalog stranded for the same reason, 22 of them in the
 * snack slot that a QA week then filled with one dish four times.
 *
 * So the answer is a truthful name instead. Built from the ingredient list in
 * its own order (both the model and the catalog put the main ingredients
 * first), then RE-CHECKED by the same predicate rather than assumed clean, and
 * refused rather than forced when no honest name can be made. `taken` holds
 * names already in use, and a longer name is the way out of a collision.
 */
export function truthfulDishName(
  ingredientNames: readonly string[],
  catalogFoodTokens: Set<string>,
  taken: Set<string> = new Set(),
  /**
   * A word describing the FORM of the dish — "Bowl", "Hash", "Salad", "Skillet"
   * — used only to break a collision when every ingredient-shaped name is
   * already taken. It must be a word TITLE_NON_FOOD already treats as making no
   * food claim, so appending it cannot reintroduce the lie being repaired.
   *
   * Without this, 53 dishes stayed out of the pool not because no honest name
   * existed but because another dish had already been given it: with a
   * 15-ingredient basket, many dishes really are "Large Eggs with Sliced Bread
   * and Spinach", and only the first could have the name.
   */
  formWord?: string | null
): string | null {
  const heads = ingredientNames.map((n) => n.trim()).filter((n) => n && !notAHeadline(n));
  if (heads.length === 0) return null;
  // The dish's namesake leads. Taking the list in its stored order renamed
  // "Greek Yogurt Veggie Omelette" to "Spinach with Feta Cheese and Plain Greek
  // Yogurt" and lost the eggs — a stored RecipeIngredient list has no
  // importance order, only insertion order. So the anchor comes first: the meat,
  // fish, egg, tofu or legume a reader would call the dish, then the dairy
  // proteins, then everything else, each group keeping its original order. This
  // is the library's own naming convention ("Chicken Breast with Broccoli and
  // Brown Rice"), and it is a heuristic about EMPHASIS only — every name it
  // produces is still checked against the ingredient list before it is used.
  const rank = (n: string) => (HEADLINE_ANCHOR.test(n) ? 0 : HEADLINE_DAIRY.test(n) ? 1 : 2);
  heads.sort((a, b) => rank(a) - rank(b)); // stable in V8: ties keep list order
  // The fullest honest name first, then shorter ones.
  for (const n of [3, 4, 2, 1].filter((n) => n <= heads.length)) {
    const parts = heads.slice(0, n);
    const rest = parts.slice(1);
    const tail =
      rest.length <= 1 ? rest.join("") : `${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`;
    const name = titleCase(rest.length === 0 ? parts[0] : `${parts[0]} with ${tail}`);
    if (phrasePromisesMissingFood(name, ingredientNames, catalogFoodTokens)) continue;
    if (!taken.has(name.trim().toLowerCase())) return name;
    // Taken. Before giving up on this shape, try it with the dish's own form
    // word — honest by construction, since TITLE_NON_FOOD holds these exact
    // words precisely because they promise no ingredient.
    const form = (formWord ?? "").trim();
    if (form && TITLE_NON_FOOD.has(form.toLowerCase())) {
      const withForm = `${name} ${form.charAt(0).toUpperCase() + form.slice(1).toLowerCase()}`;
      if (
        !phrasePromisesMissingFood(withForm, ingredientNames, catalogFoodTokens) &&
        !taken.has(withForm.trim().toLowerCase())
      ) {
        return withForm;
      }
    }
  }
  return null;
}

/**
 * The word in a name that describes the dish's FORM rather than its food.
 * Used only to break a name collision; see truthfulDishName's formWord.
 */
export function formWordOf(name: string): string | null {
  for (const w of displayDishName(name).split(/[\s,]+/)) {
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    if (!lower) continue;
    if (FORM_WORDS.has(lower)) return lower;
  }
  return null;
}

// A subset of TITLE_NON_FOOD: the words that name a dish's shape, as opposed to
// a cooking method or a flourish. "Bowl" distinguishes two dishes; "Simple" does
// not.
const FORM_WORDS = new Set([
  "bowl", "salad", "hash", "skillet", "patty", "patties", "meatball", "meatballs",
  "stew", "soup", "wrap", "taco", "tacos", "plate", "medley", "casserole",
  "bake", "burger", "sandwich", "omelette", "omelet", "porridge", "scramble",
  "frittata", "toast", "parfait", "smoothie", "stirfry", "skewers",
]);

/** Countable foods whose bare count IS the measurement (see staple-density). */
const COUNTABLE = /\b(eggs?|bread|toast|muffin|bagel|tortilla|pita|apples?|bananas?|oranges?|pears?|potato(es)?|tomato(es)?|peppers?|onions?|carrots?|avocados?|lemons?|limes?)\b/i;

/** The word for one of something, when a recipe gives a bare count. */
export function countUnitFor(name: string): string | null {
  if (/\bbread\b/i.test(name)) return "slice";
  if (/\b(muffin|bagel|tortilla|pita|wrap)\b/i.test(name)) return "whole";
  if (/\beggs?\b/i.test(name)) return "egg";
  if (/\b(apples?|bananas?|oranges?|pears?|potato(es)?|tomato(es)?|peppers?|onions?|avocados?|lemons?|limes?|carrots?)\b/i.test(name)) return "whole";
  return null;
}

export function unitIsUsable(name: string, unit: string | null | undefined): boolean {
  const u = (unit ?? "").trim();
  if (u.length > 0) return true;
  return COUNTABLE.test(name);
}

// Claims a reader acts on that the token rule structurally cannot see.
// ingredientTokens treats "whole" and "grain" as descriptors — deliberately,
// so a basket holding "bread" still matches "whole grain bread" — which means
// "toasted whole-grain bread" made with plain sliced bread passes the token
// check. These are substance, not description: someone managing fibre, gluten
// or sodium buys differently because of them, so they are matched as phrases
// against the raw ingredient names instead.
const HEALTH_CLAIMS = [
  "whole grain", "wholegrain", "whole wheat", "wholewheat", "whole-grain", "whole-wheat",
  "gluten free", "gluten-free", "low fat", "low-fat", "fat free", "fat-free",
  "sugar free", "sugar-free", "low sodium", "low-sodium", "salt free", "salt-free",
  "brown rice", "wild rice", "greek yogurt", "dark chocolate",
];
const loosen = (s: string) => s.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");

export function healthClaimNotListed(phrase: string, ingredientNames: readonly string[]): string | null {
  const said = loosen(phrase);
  const listed = ingredientNames.map(loosen).join(" | ");
  for (const claim of new Set(HEALTH_CLAIMS.map(loosen))) {
    if (said.includes(claim) && !listed.includes(claim)) return claim;
  }
  // "…with Herbs" and "finished with fresh herbs" over a dish whose only
  // seasonings are salt and pepper. "herbs" is in TITLE_NON_FOOD because no
  // SPECIFIC herb should be demanded by a generic word — but the generic word
  // still promises that some herb exists, and three dishes in one QA week
  // promised it with none at all. Satisfied by any herb, named or dried.
  if (/\bherb|\bherbs\b/.test(said) && !HERB_NAMES.some((h) => listed.includes(h))) return "herbs";
  return null;
}

/**
 * Dishes named after a preparation that REQUIRES something.
 *
 * The title rule checks that every food word in a name is present, which says
 * nothing about a name that is a technique: "Ground Beef Bolognese" served over
 * jasmine rice with no tomato, onion, carrot or celery passed cleanly, as did
 * "Cauliflower and Carrot Curry" with no spice of any kind. A person ordering
 * a bolognese is promised a tomato ragù, and the word is the promise.
 *
 * Each entry lists alternatives — any one satisfies the name.
 */
const DISH_REQUIRES: { dish: RegExp; needs: RegExp; label: string }[] = [
  // EVERY `needs` pattern takes a plural. They did not, and the consequence was
  // the opposite of the rule's purpose: /\b(egg)\b/ does not match the
  // catalog's "Large eggs", so "Egg Scramble with Carrots and Broccoli" — a dish
  // made of eggs, named for its eggs — was refused for having no egg, along with
  // 80 others. The same hole sat in `tomato` against "Roma tomatoes",
  // `chickpea` against "chickpeas", `avocado` against "Avocados", `bean`
  // against "Black beans" and `mushroom` against "Mushrooms".
  //
  // That is the FIFTH time in this project that a singular-only pattern has
  // silently not matched the catalog's own spelling (\begg\b vs "eggs",
  // \bberries\b vs "strawberries", \bpeppers?\b vs "Bell peppers",
  // \bcucumber\b vs "Cucumbers"), and the first time it was caught BEFORE
  // shipping — by a repair step offering to strip "Scramble" from 81 dishes
  // whose names were perfectly honest. lib/staple-density.test.ts holds the
  // regression net for the other half of this class.
  { dish: /\b(bolognese|ragu|ragù|marinara|arrabbiata)\b/i, needs: /\b(tomato(es)?|passata|marinara|tomato sauce|tomato paste)\b/i, label: "tomato" },
  { dish: /\b(curry|curried|masala|tikka|korma|vindaloo)\b/i, needs: /\b(curry|masala|turmeric|cumin|coriander|garam|paprika|chili powder|cayenne|ginger)\b/i, label: "curry spice" },
  { dish: /\b(pesto)\b/i, needs: /\b(basil|pesto)\b/i, label: "basil" },
  // "Oatmeal with Poached Chicken Breast and Carrots" — described as oatmeal,
  // steps say "add the oats", made of brown rice. Three of seven breakfasts in
  // one week. The token rule could not see it: the catalog's head noun is
  // "oat" and the title word is "oatmeal", so the promise was invisible.
  { dish: /\boatmeal\b/i, needs: /\boats?\b|\boatmeal\b/i, label: "oats" },
  { dish: /\b(risotto)\b/i, needs: /\brice\b/i, label: "rice" },
  { dish: /\b(polenta)\b/i, needs: /\b(polenta|cornmeal)\b/i, label: "cornmeal" },
  // Tofu and chickpea scrambles are real dishes, so the egg rules accept the
  // thing being scrambled rather than only eggs.
  { dish: /\b(scramble|scrambled|omelette|omelet|frittata|shakshuka)\b/i, needs: /\b(eggs?|tofu|chickpea flour|besan)\b/i, label: "egg" },
  { dish: /\b(hummus)\b/i, needs: /\b(chickpeas?|garbanzos?|tahini|hummus)\b/i, label: "chickpeas" },
  { dish: /\b(guacamole)\b/i, needs: /\b(avocados?)\b/i, label: "avocado" },
  { dish: /\b(carbonara)\b/i, needs: /\b(eggs?)\b/i, label: "egg" },
  { dish: /\b(chili|chilli)\s*(con carne)?\b/i, needs: /\b(beans?|chili|chilli|cayenne|paprika|cumin)\b/i, label: "chilli or beans" },
  { dish: /\b(caesar)\b/i, needs: /\b(parmesan|anchov(y|ies)|caesar)\b/i, label: "parmesan" },
  { dish: /\b(teriyaki)\b/i, needs: /\b(soy|teriyaki|mirin)\b/i, label: "soy" },
  { dish: /\b(stroganoff)\b/i, needs: /\b(sour cream|cream|yogh?urt|mushrooms?)\b/i, label: "cream or mushroom" },
];

/**
 * A cooking METHOD in the name that the steps do not use.
 *
 * Five dishes in one week were titled "Grilled …" and pan-seared in a skillet,
 * three of them with a description that said "pan-seared" directly under the
 * title. Nothing in the week was grilled. The name is how a person decides
 * whether they have the pan, the pit or the patience for it.
 */
const METHOD_REQUIRES: { method: RegExp; needs: RegExp; label: string }[] = [
  { method: /\bgrilled\b/i, needs: /\b(grill|griddle|barbecue|bbq|broil)\b/i, label: "grilled" },
  { method: /\b(baked|roasted)\b/i, needs: /\b(oven|bake|baking|roast|broil|air fryer)\b/i, label: "baked or roasted" },
  { method: /\bpoached\b/i, needs: /\b(poach|simmer|barely bubbling|water)\b/i, label: "poached" },
  { method: /\bsteamed\b/i, needs: /\b(steam|steamer|basket)\b/i, label: "steamed" },
  { method: /\bair-?fried\b/i, needs: /\bair fryer\b/i, label: "air-fried" },
];

export function methodNotUsed(name: string, steps: readonly string[] | null | undefined): string | null {
  if (!steps || steps.length === 0) return null;
  const text = steps.join(" ");
  for (const rule of METHOD_REQUIRES) {
    if (rule.method.test(name) && !rule.needs.test(text)) return rule.label;
  }
  return null;
}

/**
 * A protein that has to be cooked, in a dish whose steps never cook it.
 *
 * QA found "Oats with Salmon and Broccoli" in a live plan: 70 g of raw salmon
 * fillet, eight steps, and the only one touching the fish reads "pat the salmon
 * fillet dry and flake it into bite-sized pieces with a fork". The oats are
 * simmered and the broccoli steamed; the salmon is served raw, and the card
 * declares a 12-minute cook time so nothing on screen warns anybody. Nothing in
 * this module caught it, because every rule here was about whether a dish was
 * PLAUSIBLE, and none was about whether it was safe to eat.
 *
 * Deliberately narrow, because a false refusal here is cheap and a false pass is
 * not:
 *   - only the proteins that genuinely must be cooked. Smoked salmon, canned
 *     tuna, cured ham, sushi-grade fish and every plant protein are exempt, as
 *     are eggs (raw yolk in a dressing is a normal recipe).
 *   - satisfied by ANY heat word anywhere in the steps near that protein, or by
 *     a heat word in a step that does not name another food. Recipes say "add
 *     the fish and simmer 6 minutes" as often as "cook the salmon", so the rule
 *     asks whether heat is applied at all in a step that mentions it.
 *   - generated dishes only. A curated recipe's steps were written by a person.
 */
const MUST_BE_COOKED =
  /\b(chicken|turkey|duck|pork|bacon|sausages?|lamb|veal|beef|steaks?|mince|salmon|tuna|cod|tilapia|halibut|haddock|catfish|trout|pollock|shrimps?|prawns?|scallops?|mussels?|clams?|fish)\b/i;
// Forms that arrive already cooked, cured or safe to eat as they are.
const ALREADY_SAFE =
  /\b(smoked|cured|canned|tinned|cooked|pre-?cooked|deli|jerky|deli-sliced|deli meat|prosciutto|salami|pepperoni|deli turkey|rotisserie|leftover|sushi|sashimi|ceviche)\b/i;
const HEAT_WORD =
  /\b(cook|cooks|cooked|cooking|sear|sears|seared|searing|fry|fries|fried|frying|saut[ée]|saut[ée]s|saut[ée]ed|grill|grills|grilled|grilling|roast|roasts|roasted|roasting|bake|bakes|baked|baking|broil|broils|broiled|boil|boils|boiled|boiling|simmer|simmers|simmered|simmering|poach|poaches|poached|poaching|steam|steams|steamed|steaming|braise|braises|braised|braising|brown|browns|browned|browning|heat|heats|heated|heating|air fryer|oven|skillet|pan|until opaque|until cooked through|internal temperature)\b/i;

/**
 * Does any heat reach this protein after it first appears?
 *
 * Three heuristics were tried and measured against the live catalog before this
 * one, and the first two would have done real harm:
 *
 *   1. "a heat word somewhere in a step that names the protein" passed the very
 *      dish that prompted the rule — "Top the oats with the steamed broccoli and
 *      flaked salmon" has a heat word and the salmon, and the heat is the
 *      broccoli's.
 *   2. "a heat word NEAREST to the protein" fixed that and flagged 38 dishes, of
 *      which the first three inspected were all wrong: a salmon seared in step 6,
 *      a chicken baked in step 7, and beef cooked as "meatballs" in step 4. Two
 *      failed because the cooking step does not repeat the noun, and one because
 *      the word "pepper" sat between the salmon and its verb.
 *
 * What actually separates the raw dish from those three is ORDER. A recipe
 * introduces an ingredient and then cooks it, in that step or a later one; the
 * raw dish introduces the salmon in step 4 and every remaining step is assembly.
 * So: find where the protein first appears, and ask whether any heat happens
 * from there on. It cannot tell which food the heat is for, and deliberately does
 * not try — a dish that heats something after adding raw fish is given the
 * benefit of the doubt, because a false refusal costs the pool a real dish and
 * this rule exists for the unambiguous case.
 */
// "the steamed broccoli" is a DESCRIPTION of food already cooked; "Steam the
// broccoli" is an instruction to cook it. Only the second means heat is being
// applied here. Told apart by the determiner in front: an imperative opens a
// clause, an adjective follows "the", "with", "of" or "and".
//
// This is the difference between catching the dish that started this rule and
// not: its last steps read "Top the oats with the steamed broccoli and flaked
// salmon", and read naively that sentence applies heat to the salmon.
// The heat word must be followed by a FOOD to be an adjective. Requiring only a
// determiner in front was not enough: "Add ground turkey and cook for 5 minutes"
// has "and" before "cook", and stripping it read a properly cooked turkey hash as
// raw. "and cook FOR" is an instruction; "with the steamed BROCCOLI" is not.
const HEAT_FOOD =
  /\b(chicken|turkey|pork|bacon|lamb|beef|steaks?|salmon|tuna|cod|shrimps?|prawns?|fish|eggs?|tofu|rice|pasta|spaghetti|noodles?|quinoa|oats?|lentils?|beans?|chickpeas?|potato(es)?|broccoli|cauliflower|zucchini|spinach|carrots?|peppers?|tomato(es)?|onions?|celery|mushrooms?|kale|asparagus|cabbages?|vegetables?|veg|greens?|bread|toast)\b/;
const HEAT_AS_ADJECTIVE = new RegExp(
  `\\b(?:the|with|of|and|plus|some)\\s+(?:${HEAT_WORD.source.slice(2, -2)})\\s+(?:${HEAT_FOOD.source.slice(2, -2)})`,
  "gi"
);

function appliesHeat(step: string): boolean {
  return HEAT_WORD.test(step.replace(HEAT_AS_ADJECTIVE, " "));
}

function heatReachesProtein(steps: readonly string[], head: string): boolean {
  const named = new RegExp(`\\b${head}\\b`, "i");
  const first = steps.findIndex((s) => named.test(s));
  if (first < 0) return false;
  return steps.slice(first).some(appliesHeat);
}

/**
 * Oats and a dinner protein, in any slot.
 *
 * "Oatmeal with Carrots and Ground Beef" was reported by QA in three
 * consecutive cycles as a breakfast, so cycle 13 moved it — and QA's next pass
 * found it filed as a 373 kcal LUNCH, where no rule could see it, along with 26
 * others across Lunch, Dinner and Snack. That is a fair criticism: relabelling
 * repairs a dish whose SLOT was wrong, and this dish's slot was never the
 * problem. Nobody wants ground beef in their porridge at any hour.
 *
 * So the shape is refused everywhere rather than shuffled between slots. Oats,
 * porridge, granola and muesli are breakfast starches; beef, pork, lamb, chicken
 * and fish are not things you put in them. 27 dishes of 1,461.
 *
 * Eggs, bacon and sausage are NOT in the savoury list — a full breakfast is a
 * real dish — and neither are nuts, seeds, yoghurt or fruit.
 */
const BREAKFAST_STARCH = /\b(oats?|oatmeal|porridge|granola|muesli)\b/i;
const SAVOURY_PROTEIN =
  /\b(ground beef|beef|steaks?|sirloin|lamb|veal|pork|salmon|tuna|cod|tilapia|halibut|shrimps?|prawns?|chickens?|turkeys?|mince)\b/i;

export function breakfastStarchWithSavouryProtein(d: PlausibleDish): boolean {
  if (!d.generated) return false;
  const listed = d.ingredients.map((i) => i.name).join(" | ");
  return BREAKFAST_STARCH.test(listed) && SAVOURY_PROTEIN.test(listed);
}

export function rawProteinNeverCooked(d: PlausibleDish): boolean {
  if (!d.generated) return false;
  const steps = d.steps ?? [];
  if (steps.length === 0) return false;
  for (const ing of d.ingredients) {
    if (!MUST_BE_COOKED.test(ing.name)) continue;
    if (ALREADY_SAFE.test(ing.name)) continue;
    // Which token of this ingredient the steps would name — "Salmon fillets"
    // is referred to as "the salmon".
    const head = ing.name.match(MUST_BE_COOKED)?.[0] ?? "";
    if (!head) continue;
    const named = new RegExp(`\\b${head}\\b`, "i");
    if (!steps.some((s) => named.test(s))) return true; // never mentioned, let alone cooked
    if (!heatReachesProtein(steps, head)) return true;
  }
  return false;
}

/**
 * The name with a method it does not use taken out, or null if that is not
 * possible.
 *
 * 48 dishes are named for a technique their own steps never perform — "Grilled
 * Salmon" that is pan-seared, "Baked Chicken" with no oven. Selection refuses
 * them, which is right: the name is a claim, and a reader choosing the dish
 * because it is grilled has been told something untrue.
 *
 * But refusing is not the only answer available, any more than it was for a
 * title promising absent food. The dish is fine; one adjective is wrong, so the
 * adjective goes. "Grilled Salmon with Broccoli" becomes "Salmon with Broccoli"
 * — which is what the recipe actually is.
 *
 * Re-checked by the predicate that condemned it, and refused rather than forced:
 * a name that is nothing BUT the method ("Grilled") has nothing left once the
 * method is removed.
 */
export function nameWithoutFalseMethod(
  name: string,
  steps: readonly string[] | null | undefined
): string | null {
  if (!steps || steps.length === 0) return null;
  const text = steps.join(" ");
  let out = name;
  for (const rule of METHOD_REQUIRES) {
    if (!rule.method.test(out)) continue;
    if (rule.needs.test(text)) continue; // the steps do it; the name is honest
    out = out.replace(new RegExp(rule.method.source, "gi"), " ");
  }
  if (out === name) return null;
  // Tidy what removing a word leaves behind: doubled spaces, a dangling
  // connector, a leading comma.
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,\-–]+/, "")
    .replace(/[\s,\-–]+$/, "")
    .replace(/^(with|and|in|on)\s+/i, "")
    .replace(/\s+(with|and|in|on)$/i, "")
    .trim();
  if (out.length < 3) return null;
  if (methodNotUsed(out, steps)) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * The name with a STYLE the dish cannot deliver taken out, or null.
 *
 * The twin of nameWithoutFalseMethod, for the other half of the same drop code:
 * "title-promises-missing-food" is returned both by the token rule (a name
 * promising absent food) and by dishStyleMissingIngredient (an "Oatmeal" made of
 * rice, a "curry" with no spices, a "scramble" with no egg). The rename step
 * repaired only the first half for a while, and reported nothing repairable
 * while selection was dropping 53 dishes — the two halves share a code and did
 * not share a fix.
 *
 * A style word is a claim like any other, so it goes the same way. Refused where
 * nothing honest remains.
 */
export function nameWithoutFalseStyle(
  name: string,
  ingredientNames: readonly string[]
): string | null {
  const listed = ingredientNames.join(" | ");
  let out = name;
  for (const rule of DISH_REQUIRES) {
    if (!rule.dish.test(out)) continue;
    if (rule.needs.test(listed)) continue; // the dish has what the style needs
    out = out.replace(new RegExp(rule.dish.source, "gi"), " ");
  }
  if (out === name) return null;
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,\-–]+/, "")
    .replace(/[\s,\-–]+$/, "")
    .replace(/^(with|and|in|on|of)\s+/i, "")
    .replace(/\s+(with|and|in|on|of)$/i, "")
    .trim();
  if (out.length < 3) return null;
  if (dishStyleMissingIngredient(out, ingredientNames)) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The dish-defining ingredient a name promises but the dish lacks, or null. */
export function dishStyleMissingIngredient(name: string, ingredientNames: readonly string[]): string | null {
  const listed = ingredientNames.join(" | ");
  for (const rule of DISH_REQUIRES) {
    if (rule.dish.test(name) && !rule.needs.test(listed)) return rule.label;
  }
  return null;
}

// Enough to tell "seasoned with herbs" from "salt and pepper only".
const HERB_NAMES = [
  "basil", "oregano", "thyme", "rosemary", "parsley", "cilantro", "coriander",
  "dill", "sage", "tarragon", "chive", "mint", "marjoram", "bay leaf",
  "italian seasoning", "herbes de provence", "za'atar", "herb",
];

/**
 * The one predicate. Returns the first problem found, or null when the dish is
 * fit to serve in this slot.
 *
 * `catalogFoodTokens` empty → the title check is skipped rather than passing
 * everything: without the catalog's vocabulary there is no way to tell a food
 * word from a cooking word, and guessing rejects good dishes.
 */
export function dishProblem(d: PlausibleDish, catalogFoodTokens: Set<string>): DishProblem | null {
  if (!breakfastIsQuickEnough(d)) return "breakfast-too-slow";
  if (!snackIsQuickEnough(d)) return "snack-too-slow";
  if (!snackIsSmallEnough(d)) return "snack-too-large";
  if (!breakfastLooksLikeBreakfast(d)) return "not-breakfast-food";
  if (!breakfastIsBuiltOnBreakfastFood(d)) return "dinner-protein-at-breakfast";
  if (rawProteinNeverCooked(d)) return "raw-protein-never-cooked";
  if (breakfastStarchWithSavouryProtein(d)) return "breakfast-starch-with-savoury-protein";

  for (const ing of d.ingredients) {
    if (/\bsalt\b/i.test(ing.name)) {
      const q = ing.quantity ?? 0;
      const cap = d.calories != null && d.calories < SMALL_DISH_KCAL ? MAX_SALT_TSP_SMALL_DISH : MAX_SALT_TSP;
      if (SEASONING_UNIT.test(ing.unit ?? "") && q > cap) return "oversalted";
      if (TABLESPOON.test(ing.unit ?? "") && q >= 1) return "oversalted";
    }
    if (seasoningQuantityOnFood(ing)) return "seasoning-quantity-on-food";
  }

  // A dish nobody can shop from. 177 stored dishes have not one quantity on
  // any ingredient row — one reached a real week as "Large eggs / Sliced bread
  // / Bell peppers" with no numbers at all, while its own steps said "crack 3
  // large eggs" (QA 2026-09-24). The amounts also feed the grocery list, so
  // the dish is unusable rather than merely untidy. A single missing row (an
  // unmeasured splash of water) is fine; none at all is not a recipe.
  if (d.ingredients.length > 0 && d.ingredients.every((i) => i.quantity == null)) return "no-quantities";

  // A dish with a missing macro cannot be shown honestly: it lands in a day's
  // ring as a zero and silently lowers the total. QA found both ends of that —
  // a card reading "102 kcal" with no protein figure, and a day's protein ring
  // short by the egg it did not count. 298 such rows were fillable from their
  // own amounts (scripts/repair-generated-dishes.ts); these are the rest.
  if (d.macros && (d.macros.protein == null || d.macros.carbs == null || d.macros.fat == null)) {
    return "missing-macros";
  }

  // Steps that cook in a fat the dish never lists. This ran at generation
  // only, so the rows written before it existed kept flowing into plans: 4 of
  // 28 dishes in one week told the reader to stir-fry with four ingredients,
  // one of them salt, and no fat at all (QA 2026-09-24). A reader can add oil
  // from the cupboard, but the amount is costed into the calories on the card.
  if (
    d.steps?.some((step) => FAT_METHOD.test(step) || FAT_NAME.test(step)) &&
    !d.ingredients.some((i) => FAT_NAME.test(i.name))
  ) {
    // FAT_NAME against the STEP text too: "Heat a non-stick oven-safe skillet
    // over medium heat with a light spray of cooking oil" names the fat
    // outright while the method regex alone saw nothing to catch.
    return "cooks-without-listing-fat";
  }

  // A step that takes longer than the whole dish claims to. "Cook brown rice
  // according to package directions (about 45 minutes total)" under tiles
  // reading "Prep 10m / Cook 25m" — four dishes in one week, including one
  // Clara swapped in. The tiles are what a person plans their evening around.
  const stated = (d.prepMinutes ?? 0) + (d.cookMinutes ?? 0);
  if (stated > 0 && d.steps) {
    const longest = longestStepMinutes(d.steps);
    if (longest > stated) return "step-outlasts-stated-time";
  }

  // Can the stated amounts even contain the stated macros? See
  // lib/staple-density.ts — generated dishes only, because the rule leans on
  // the amounts being written to a dry basis and the curated library's macro
  // columns are measured data we should not argue with.
  if (d.generated && d.macros && macrosContradictAmounts(d.macros, d.ingredients, d.steps)) {
    return "macros-contradict-amounts";
  }
  // And the other direction, for a dish the table can price in full.
  if (
    d.generated &&
    macrosDisagreeWithPricing(
      { calories: d.calories, protein: d.macros?.protein, carbs: d.macros?.carbs, fat: d.macros?.fat },
      d.ingredients,
      d.steps
    )
  ) {
    return "macros-contradict-amounts";
  }

  if (d.generated && catalogFoodTokens.size > 0) {
    const names = d.ingredients.map((i) => i.name);
    // displayDishName first: library rows carry portion-variant suffixes
    // ("…, V1M- 2 medium potatoes") that put "2" and "medium" into the title's
    // vocabulary and reject the dish over its own id.
    if (phrasePromisesMissingFood(displayDishName(d.name), names, catalogFoodTokens)) {
      return "title-promises-missing-food";
    }
    if (dishStyleMissingIngredient(displayDishName(d.name), names)) {
      return "title-promises-missing-food";
    }
    if (methodNotUsed(displayDishName(d.name), d.steps)) return "method-not-used";
    // The description is held to the same promise at SELECTION too, not only
    // at generation. Keeping it generation-only was a deliberate call that a
    // QA run then disproved: "…on whole grain toast" over plain sliced bread
    // reached a user from a row written before the gate existed, and a lying
    // sentence under an honest title is still the app lying.
    if (d.description && phrasePromisesMissingFood(d.description, names, catalogFoodTokens)) {
      return "description-promises-missing-food";
    }
  }
  return null;
}
