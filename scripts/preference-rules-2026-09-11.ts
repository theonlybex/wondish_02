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

const PREF_CHILDREN: Record<string, string[]> = {
  Vegan: [...MEAT, ...SEAFOOD, ...DAIRY_EGG],
  Vegetarian: [...MEAT, ...SEAFOOD],
  Pescatarian: MEAT,
};

(async () => {
  const prefs = await prisma.foodPreference.findMany({
    where: { name: { in: Object.keys(PREF_CHILDREN) } },
    select: { id: true, name: true, bannedIngredients: { select: { name: true } } },
  });
  let total = 0;
  for (const pref of prefs) {
    const have = new Set(pref.bannedIngredients.map((b) => b.name.toLowerCase()));
    const missing = PREF_CHILDREN[pref.name].filter((n) => !have.has(n.toLowerCase()));
    total += missing.length;
    console.log(`[pref] ${pref.name}: ${have.size} → +${missing.length}${missing.length ? " → " + missing.join(", ") : ""}`);
    if (apply && missing.length) {
      await prisma.foodPreferenceBannedIngredient.createMany({ data: missing.map((name) => ({ preferenceId: pref.id, name })), skipDuplicates: true });
    }
  }
  const absent = Object.keys(PREF_CHILDREN).filter((n) => !prefs.some((p) => p.name === n));
  if (absent.length) console.log(`[pref] not found: ${absent.join(", ")}`);
  console.log(apply ? `Applied: ${total} rows created.` : `Dry run: ${total} rows would be created. Re-run with --apply.`);
  await prisma.$disconnect();
})();
