// Best-effort emoji for an ingredient name — first substring match wins.
// Purely cosmetic (swipe cards / buy-list rows); unknown names get 🥘.
const MAP: [string, string][] = [
  ["chicken", "🍗"], ["beef", "🥩"], ["steak", "🥩"], ["pork", "🥓"],
  ["bacon", "🥓"], ["fish", "🐟"], ["salmon", "🐟"], ["tuna", "🐟"],
  ["shrimp", "🦐"], ["egg", "🥚"], ["rice", "🍚"], ["pasta", "🍝"],
  ["noodle", "🍜"], ["bread", "🍞"], ["potato", "🥔"], ["tomato", "🍅"],
  ["avocado", "🥑"], ["onion", "🧅"], ["garlic", "🧄"], ["carrot", "🥕"],
  ["broccoli", "🥦"], ["pepper", "🫑"], ["mushroom", "🍄"], ["corn", "🌽"],
  ["cheese", "🧀"], ["milk", "🥛"], ["butter", "🧈"], ["yogurt", "🥛"],
  ["apple", "🍎"], ["banana", "🍌"], ["lemon", "🍋"], ["lime", "🍋"],
  ["spinach", "🥬"], ["lettuce", "🥬"], ["bean", "🫘"], ["lentil", "🫘"],
  ["oil", "🫒"], ["olive", "🫒"], ["honey", "🍯"], ["oat", "🌾"],
  ["flour", "🌾"], ["chocolate", "🍫"], ["nut", "🥜"], ["almond", "🥜"],
];

export function getIngredientEmoji(name: string): string {
  const n = name.toLowerCase();
  for (const [key, emoji] of MAP) if (n.includes(key)) return emoji;
  return "🥘";
}
