// Ingredient phrases a trigger category removes during a trial's enforced
// phases. Authored from workbook 04's example_ingredients_or_exposures and
// the names our catalog uses (spec Appendix A). Matched exactly like a
// condition ban (phrase, derived-product exemption), so keep terms specific:
// bare "sugar"/"butter"/"beans" would hit sugar-free granola, almond butter
// and the plant-based egg. `groups` are Big-9 component codes.
export type CategoryTerms = { terms: string[]; groups?: string[] };

const CAFFEINE = ["coffee", "espresso", "black tea", "green tea", "matcha", "energy drink", "cola"];
const HIGH_FAT = ["french fries", "fried chicken", "onion rings", "bacon", "sausage", "ribeye steak", "heavy cream", "cream sauce", "unsalted butter", "salted butter", "lard"];
const CHOCOLATE = ["chocolate", "dark chocolate", "dark chocolate chips", "cocoa", "cocoa powder"];

export const TRIGGER_CATEGORY_TERMS: Record<string, CategoryTerms> = {
  ACIDIC_CITRUS: { terms: ["orange", "oranges", "orange juice", "grapefruit", "lemon", "lemons", "lemon juice", "lime", "limes", "lime juice"] },
  ACIDIC_TOMATO: { terms: ["tomato", "tomatoes", "roma tomatoes", "cherry tomatoes", "crushed tomatoes", "sun-dried tomatoes", "tomato sauce", "tomato paste", "tomato juice", "ketchup", "marinara sauce"] },
  ALCOHOL: { terms: ["wine", "beer", "vodka", "rum", "whiskey", "sake", "liqueur", "cooking wine"] },
  CHOCOLATE: { terms: CHOCOLATE },
  CHOCOLATE_UNCERTAIN: { terms: CHOCOLATE },
  CAFFEINE: { terms: CAFFEINE },
  COFFEE_CAFFEINE: { terms: CAFFEINE },
  CAFFEINE_INSTABILITY: { terms: CAFFEINE },
  HIGH_FAT: { terms: HIGH_FAT },
  HIGH_FAT_GREASY: { terms: HIGH_FAT },
  HIGH_FAT_FRIED: { terms: HIGH_FAT },
  MINT: { terms: ["peppermint", "spearmint", "mint", "mint tea"] },
  SPICY: { terms: ["chili peppers", "jalapeño", "habanero", "cayenne pepper", "hot sauce", "sriracha", "red pepper flakes", "chili powder", "wasabi"] },
  CARBONATED: { terms: ["soda", "sparkling water", "carbonated water", "club soda", "tonic water"] },
  FODMAP_FRUCTANS: { terms: ["garlic", "onion", "onions", "yellow onions", "red onion", "shallots", "leeks", "rye"], groups: ["BIG9-WHEAT"] },
  FODMAP_GOS: { terms: ["black beans", "white beans", "kidney beans", "lima beans", "pinto beans", "navy beans", "garbanzo beans", "chickpeas", "lentils", "hummus"] },
  FODMAP_LACTOSE: { terms: ["milk", "whole milk", "ice cream", "ricotta", "cottage cheese", "heavy cream", "sour cream", "condensed milk"] },
  FODMAP_EXCESS_FRUCTOSE: { terms: ["honey", "apple", "apples", "pear", "pears", "mango", "watermelon", "agave", "high fructose corn syrup"] },
  FODMAP_POLYOLS: { terms: ["mushrooms", "cauliflower", "avocado", "avocados", "peach", "plum", "cherries", "apricot", "sorbitol", "xylitol", "mannitol", "maltitol"] },
  CURED_PROCESSED_MEAT: { terms: ["bacon", "ham", "salami", "pepperoni", "prosciutto", "deli meat", "hot dogs", "sausage", "chorizo"] },
  AGED_CHEESE: { terms: ["parmesan", "cheddar", "aged cheddar", "blue cheese", "gorgonzola", "gouda", "swiss cheese", "feta", "brie", "camembert"] },
  MSG: { terms: ["monosodium glutamate", "msg", "bouillon", "stock cube"] },
  ARTIFICIAL_SWEETENERS: { terms: ["aspartame", "sucralose", "saccharin", "acesulfame", "diet soda"] },
  HISTAMINE_TYRAMINE_RICH: { terms: ["sauerkraut", "kimchi", "soy sauce", "fish sauce", "miso", "smoked fish", "anchovies", "parmesan", "blue cheese", "salami", "wine"] },
  HIGH_GLYCEMIC_PATTERN: { terms: ["white sugar", "brown sugar", "candy", "soda", "sliced bread", "jasmine rice", "all-purpose flour", "maple syrup", "honey"] },
  COW_MILK: { terms: ["milk", "whole milk", "skim milk", "2% milk"] },
  WHEY_PROTEIN: { terms: ["whey protein", "whey", "protein powder"] },
  HIGH_SUGAR_DAIRY: { terms: ["ice cream", "chocolate milk", "sweetened yogurt", "milkshake", "condensed milk"] },
};

export function termsForCategory(category: string): CategoryTerms {
  return TRIGGER_CATEGORY_TERMS[category] ?? { terms: [] };
}

/** Human title for a category code: "ACIDIC_CITRUS" → "Acidic citrus". */
const ACRONYMS: Record<string, string> = { fodmap: "FODMAP", msg: "MSG", gos: "GOS" };
export function categoryTitle(category: string): string {
  const s = category.toLowerCase().split("_").map((w) => ACRONYMS[w] ?? w).join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
