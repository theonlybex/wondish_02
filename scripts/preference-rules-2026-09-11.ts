// FoodPreference.bannedIngredients gaps (2026-09-11 QA). Dry-run by default.
//   set -a; source .env.local; set +a
//   npx tsx scripts/preference-rules-2026-09-11.ts [--apply]
//
// Vegan / Vegetarian / Pescatarian banned "beef" and "fish" but not the cuts
// and species the library actually uses: "Sirloin steak" (25 recipes),
// "Catfish fillets" (20), "rainbow trout filets", sardines, "clam juice" all
// passed every one of these profiles. Idempotent: only names the list lacks
// are created (createMany skipDuplicates).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

// Beef cuts rather than "steak" (a pescatarian's tuna steak) and "goat meat"
// rather than "goat" (a vegetarian's goat cheese).
const MEAT = [
  "sirloin", "ribeye", "flank steak", "skirt steak", "strip steak", "t-bone", "round steak", "chuck roast",
  "brisket", "ground beef", "corned beef", "liver", "organ meat", "spam",
  "chorizo", "prosciutto", "pancetta", "venison", "goat meat", "rabbit", "meatballs", "jerky", "pastrami",
  "kielbasa", "bratwurst", "bologna", "mortadella",
];
const SEAFOOD = [
  "catfish", "trout", "sardines", "clam juice", "clams", "mussels", "scallops", "oysters", "squid", "calamari",
  "octopus", "halibut", "mackerel", "prawns", "crawfish", "sea bass", "snapper", "swordfish", "mahi mahi",
  "haddock", "pollock", "flounder", "herring", "seafood", "caviar", "surimi", "imitation crab", "worcestershire sauce",
];
const DAIRY_EGG = [
  "kefir", "half and half", "mascarpone", "gouda", "pecorino", "parmigiano", "gruyere", "provolone", "paneer",
  "custard", "feta", "halloumi", "labneh", "queso fresco", "creamer", "tallow",
];

// Second sweep (same day): wheat products the library names without "wheat"
// or "pasta" ("Sliced bread" 119 recipes, "Penne" 33, "Spaghetti"), soy
// spelled as one word ("unsweetened soymilk"), cheeses named without
// "cheese" (Paleo: "Shredded cheddar", "Grated parmesan"), and quinoa /
// couscous for Low-carb. Library dishes were already caught by the Big-9
// allergenGroups tags; Clara-generated dishes are checked by name only.
const WHEAT_PRODUCTS = [
  "bread", "penne", "spaghetti", "macaroni", "fettuccine", "linguine", "lasagna", "orzo", "rotini", "ravioli", "gnocchi",
  "crackers", "cracker crumbs", "croutons", "bagel", "pita", "naan", "croissant", "baguette", "brioche", "flour tortillas",
  "pizza dough", "dough", "pastry", "pie crust", "pancakes", "waffles", "pretzels", "udon", "ramen", "wonton wrappers",
  "dumpling wrappers", "cake", "cookies", "biscuits", "muffins", "beer", "wheat noodles",
];
const SOY_PRODUCTS = ["soy", "soya", "soymilk", "soybean", "soy yogurt", "soy cheese", "shoyu", "yuba", "natto", "bean curd", "soy nuts", "soy oil"];
const CHEESES = ["cheddar", "mozzarella", "parmesan", "feta", "ricotta", "brie", "gouda", "swiss cheese", "provolone", "cottage cheese", "cream cheese", "sour cream"];
const LEGUME_PRODUCTS = ["hummus", "legumes", "lima beans", "pinto beans", "navy beans", "white beans", "soy milk", "soy sauce", "tempeh"];
const HIGH_CARB = ["quinoa", "couscous", "barley", "bulgur", "farro", "millet", "bagel", "granola", "orange juice", "apple juice", "grape juice", "cassava", "plantain", "dates", "raisins"];

const ALLERGY_CHILDREN: Record<string, string[]> = {
  Wheat: WHEAT_PRODUCTS,
  Soy: SOY_PRODUCTS,
};
const PREF_CHILDREN: Record<string, string[]> = {
  Vegan: [...MEAT, ...SEAFOOD, ...DAIRY_EGG],
  Vegetarian: [...MEAT, ...SEAFOOD],
  Pescatarian: MEAT,
  "Gluten-free": WHEAT_PRODUCTS.filter((n) => n !== "beer"),
  Paleo: [...CHEESES, ...LEGUME_PRODUCTS, "bread crumbs", "crackers", "noodles", "cereal", "tortilla"],
  Keto: [...HIGH_CARB, "melon", "honeydew", "cantaloupe", "yam"],
  "Low-carb": HIGH_CARB,
};

(async () => {
  let total = 0;
  const allergies = await prisma.foodAllergy.findMany({
    where: { name: { in: Object.keys(ALLERGY_CHILDREN) } },
    select: { id: true, name: true, bannedIngredients: { select: { name: true } } },
  });
  for (const a of allergies) {
    const have = new Set(a.bannedIngredients.map((b) => b.name.toLowerCase()));
    const missing = ALLERGY_CHILDREN[a.name].filter((n) => !have.has(n.toLowerCase()));
    total += missing.length;
    console.log(`[allergy] ${a.name}: ${have.size} → +${missing.length}${missing.length ? " → " + missing.join(", ") : ""}`);
    if (apply && missing.length) {
      await prisma.foodAllergyBannedIngredient.createMany({ data: missing.map((name) => ({ allergyId: a.id, name })), skipDuplicates: true });
    }
  }
  const prefs = await prisma.foodPreference.findMany({
    where: { name: { in: Object.keys(PREF_CHILDREN) } },
    select: { id: true, name: true, bannedIngredients: { select: { name: true } } },
  });
  for (const pref of prefs) {
    const have = new Set(pref.bannedIngredients.map((b) => b.name.toLowerCase()));
    const missing = PREF_CHILDREN[pref.name].filter((n) => !have.has(n.toLowerCase()));
    total += missing.length;
    console.log(`[pref] ${pref.name}: ${have.size} → +${missing.length}${missing.length ? " → " + missing.join(", ") : ""}`);
    if (apply && missing.length) {
      await prisma.foodPreferenceBannedIngredient.createMany({ data: missing.map((name) => ({ preferenceId: pref.id, name })), skipDuplicates: true });
    }
  }
  const absent = [
    ...Object.keys(ALLERGY_CHILDREN).filter((n) => !allergies.some((a) => a.name === n)),
    ...Object.keys(PREF_CHILDREN).filter((n) => !prefs.some((p) => p.name === n)),
  ];
  if (absent.length) console.log(`not found: ${absent.join(", ")}`);
  console.log(apply ? `Applied: ${total} rows created.` : `Dry run: ${total} rows would be created. Re-run with --apply.`);
  await prisma.$disconnect();
})();
