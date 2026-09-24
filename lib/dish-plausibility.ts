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
import { macrosContradictAmounts } from "@/lib/staple-density";

export const BREAKFAST_MAX_MINUTES = 30;

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
  macros?: { carbs?: number | null; fat?: number | null } | null;
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
  | "oversalted"
  | "seasoning-quantity-on-food"
  | "title-promises-missing-food"
  | "description-promises-missing-food"
  | "no-quantities"
  | "macros-contradict-amounts"
  | "cooks-without-listing-fat"
  | "step-outlasts-stated-time";

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
const FAT_METHOD =
  /\b(sear|seared|searing|saut[ée]|saut[ée]ed|saut[ée]ing|fry|fried|frying|pan-?fry|brown the|stir-?fry|stir-?fried|grease|coat the pan)\b/i;
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
export function breakfastIsQuickEnough(d: PlausibleDish): boolean {
  if (d.mealTypeName.toLowerCase() !== "breakfast") return true;
  const total = (d.prepMinutes ?? 0) + (d.cookMinutes ?? 0);
  if (total === 0) return true;
  return total <= BREAKFAST_MAX_MINUTES;
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
  // CATEGORY words. A description saying "cheese" over listed feta, or
  // "berries" over listed strawberries, is accurate — the catalog just names
  // the specific thing. Requiring the hypernym itself to be an ingredient
  // rejects the dish for being MORE precise than its own description.
  "cheese", "berry", "nut", "citrus", "fish", "seafood", "poultry", "melon",
  "pasta", "noodle", "legume", "squash", "grain", "meat",
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
export function phrasePromisesMissingFood(
  phrase: string,
  ingredientNames: readonly string[],
  catalogFoodTokens: Set<string>
): string | null {
  const claim = healthClaimNotListed(phrase, ingredientNames);
  if (claim) return claim;

  const have = new Set<string>();
  for (const n of ingredientNames) for (const t of ingredientTokens(n)) have.add(t);
  for (const t of ingredientTokens(phrase)) {
    if (TITLE_NON_FOOD.has(t)) continue;
    if (!catalogFoodTokens.has(t)) continue;
    if (!have.has(t)) return t;
  }
  return null;
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

  // Steps that cook in a fat the dish never lists. This ran at generation
  // only, so the rows written before it existed kept flowing into plans: 4 of
  // 28 dishes in one week told the reader to stir-fry with four ingredients,
  // one of them salt, and no fat at all (QA 2026-09-24). A reader can add oil
  // from the cupboard, but the amount is costed into the calories on the card.
  if (d.steps?.some((step) => FAT_METHOD.test(step)) && !d.ingredients.some((i) => FAT_NAME.test(i.name))) {
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
  if (d.generated && d.macros && macrosContradictAmounts(d.macros, d.ingredients)) {
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
