/**
 * Returns the best emoji for a recipe based on its name, tags, and meal type.
 * Used as a fallback when recipe.emoji is null/undefined.
 */

const KEYWORD_MAP: [RegExp, string][] = [
  // ── Proteins ──────────────────────────────────────────
  [/\b(chicken|poulet|pollo|hen|rotisserie|grilled chicken)\b/i, "🍗"],
  [/\b(turkey)\b/i, "🦃"],
  [/\b(beef|steak|burger|bœuf|carne|meatball|bolognese|mince|ground beef)\b/i, "🥩"],
  [/\b(lamb|mutton)\b/i, "🍖"],
  [/\b(pork|bacon|ham|prosciutto|chorizo|sausage|ribs)\b/i, "🥓"],
  [/\b(salmon|saumon)\b/i, "🐟"],
  [/\b(tuna|thon|atún)\b/i, "🐟"],
  [/\b(shrimp|prawn|crevette|gambas)\b/i, "🦐"],
  [/\b(lobster|crab|langoustine)\b/i, "🦞"],
  [/\b(fish|cod|tilapia|halibut|sea bass|trout|mahi|sole)\b/i, "🐠"],
  [/\b(egg|omelette|frittata|quiche|shakshuka|scrambled|poached egg)\b/i, "🥚"],
  [/\b(tofu|tempeh)\b/i, "🫘"],

  // ── Grains & Carbs ────────────────────────────────────
  [/\b(pasta|spaghetti|penne|fettuccine|linguine|tagliatelle|rigatoni|noodle)\b/i, "🍝"],
  [/\b(pizza)\b/i, "🍕"],
  [/\b(rice|risotto|fried rice|pilaf|biryani|paella)\b/i, "🍚"],
  [/\b(bread|toast|sandwich|wrap|baguette|pita|panini)\b/i, "🥪"],
  [/\b(pancake|waffle|crepe)\b/i, "🥞"],
  [/\b(quinoa)\b/i, "🌾"],
  [/\b(oat|porridge|granola|muesli|overnight oat)\b/i, "🥣"],
  [/\b(taco|burrito|quesadilla|enchilada|fajita|nachos)\b/i, "🌮"],
  [/\b(sushi|maki|roll|temaki)\b/i, "🍣"],
  [/\b(dumpling|gyoza|dim sum|wonton)\b/i, "🥟"],
  [/\b(ramen|pho|noodle soup|udon|soba)\b/i, "🍜"],
  [/\b(burger|cheeseburger|slider)\b/i, "🍔"],
  [/\b(hot dog)\b/i, "🌭"],

  // ── Vegetables & Salads ───────────────────────────────
  [/\b(salad|salade|caesar|nicoise|coleslaw|greek salad)\b/i, "🥗"],
  [/\b(soup|stew|chowder|bisque|broth|velouté|minestrone)\b/i, "🥣"],
  [/\b(curry|tikka|masala|korma|vindaloo|dal)\b/i, "🍛"],
  [/\b(stir.?fry|wok)\b/i, "🥘"],
  [/\b(bowl|poke|buddha bowl|grain bowl)\b/i, "🥙"],
  [/\b(avocado|guacamole)\b/i, "🥑"],
  [/\b(broccoli)\b/i, "🥦"],
  [/\b(carrot)\b/i, "🥕"],
  [/\b(corn|maize)\b/i, "🌽"],
  [/\b(mushroom)\b/i, "🍄"],
  [/\b(tomato|pomodoro)\b/i, "🍅"],

  // ── Fruit & Sweet ─────────────────────────────────────
  [/\b(smoothie|shake|juice|blend)\b/i, "🥤"],
  [/\b(cake|cupcake|muffin|brownie)\b/i, "🎂"],
  [/\b(cookie|biscuit)\b/i, "🍪"],
  [/\b(ice cream|gelato|sorbet)\b/i, "🍦"],
  [/\b(fruit|berry|berries|strawberry|blueberry|mango|banana)\b/i, "🍓"],
  [/\b(yogurt|parfait)\b/i, "🫙"],
  [/\b(chocolate)\b/i, "🍫"],

  // ── Breakfast ─────────────────────────────────────────
  [/\b(cereal|cornflakes)\b/i, "🥣"],

  // ── Drinks ────────────────────────────────────────────
  [/\b(coffee|espresso|latte|cappuccino)\b/i, "☕"],
  [/\b(tea)\b/i, "🍵"],
];

const MEAL_TYPE_FALLBACK: Record<string, string> = {
  breakfast: "🍳",
  lunch: "🥗",
  dinner: "🍽",
  snack: "🍎",
};

export function getRecipeEmoji(
  name: string,
  tags?: string[] | null,
  mealType?: string | null
): string {
  const haystack = [name, ...(tags ?? [])].join(" ").toLowerCase();

  for (const [pattern, emoji] of KEYWORD_MAP) {
    if (pattern.test(haystack)) return emoji;
  }

  if (mealType) {
    const fallback = MEAL_TYPE_FALLBACK[mealType.toLowerCase()];
    if (fallback) return fallback;
  }

  return "🍽";
}
