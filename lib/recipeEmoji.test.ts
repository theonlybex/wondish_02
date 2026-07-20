import { test } from "node:test";
import assert from "node:assert/strict";
import { getRecipeEmoji } from "./recipeEmoji";

// ── Keyword matching by name ────────────────────────────────

test("matches protein keywords in the recipe name", () => {
  assert.equal(getRecipeEmoji("Grilled Chicken Breast"), "🍗");
  assert.equal(getRecipeEmoji("Roast Turkey"), "🦃");
  assert.equal(getRecipeEmoji("Ribeye Steak"), "🥩");
  assert.equal(getRecipeEmoji("Salmon Teriyaki"), "🐟");
  assert.equal(getRecipeEmoji("Garlic Shrimp"), "🦐");
  assert.equal(getRecipeEmoji("Tofu Scramble Bowl"), "🫘");
});

test("matches grain and carb keywords", () => {
  assert.equal(getRecipeEmoji("Pizza Margherita"), "🍕");
  assert.equal(getRecipeEmoji("Mushroom Risotto"), "🍚"); // risotto (grains) precedes mushroom
  assert.equal(getRecipeEmoji("Veggie Quesadilla"), "🌮");
  assert.equal(getRecipeEmoji("Pork Gyoza"), "🥓"); // pork (protein) wins over dumpling
  assert.equal(getRecipeEmoji("Veggie Gyoza"), "🥟");
  assert.equal(getRecipeEmoji("Miso Ramen"), "🍜");
  assert.equal(getRecipeEmoji("Classic Hot Dog"), "🌭");
});

test("matches multilingual keywords", () => {
  assert.equal(getRecipeEmoji("Poulet Basquaise"), "🍗"); // French chicken
  assert.equal(getRecipeEmoji("Salade Niçoise aux oeufs"), "🥗"); // "salade"
  assert.equal(getRecipeEmoji("Spaghetti al Pomodoro"), "🍝"); // pasta before tomato
});

test("matches sweet, drink, and breakfast keywords", () => {
  assert.equal(getRecipeEmoji("Berry Smoothie"), "🥤"); // smoothie listed before berry
  assert.equal(getRecipeEmoji("Chocolate Chip Cookie"), "🍪"); // cookie listed before chocolate
  assert.equal(getRecipeEmoji("Dark Chocolate Mousse"), "🍫");
  assert.equal(getRecipeEmoji("Porridge with Honey"), "🥣");
  assert.equal(getRecipeEmoji("Iced Latte"), "☕");
  assert.equal(getRecipeEmoji("Green Tea"), "🍵");
});

// ── Priority / ordering (first match in KEYWORD_MAP wins) ──

test("earlier KEYWORD_MAP entries win over later ones", () => {
  // "chicken" (proteins block) beats "salad" (vegetables block)
  assert.equal(getRecipeEmoji("Chicken Caesar Salad"), "🍗");
  // "bolognese" is in the beef pattern, which precedes the pasta pattern
  assert.equal(getRecipeEmoji("Spaghetti Bolognese"), "🥩");
  // "salmon" beats generic "fish"-group words like "poke"/"bowl"
  assert.equal(getRecipeEmoji("Salmon Poke Bowl"), "🐟");
  // "egg" beats "toast"
  assert.equal(getRecipeEmoji("Egg on Toast"), "🥚");
});

test("specific fish patterns precede the generic fish group", () => {
  // salmon/tuna get 🐟 from their own earlier entries; other fish words
  // fall through to the generic 🐠 group.
  assert.equal(getRecipeEmoji("Baked Cod"), "🐠");
  assert.equal(getRecipeEmoji("Sea Bass with Lemon"), "🐠");
  assert.equal(getRecipeEmoji("Tuna Melt"), "🐟"); // tuna entry, not generic fish
});

test("'burger' resolves to the burger emoji; beef/turkey patterns still win when named explicitly", () => {
  // "burger" no longer appears in the beef pattern, so a plain burger name
  // reaches the dedicated burger entry. Turkey still precedes it because the
  // turkey pattern comes first in the map; explicit beef titles still hit 🥩.
  assert.equal(getRecipeEmoji("Veggie Burger"), "🍔");
  assert.equal(getRecipeEmoji("Turkey Burger"), "🦃"); // turkey precedes beef
  assert.equal(getRecipeEmoji("Cheeseburger"), "🍔"); // \bburger\b can't match inside "cheeseburger"
});

// ── Tags participate in matching ────────────────────────────

test("keywords in tags match when the name has none", () => {
  assert.equal(getRecipeEmoji("Nonna's Special", ["pasta", "comfort"]), "🍝");
  assert.equal(getRecipeEmoji("Morning Fuel", ["smoothie"]), "🥤");
});

test("name keywords take priority over tag keywords only via map order", () => {
  // Name and tags are joined into one haystack, so map order decides,
  // not whether the keyword came from name or tag.
  assert.equal(getRecipeEmoji("Garden Salad", ["chicken"]), "🍗");
});

test("name and tags join into one haystack, so phrases can form across the boundary (current behavior)", () => {
  // The implementation joins [name, ...tags] with a single space, so a
  // multi-word keyword can be assembled from the end of the name plus the
  // first tag. Documented quirk of the join-based matching.
  assert.equal(getRecipeEmoji("Hot", ["dog"]), "🌭");
});

test("null/undefined/empty tags are handled", () => {
  assert.equal(getRecipeEmoji("Pizza", null), "🍕");
  assert.equal(getRecipeEmoji("Pizza", undefined), "🍕");
  assert.equal(getRecipeEmoji("Pizza", []), "🍕");
});

// ── Case-insensitivity ──────────────────────────────────────

test("matching is case-insensitive", () => {
  assert.equal(getRecipeEmoji("PIZZA PARTY"), "🍕");
  assert.equal(getRecipeEmoji("ChIcKeN wings"), "🍗");
  assert.equal(getRecipeEmoji("mystery dish", ["SUSHI"]), "🍣");
});

test("meal type fallback is case-insensitive", () => {
  assert.equal(getRecipeEmoji("Mystery Meal", null, "BREAKFAST"), "🍳");
  assert.equal(getRecipeEmoji("Mystery Meal", null, "Snack"), "🍎");
});

// ── Word boundaries ─────────────────────────────────────────

test("keywords only match on word boundaries", () => {
  // "crabapple" must not match the "crab" pattern
  assert.equal(getRecipeEmoji("Crabapple Compote"), "🍽");
  // "ricecake" must not match "rice" (no boundary inside the word)
  assert.equal(getRecipeEmoji("Ricecake Special"), "🍽");
  // hyphens are word boundaries, so "stir-fry" still matches stir.?fry
  assert.equal(getRecipeEmoji("Veggie Stir-Fry"), "🥘");
  assert.equal(getRecipeEmoji("Veggie Stir Fry"), "🥘");
});

// ── Fallback behavior ───────────────────────────────────────

test("falls back to meal-type emoji when no keyword matches", () => {
  assert.equal(getRecipeEmoji("Mystery Dish", null, "breakfast"), "🍳");
  assert.equal(getRecipeEmoji("Mystery Dish", null, "lunch"), "🥗");
  assert.equal(getRecipeEmoji("Mystery Dish", null, "dinner"), "🍽");
  assert.equal(getRecipeEmoji("Mystery Dish", null, "snack"), "🍎");
});

test("keyword match beats meal-type fallback", () => {
  assert.equal(getRecipeEmoji("Pizza", null, "breakfast"), "🍕");
});

test("unknown meal type falls through to the generic plate", () => {
  assert.equal(getRecipeEmoji("Mystery Dish", null, "brunch"), "🍽");
  assert.equal(getRecipeEmoji("Mystery Dish", null, ""), "🍽");
});

test("no keyword and no meal type returns the generic plate", () => {
  assert.equal(getRecipeEmoji("Mystery Dish"), "🍽");
  assert.equal(getRecipeEmoji("Mystery Dish", null, null), "🍽");
});

test("empty name returns the generic plate", () => {
  assert.equal(getRecipeEmoji(""), "🍽");
  assert.equal(getRecipeEmoji("", [], null), "🍽");
});

// ── Documented quirks of current matching ───────────────────

test("bare 'roll' no longer maps to sushi for non-sushi rolls", () => {
  // The sushi pattern is now sushi-specific (sushi|maki|temaki|sushi roll|
  // california roll), so a bakery item like "Cinnamon Roll" matches no
  // keyword at all and falls through to the generic plate.
  assert.equal(getRecipeEmoji("Cinnamon Roll"), "🍽");
});

test("plural 'oats' matches the pluralized oat pattern", () => {
  // /\b(oats?|...|overnight oats?)\b/ now covers the plural, so the common
  // name "Overnight Oats" resolves to the oat/porridge emoji.
  assert.equal(getRecipeEmoji("Overnight Oats"), "🥣");
  assert.equal(getRecipeEmoji("Overnight Oats", null, "breakfast"), "🥣");
});
