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
  /**
   * Milligrams of sodium per 100 g, as bought. Optional: absent means "not
   * enough to matter", which is true of every fresh vegetable, fruit, grain and
   * unprocessed meat at the amounts a recipe uses.
   *
   * Added because the meal plan's sodium rail counted ADDED SALT and compared
   * it to 2,300 mg — the FDA guideline for TOTAL dietary sodium. QA priced a
   * day at 3,303 mg of real sodium while the rail printed "2,034/2,300mg" in
   * green, and Clara repeated the reassurance. The numerator and the
   * denominator were measuring different things.
   *
   * Only the foods that carry enough to move a day are listed: bread, cheese,
   * cured and canned goods, dairy, eggs, and the condiments. A tomato at 5 mg
   * per 100 g cannot change a verdict and is not worth a wrong number.
   */
  sodium?: number;
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
  /**
   * Grams in one of the thing, for rows written as a bare count.
   *
   * "Sliced bread 2" and "Large eggs 2" carry a quantity and no unit, and
   * gramsOf returned null for them — so the row counted as unpriced food,
   * coverage fell under the bar, and the dish kept the model's numbers with no
   * upper bound at all. QA measured the correlation as total: in one fresh
   * week every one of the 18 dishes with no unitless row was exact on all four
   * macros, and every one of the 11 dishes with one was wrong — three by more
   * than 25%, the worst declaring 432 kcal and 24 g of fat over food that is
   * 615 kcal and 42 g, including 243 kcal of poured olive oil.
   *
   * The escapes were never ingredient-shaped, they were unit-shaped: oil in
   * tablespoons first, bare counts second.
   */
  gramsPerItem?: number;
}[] = [
  // Grains and pasta, dry. ~75 g carbs/100 g is true of every rice, and of
  // pasta, couscous and most flours within a few grams.
  { match: /\b(rice)\b/i, carbs: 78, fat: 1, protein: 7, gramsPerCup: 185 },
  { match: /\b(pasta|spaghetti|macaroni|penne|noodle|couscous|orzo)\b/i, carbs: 75, fat: 2, protein: 13, gramsPerCup: 100 },
  { match: /\b(oats?|oatmeal)\b/i, carbs: 66, fat: 7, protein: 13, gramsPerCup: 90 },
  { match: /\b(quinoa|bulgur|farro|barley|millet)\b/i, carbs: 70, fat: 6, protein: 13, gramsPerCup: 170 },
  { match: /\b(flour|cornmeal|breadcrumbs?)\b/i, carbs: 76, fat: 1, protein: 10, gramsPerCup: 120 },
  { match: /\b(lentils?|chickpeas?|black beans?|kidney beans?|white beans?)\b/i, carbs: 60, fat: 2, protein: 24, gramsPerCup: 190 , sodium: 240},
  { match: /\b(sugar|honey|maple syrup)\b/i, carbs: 95, fat: 0, protein: 0, gramsPerCup: 200 , volumeUnambiguous: true },
  // Fats. Oil is the one ingredient that is essentially 100% fat.
  { match: /\b(oil)\b/i, carbs: 0, fat: 100, protein: 0, gramsPerCup: 218 , volumeUnambiguous: true },
  { match: /\b(butter|ghee)\b/i, carbs: 0, fat: 81, protein: 1, gramsPerCup: 227 , volumeUnambiguous: true },
  // Proteins, raw. Enough to tell 16 g of protein from a claimed 32 g.
  { match: /\b(chicken breasts?|turkey breast)\b/i, carbs: 0, fat: 3, protein: 23, gramsPerCup: 140 , sodium: 60},
  { match: /\b(chicken thighs?)\b/i, carbs: 0, fat: 11, protein: 19, gramsPerCup: 140 , sodium: 75},
  { match: /\b(ground beef|beef|steak|sirloin)\b/i, carbs: 0, fat: 15, protein: 20, gramsPerCup: 225 },
  { match: /\b(ground turkey|ground chicken)\b/i, carbs: 0, fat: 8, protein: 19, gramsPerCup: 225 , sodium: 70},
  { match: /\b(ground pork|pork|bacon|ham)\b/i, carbs: 0, fat: 14, protein: 20, gramsPerCup: 225 , sodium: 700},
  { match: /\b(salmon)\b/i, carbs: 0, fat: 13, protein: 20, gramsPerCup: 150 , sodium: 60},
  { match: /\b(tuna|cod|tilapia|haddock|catfish|trout|sole|pollock|white fish)\b/i, carbs: 0, fat: 2, protein: 22, gramsPerCup: 150 , sodium: 200},
  { match: /\b(shrimp|prawns?)\b/i, carbs: 1, fat: 1, protein: 20, gramsPerCup: 145 , sodium: 300},
  { match: /\b(eggs?)\b/i, carbs: 1, fat: 10, protein: 13, gramsPerCup: 243, gramsPerItem: 50 , sodium: 142},
  { match: /\b(tofu|tempeh)\b/i, carbs: 4, fat: 8, protein: 17, gramsPerCup: 250 },
  // Bread and dairy.
  { match: /\b(bread|toast)\b/i, carbs: 49, fat: 3, protein: 9, gramsPerCup: 120, gramsPerItem: 30 , sodium: 490},
  { match: /\b(muffin|bagel|tortilla|pita)\b/i, carbs: 49, fat: 3, protein: 9, gramsPerCup: 120, gramsPerItem: 60 , sodium: 480},
  { match: /\b(greek yogurt)\b/i, carbs: 4, fat: 4, protein: 9, gramsPerCup: 245 , volumeUnambiguous: true , sodium: 36},
  { match: /\b(yogurt|milk)\b/i, carbs: 5, fat: 3, protein: 3, gramsPerCup: 245 , volumeUnambiguous: true , sodium: 45},
  { match: /\b(cheddar|parmesan|feta|mozzarella|cheese)\b/i, carbs: 2, fat: 28, protein: 24, gramsPerCup: 110 , sodium: 700},
  { match: /\b(almonds?|walnuts?|peanuts?|cashews?|pecans?|pistachios?|hazelnuts?|macadamias?|nuts)\b/i, carbs: 22, fat: 50, protein: 21, gramsPerCup: 140 },
  { match: /\b(peanut butter|almond butter)\b/i, carbs: 20, fat: 50, protein: 25, gramsPerCup: 258 },
  { match: /\b(avocados?)\b/i, carbs: 9, fat: 15, protein: 2, gramsPerCup: 150 },
  // Vegetables and fruit, as a group: little of anything, but not nothing.
  // "bell peppers", not "peppers?": a bare "pepper" is the seasoning, and
  // matching it here put "pepper 0.1 teaspoon" into the floor as a vegetable.
  // volumeUnambiguous: a cup of chopped vegetables weighs about a cup of
  // chopped vegetables however it is later cooked, and tying veg rows to the
  // dry-GRAIN test meant one bad step phrase took a whole dish out of pricing.
  // Three groups, not one. QA priced the cards by hand against real composition
  // and found the single flat row (6 g carbs, 2 g protein, 0 g fat per 100 g,
  // 120 g per cup) wrong in both directions and by a lot:
  //   "Sliced Tomatoes with Olive Oil" declared 3 g of protein over 150 g of
  //   Roma tomato, which holds 1.4 — a 122% overstatement;
  //   "Zucchini with Roma Tomatoes and Carrots" declared 7 g of protein over
  //   370 g of vegetables that hold 3.9;
  //   "Roasted Broccoli with Olive Oil" declared 109 kcal against a real 127.
  // And 120 g/cup is badly wrong for leaves: "Spinach 2 cup" priced as 240 g
  // when two cups of raw spinach is about 60 g, which alone put a breakfast at
  // a declared 305 kcal against food worth 252.
  //
  // At the day level the error was small — vegetables are a minority of intake —
  // but it inflated one day's declared protein by ~9 g of protein that does not
  // exist, and the protein ring is a number people act on.
  //
  // Leaves: a cup is 30 g, and they carry real protein for their weight.
  { match: /\b(spinach|kale|arugula|rocket|romaine|lettuce|chard|watercress|radicchio|endive|bok choy|collards?|greens?|herbs?|basil leaves)\b/i, carbs: 4, fat: 0.4, protein: 3, gramsPerCup: 30, gramsPerItem: 100, volumeUnambiguous: true },
  // Watery vegetables and fruit-vegetables: a cup is ~120 g, ~1 g protein.
  { match: /\b(tomato(es)?|cucumbers?|zucchini|courgettes?|celery|mushrooms?|cabbages?|asparagus|green beans?|eggplants?|aubergines?|radish(es)?|bean sprouts?|sauerkraut|okra)\b/i, carbs: 4, fat: 0.2, protein: 1.2, gramsPerCup: 120, gramsPerItem: 110, volumeUnambiguous: true },
  // Brassicas carry real protein for a vegetable — broccoli is 2.8 g/100 g.
  { match: /\b(broccoli|cauliflower|brussels sprouts?|cabbages?|broccolini|kohlrabi)\b/i, carbs: 6, fat: 0.3, protein: 2.6, gramsPerCup: 100, gramsPerItem: 110, volumeUnambiguous: true },
  // Roots, alliums and peppers: more carbohydrate, about a gram of protein.
  // Grouped apart from the brassicas because averaging broccoli (2.8 g protein,
  // 7 g carbs) with carrots (0.9 and 9.6) lands on neither of them.
  { match: /\b(carrots?|bell peppers?|green peppers?|red peppers?|yellow peppers?|jalape(n|ñ)o peppers?|chipotle peppers?|poblano peppers?|onions?|beets?|turnips?|parsnips?|squash|pumpkins?|artichokes?|fennel|leeks|rutabagas?)\b/i, carbs: 8, fat: 0.2, protein: 1.1, gramsPerCup: 120, gramsPerItem: 110, volumeUnambiguous: true },
  { match: /\b(potato(es)?|sweet potato(es)?|corn|peas)\b/i, carbs: 18, fat: 0, protein: 2, gramsPerCup: 150, gramsPerItem: 170 },
  { match: /\b(apples?|bananas?|berries|strawberries|blueberries|oranges?|grapes?|pears?|melon)\b/i, carbs: 13, fat: 0, protein: 1, gramsPerCup: 150, gramsPerItem: 130 },

  // ── The long tail that was keeping 301 dishes out of the pool ──────────────
  //
  // Every one of those rows has amounts on every ingredient and still could not
  // be priced, because ONE ingredient was unknown to this table and coverage
  // fell under the bar. Measured 2026-09-25, the unknown names in order: Kosher
  // salt (118 rows), Black peppercorns (82), tap water (69), Garlic (59), Lemons
  // (51), fresh basil/cilantro/parsley (108 between them), romaine lettuce,
  // Cornstarch, balsamic vinegar, soy sauce, Dijon mustard, broth, mayonnaise,
  // flaxseed.
  //
  // A correction to my own first reading of that list, because it matters for
  // anyone extending this table: the seasoning half of it was NOT what refused
  // those dishes. priceDish already skips salt, pepper, water, garlic, lemons,
  // vinegar, broth and herbs through NEGLIGIBLE below, so they never counted
  // against coverage. My diagnostic called gramsOf directly and missed that.
  //
  // What actually recovered 126 of the 301 rows was the rest: the vegetables
  // this table had never heard of (romaine, arugula, cabbage, asparagus,
  // eggplant, squash), the foods that genuinely carry calories (mayonnaise at
  // 75% fat, cornstarch at 91% carbs, garbanzos, flaxseed), and above all the
  // garnish UNITS further down — leaves, sprig, stalk, spear, pinch.
  //
  // The seasoning entries stay because gramsOf is called by more than priceDish
  // (clampCookingFat weighs oil rows through it) and an answer of null there is
  // indistinguishable from "no amount given". They are belt over suspenders,
  // not the fix.
  //
  // These go LAST so the specific entries above always win: "peanut butter"
  // must not be caught by the butter entry, and a row is priced by the first
  // pattern that matches it.
  { match: /\b(salts?)\b/i, carbs: 0, fat: 0, protein: 0, gramsPerCup: 273, volumeUnambiguous: true },
  // Only the seasoning. "green peppers" and "Jalapeño peppers" are vegetables
  // and are caught by the entry above; a bare "pepper" is the grinder. Writing
  // this as /\bpeppers?\b/ priced 110 g of green pepper as 70 g of
  // carbohydrate — the same food/seasoning conflation that produced "Bell
  // peppers 0.1 teaspoon", arriving from the opposite direction.
  { match: /\b(peppercorns?|black pepper|white pepper|ground pepper|red pepper flakes?|crushed red pepper|cayenne)\b|^\s*pepper\s*$/i, carbs: 64, fat: 3, protein: 10, gramsPerCup: 110, volumeUnambiguous: true },
  { match: /\b(water)\b/i, carbs: 0, fat: 0, protein: 0, gramsPerCup: 237, volumeUnambiguous: true },
  { match: /\b(broths?|stocks?|bouillon)\b/i, carbs: 1, fat: 0, protein: 1, gramsPerCup: 240, volumeUnambiguous: true , sodium: 300},
  // Dried herbs and ground spices, as a group. Calorie-dense per 100 g and
  // never used by the 100 g — a teaspoon of cinnamon is 6 kcal.
  { match: /\b(basil|cilantro|coriander|parsley|thyme|oregano|rosemary|sage|dill|chives?|mint|tarragon|paprika|cumin|cinnamon|nutmeg|turmeric|ginger|cloves?|cardamom|curry powder|chil(i|li|e)s?|cayenne|bay lea(f|ves)|seasoning|spice)\b/i, carbs: 50, fat: 8, protein: 12, gramsPerCup: 50, volumeUnambiguous: true },
  { match: /\b(garlic|shallots?|scallions?|spring onions?|leeks?|fennel|ginger root)\b/i, carbs: 20, fat: 0, protein: 5, gramsPerCup: 136, gramsPerItem: 5, volumeUnambiguous: true },
  { match: /\b(lemons?|limes?|lemon juice|lime juice)\b/i, carbs: 9, fat: 0, protein: 1, gramsPerCup: 244, gramsPerItem: 85, volumeUnambiguous: true },
  { match: /\b(vinegars?)\b/i, carbs: 5, fat: 0, protein: 0, gramsPerCup: 239, volumeUnambiguous: true },
  { match: /\b(soy sauce|tamari|fish sauce|worcestershire)\b/i, carbs: 5, fat: 0, protein: 8, gramsPerCup: 255, volumeUnambiguous: true , sodium: 5500},
  { match: /\b(mustard|hot sauce|sriracha|salsa|tomato paste|tomato sauce|passata)\b/i, carbs: 10, fat: 2, protein: 3, gramsPerCup: 250, volumeUnambiguous: true , sodium: 1100},
  { match: /\b(mayonnaise|mayo|aioli)\b/i, carbs: 1, fat: 75, protein: 1, gramsPerCup: 220, volumeUnambiguous: true , sodium: 630},
  { match: /\b(cornstarch|corn starch|cornflour|arrowroot)\b/i, carbs: 91, fat: 0, protein: 0, gramsPerCup: 128, volumeUnambiguous: true },
  { match: /\b(flaxseeds?|chia seeds?|sesame seeds?|sunflower seeds?|pumpkin seeds?|seeds?)\b/i, carbs: 29, fat: 42, protein: 18, gramsPerCup: 150, volumeUnambiguous: true },
  { match: /\b(garbanzos?|hummus)\b/i, carbs: 27, fat: 9, protein: 8, gramsPerCup: 240 , sodium: 320},
  { match: /\b(arugula|rocket|romaine|chard|watercress|radicchio|endive|bok choy|brussels sprouts?|eggplants?|aubergines?|squash|beets?|radish(es)?|turnips?|parsnips?|artichokes?|okra|leeks)\b/i, carbs: 6, fat: 0, protein: 2, gramsPerCup: 120, gramsPerItem: 110, volumeUnambiguous: true },

  // ── The last 60 foods the table could not weigh ────────────────────────────
  //
  // Found by asking, for every ingredient a public recipe actually uses, whether
  // gramsOf can answer — rather than one dish at a time. 62 could not be
  // weighed. Two of those were PLURAL TRAPS fixed above ("Cucumbers" on 74 rows
  // and "Avocados" on 13, against patterns written /\bcucumber\b/ and
  // /\bavocado\b/): the fourth instance in this session of a singular-only
  // pattern silently not matching the catalog's own spelling, after \begg\b
  // against "eggs", \bberries\b against "strawberries", and \bpeppers?\b
  // catching "Bell peppers". Every pattern here takes s? deliberately.
  //
  // The rest are the long tail of real foods: fruit the table had never listed,
  // the cream and sour cream, the sweeteners, coffee and tea, and the
  // gluten-free products. Textbook values per 100 g as bought.
  { match: /\b(sour cream|cr[eè]me fra[iî]che)\b/i, carbs: 4, fat: 20, protein: 2, gramsPerCup: 230, volumeUnambiguous: true , sodium: 80},
  { match: /\b(heavy cream|double cream|whipping cream|half.and.half)\b/i, carbs: 3, fat: 37, protein: 2, gramsPerCup: 238, volumeUnambiguous: true },
  { match: /\b(soymilks?|soy milk|oat milk|almond milk|coconut milk|rice milk)\b/i, carbs: 2, fat: 2, protein: 2, gramsPerCup: 243, volumeUnambiguous: true },
  { match: /\b(coffees?|espresso|teas?|teabags?|herbal tea)\b/i, carbs: 0, fat: 0, protein: 0, gramsPerCup: 237, volumeUnambiguous: true },
  { match: /\b(stevias?|monkfruit|monk fruit|erythritol|sucralose|aspartame|sweeteners?)\b/i, carbs: 0, fat: 0, protein: 0, gramsPerCup: 200, volumeUnambiguous: true },
  { match: /\b(cocoa powder|cacao powder|unsweetened cocoa)\b/i, carbs: 58, fat: 14, protein: 20, gramsPerCup: 86, volumeUnambiguous: true },
  { match: /\b(raisins?|sultanas?|prunes?|dates?|dried apricots?|dried cranberries|dried fruit)\b/i, carbs: 75, fat: 1, protein: 3, gramsPerCup: 165, volumeUnambiguous: true },
  { match: /\b(peach(es)?|nectarines?|apricots?|plums?|mangos?|mangoes|pineapples?|kiwis?|kiwifruit|cherr(y|ies)|papayas?|guavas?|figs?)\b/i, carbs: 13, fat: 0, protein: 1, gramsPerCup: 165, gramsPerItem: 140 },
  { match: /\b(olives?|capers?)\b/i, carbs: 6, fat: 11, protein: 1, gramsPerCup: 135, volumeUnambiguous: true , sodium: 1550},
  { match: /\b(lima beans?|edamame|butter beans?|fava beans?|split peas?|pinto beans?|cannellini)\b/i, carbs: 20, fat: 1, protein: 8, gramsPerCup: 170 },
  { match: /\b(granola|muesli)\b/i, carbs: 64, fat: 15, protein: 10, gramsPerCup: 120 , sodium: 60},
  { match: /\b(coconut flakes?|shredded coconut|desiccated coconut)\b/i, carbs: 24, fat: 65, protein: 7, gramsPerCup: 80, volumeUnambiguous: true },
  // Split by SIZE, not by shelf: a cracker is ~12 g and a bun is ~60 g, and
  // listing them together priced a gluten-free bun as a cracker.
  { match: /\b(crackers?|crispbreads?|rice cakes?)\b/i, carbs: 70, fat: 10, protein: 8, gramsPerCup: 120, gramsPerItem: 12 , sodium: 600},
  { match: /\b(buns?|rolls?|flour tortillas?|wraps?|naan|baguettes?)\b/i, carbs: 52, fat: 4, protein: 9, gramsPerCup: 120, gramsPerItem: 60 , sodium: 490},
  { match: /\b(cooking wine|white wine|red wine|sherry|mirin|rice wine)\b/i, carbs: 3, fat: 0, protein: 0, gramsPerCup: 235, volumeUnambiguous: true },
  { match: /\b(cream of \w+ soup|condensed soup|canned soup)\b/i, carbs: 9, fat: 6, protein: 3, gramsPerCup: 245, volumeUnambiguous: true , sodium: 700},
  { match: /\b(clam juice|tomato juice|vegetable juice)\b/i, carbs: 4, fat: 0, protein: 1, gramsPerCup: 240, volumeUnambiguous: true },
  { match: /\b(baking powder|baking soda|bicarbonate|cream of tartar|yeast)\b/i, carbs: 28, fat: 0, protein: 0, gramsPerCup: 220, volumeUnambiguous: true },
  { match: /\b(meatless \w+|plant.based \w+|vegan \w+|seitan|quorn)\b/i, carbs: 5, fat: 5, protein: 20, gramsPerCup: 140 },
];

const GRAMS_PER_UNIT: { match: RegExp; grams: number | "cup" }[] = [
  { match: /^\s*(g|gram|grams|gr)\s*$/i, grams: 1 },
  { match: /^\s*(kg|kilogram|kilograms)\s*$/i, grams: 1000 },
  // Volume in millilitres, treated as grams: water is 1.00 g/ml and oil 0.92,
  // so the error at the amounts recipes use is under a gram. Missing entirely
  // until cycle 7, which made "olive oil 8 ml" an unpriceable row.
  { match: /^\s*(ml|millilitre|millilitres|milliliter|milliliters|cc)\s*$/i, grams: 1 },
  { match: /^\s*(l|litre|litres|liter|liters)\s*$/i, grams: 1000 },
  { match: /^\s*(oz|ounce|ounces)\s*$/i, grams: 28.35 },
  // "Garlic 2 clove" priced as null and took the whole dish out of pricing.
  // A flat weight rather than a per-food one: a clove is a clove.
  // (slice / whole / each need no entry — COUNT_UNIT below handles them from
  // the food's own gramsPerItem, and does so before this table is consulted.)
  { match: /^\s*(clove|cloves)\s*$/i, grams: 3 },
  // The garnish units, measured as the most common unpriceable units in the
  // catalog after cup/tbsp/tsp: leaves (62 rows), whole (30), sprig (24), stalk
  // (23), pinch (22), spear (10). Every one is a small, near-zero-calorie amount
  // whose absence was refusing a whole dish — the same unit-shaped escape as
  // bare counts and millilitres before it. Flat weights, because a basil leaf
  // weighs what a basil leaf weighs whatever dish it lands in.
  { match: /^\s*(leaf|leaves)\s*$/i, grams: 0.5 },
  { match: /^\s*(sprig|sprigs)\s*$/i, grams: 1 },
  { match: /^\s*(stalk|stalks|rib|ribs)\s*$/i, grams: 40 },
  { match: /^\s*(spear|spears)\s*$/i, grams: 15 },
  { match: /^\s*(pinch|pinches|dash|dashes)\s*$/i, grams: 0.3 },
  { match: /^\s*(teabag|teabags|tea bag|tea bags)\s*$/i, grams: 2 },
  { match: /^\s*(scoop|scoops)\s*$/i, grams: 30 },
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
const COUNT_UNIT = /^\s*(|unit|units|piece|pieces|slice|slices|whole|each|item|items|large|medium|small|egg|eggs)\s*$/i;

export function gramsOf(name: string, quantity: number | null | undefined, unit: string | null | undefined): number | null {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null;
  const u = unit ?? "";
  const density = DENSITY.find((d) => d.match.test(name));
  // A bare count ("Sliced bread 2", "Large eggs 2") or a count-shaped unit
  // ("2 slices", "1 unit") prices from the food's own per-item weight.
  if (density?.gramsPerItem && COUNT_UNIT.test(u)) return quantity * density.gramsPerItem;
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

// A count is as firm as a mass once the food has a per-item weight: two slices
// of bread is two slices of bread however it is later toasted.
const isCountOf = (name: string, unit: string | null | undefined): boolean => {
  const density = DENSITY.find((d) => d.match.test(name));
  return density?.gramsPerItem != null && COUNT_UNIT.test(unit ?? "");
};

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
// Only phrasings that mean the grain ARRIVES cooked. "cooked rice" on its own
// was in this list and it is the normal way a recipe refers to rice it cooked
// itself two steps earlier — so a dish that rinsed and simmered its own rice
// was classified as starting from cooked, every cup row went unpriced, coverage
// collapsed below the bar, and the model's numbers stood unchecked. That single
// false positive is the mechanism behind the worst macro gaps in two QA weeks:
// a lunch declaring 620 kcal over 917 kcal of food, and another 603 over 825.
const ALREADY_COOKED =
  /\b(pre-?cooked|already cooked|leftover (rice|pasta|grains?)|day-old rice|from the fridge|ready-cooked|microwave(able)? (rice|pouch))\b/i;

// Instructions that cook the grain from dry. They take PRECEDENCE over a
// mention of the cooked shortcut, because "Cook the brown rice according to
// package directions or use pre-cooked rice" is a recipe that cooks its own
// rice and offers an alternative — and reading the alternative as the plan
// unpriced the rice, dropped the dish below the coverage bar, and let its
// unchecked numbers stand (QA cycle 7, a lunch declaring 620 kcal over 917).
const COOKS_FROM_DRY =
  /\b(according to package|package directions|rinse|bring .{0,40}to a boil|simmer|boil|cook .{0,30}\b(rice|pasta|quinoa|oats|lentils|noodles)\b)/i;

export function grainIsMeasuredDry(steps: readonly string[] | null | undefined): boolean {
  if (!steps || steps.length === 0) return true; // no steps to contradict it
  const text = steps.join(" ");
  if (!ALREADY_COOKED.test(text)) return true;
  // Both present: the dish cooks it AND mentions the shortcut. Dry wins.
  return COOKS_FROM_DRY.test(text);
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
    if (!isMassUnit(ing.unit) && !isCountOf(ing.name, ing.unit) && !density.volumeUnambiguous && !volumeCountsAsDry) continue;
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
  /**
   * Total dietary sodium in mg: the added salt PLUS what the food itself
   * carries. The meal plan's rail showed only the first against a guideline
   * that means the second — see the `sodium` field on DENSITY.
   */
  sodiumMg: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Fraction of macro-bearing grams the table could price. */
  coverage: number;
}

/** Ingredients that carry no meaningful macros, so they never count against coverage. */
/** A teaspoon of table salt, in mg of sodium. Same constant as lib/meal-plan.ts. */
const SODIUM_MG_PER_TSP_SALT = 2325;

/** Teaspoons of salt a row represents, or null when its unit cannot say. */
function saltRowTspLocal(quantity?: number | null, unit?: string | null): number | null {
  if (quantity == null || !(quantity > 0)) return null;
  const u = unit ?? "";
  if (/\b(tsp|teaspoons?)\b/i.test(u)) return quantity;
  if (/\b(tbsp|tablespoons?)\b/i.test(u)) return quantity * 3;
  if (/\b(pinch|pinches|dash(es)?)\b/i.test(u)) return quantity / 16;
  if (/^\s*(g|gram|grams|gr)\s*$/i.test(u)) return quantity / 6;
  return null;
}

const NEGLIGIBLE =
  /\b(salt|pepper|peppercorns?|water|vinegar|spice|seasoning|powder|paprika|cumin|oregano|thyme|basil|rosemary|parsley|cilantro|cinnamon|turmeric|ginger|bay leaf|chili flakes|cayenne|herbs?|stock|broth|lemon juice|lime juice|zest|extract|baking powder|baking soda|mustard|hot sauce|soy sauce|garlic|shallots?|scallions?|green onions?|chives?|dill|mint|sage|tarragon|lemons?|limes?|capers|olives)\b/i;

/**
 * A row that says it is already cooked, in its own note or name.
 *
 * The null-macro repair priced "Wild Rice , V1M- 3/4 cup, cooked unsalted"
 * — noted `[cooked]` AND named "cooked" — at DRY density and wrote 108 g of
 * carbohydrate onto a 125 kcal row (the true figure is ~26 g). That is the same
 * cooked-versus-dry misread this module was built to fix, arriving from the
 * other direction: the steps said nothing, so the default said dry.
 */
const ROW_SAYS_COOKED = /\bcooked\b/i;

/**
 * Cooked grain against dry, as a fraction. Rice triples in weight boiling, so
 * 100 g of cooked rice carries about 28 g of carbohydrate against 78 g dry.
 * One factor across the grains is close enough for a check with a 25% band.
 */
const COOKED_FACTOR = 0.35;

export function priceDish(
  ingredients: readonly { name: string; quantity?: number | null; unit?: string | null; note?: string | null }[],
  steps?: readonly string[] | null
): PricedDish | null {
  let priced = 0;
  let unpriced = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let sodiumMg = 0;
  const volumeOk = grainIsMeasuredDry(steps);

  for (const ing of ingredients) {
    // Sodium is counted BEFORE the NEGLIGIBLE skip, which exists to keep
    // seasonings out of the CALORIE arithmetic and would otherwise take the
    // saltiest things in the kitchen out of the sodium arithmetic with them:
    // salt itself, soy sauce (~870 mg a tablespoon), stock, mustard, hot sauce,
    // olives and capers are all on that list. Caught by a test that expected a
    // tablespoon of soy sauce to register and got null.
    const skipped = NEGLIGIBLE.test(ing.name);
    if (skipped) {
      const saltTsp = /\bsalt\b/i.test(ing.name) ? saltRowTspLocal(ing.quantity, ing.unit) : null;
      if (saltTsp !== null) {
        sodiumMg += saltTsp * SODIUM_MG_PER_TSP_SALT;
      } else {
        const seasoning = DENSITY.find((d) => d.match.test(ing.name));
        if (seasoning?.sodium) {
          const g = gramsOf(ing.name, ing.quantity, ing.unit);
          if (g != null) sodiumMg += (g * seasoning.sodium) / 100;
        }
      }
      continue;
    }
    const density = DENSITY.find((d) => d.match.test(ing.name));
    const grams = density ? gramsOf(ing.name, ing.quantity, ing.unit) : null;
    // A volume amount is only usable when the steps show the grain starts dry;
    // otherwise the same number could mean three times the food.
    const usable =
      grams != null &&
      (isMassUnit(ing.unit) || isCountOf(ing.name, ing.unit) || density?.volumeUnambiguous === true || volumeOk);
    if (!density || !usable) {
      // Weight unknown, so it cannot be weighed against what IS known. Count
      // it as one average portion of unpriced food so coverage reflects it.
      unpriced += 100;
      continue;
    }
    // A row that declares itself cooked is priced cooked.
    const factor = ROW_SAYS_COOKED.test(`${ing.name} ${ing.note ?? ""}`) ? COOKED_FACTOR : 1;
    priced += grams;
    sodiumMg += (grams * (density.sodium ?? 0)) / 100;
    protein += (grams * (density.protein ?? 0) * factor) / 100;
    carbs += (grams * density.carbs * factor) / 100;
    fat += (grams * density.fat * factor) / 100;
  }

  const total = priced + unpriced;
  // Unchanged contract: nothing priceable means null, so a salt-only "dish"
  // can never pass a coverage check. dishSodiumMg (lib/meal-plan.ts) has its
  // own salt-row fallback for that case.
  if (total === 0) return null;
  const coverage = priced / total;
  return {
    sodiumMg: Math.round(sodiumMg),
    // A tenth of a gram, not a whole one. Rounding to integers is what made QA's
    // check read "protein +122%" on a plate of tomatoes: the food holds 1.4 g
    // and the table said 2. The table was fine; the rounding was the error, and
    // it lands on the protein ring, which is a number people act on.
    calories: Math.round(protein * 4 + carbs * 4 + fat * 9),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    coverage,
  };
}

/** Coverage at or above which a dish's own amounts decide its nutrition. */
export const PRICING_COVERAGE_MIN = 0.9;

/**
 * The band inside which a priced figure is trusted enough to overwrite a stored
 * one — and the escape hatch it used to leave open.
 *
 * The repair scripts refused to write anything under 80 kcal, a guard against
 * a broken price writing nonsense onto a real dish. But "Sliced Tomatoes with
 * Olive Oil and Oregano" prices at 75 kcal over 150 g of tomato and a third of
 * a tablespoon of oil, and 75 is simply what that plate is. So the row kept the
 * 93 kcal / 3 / 9 / 5 it was born with — whole numbers where every repriced row
 * carries a tenth-of-a-gram signature, arithmetically self-consistent
 * (3×4 + 9×4 + 5×9 = 93) and wrong against the food.
 *
 * QA found it by that signature. The lesson is the general one: a sanity band
 * meant to catch bad prices was also silently exempting good ones, and nothing
 * reported the exemption.
 *
 * At FULL coverage the table has seen every ingredient, so a low number is a
 * small dish rather than a missing one, and the floor drops. Below 40 kcal a
 * "dish" is a garnish and the stored figure still wins.
 */
export const PRICING_KCAL_FLOOR = 80;
export const PRICING_KCAL_FLOOR_FULL_COVERAGE = 40;
export const PRICING_KCAL_CEILING = 1400;

/** True when a priced result may overwrite a dish's stored nutrition. */
export function pricingMayOverwrite(priced: { calories: number; coverage: number }): boolean {
  if (priced.coverage < PRICING_COVERAGE_MIN) return false;
  if (priced.calories > PRICING_KCAL_CEILING) return false;
  const floor = priced.coverage >= 0.999 ? PRICING_KCAL_FLOOR_FULL_COVERAGE : PRICING_KCAL_FLOOR;
  return priced.calories >= floor;
}


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
