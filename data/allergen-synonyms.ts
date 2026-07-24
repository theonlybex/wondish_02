// Curated FoodAllergyBannedIngredient children per seeded allergy name —
// fixes the 2026-07-24 audit CRITICAL: an allergy with no children matches
// only by its display name (lib/diet-match.ts derivePatientBans), so
// "Shellfish" passed ingredient "Shrimp", "Fish" passed "Tuna". Consumed by
// scripts/seed-allergen-synonyms.ts (standalone, dry-run default) and
// app/api/admin/seed/route.ts (idempotent existence-checked create).
//
// These are matcher inputs, not medical advice: lib/diet-match.ts applies
// plural stemming + word-boundary phrase matching, so "almond" also catches
// "Almonds" / "almond butter". Curation favors over-blocking — the safe
// direction for allergy verdicts. Keys must exactly match the FoodAllergy
// names the admin seed creates.
export const ALLERGEN_SYNONYMS: Record<string, string[]> = {
  "Peanuts": [
    "peanut", "peanut butter", "peanut oil", "peanut sauce", "groundnut",
  ],
  "Tree nuts": [
    "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut",
    "macadamia", "brazil nut", "pine nut", "chestnut", "nut butter",
    "almond milk", "almond flour",
  ],
  "Milk": [
    "milk", "cheese", "butter", "cream", "yogurt", "ghee", "whey",
    "casein", "custard", "condensed milk", "evaporated milk", "ice cream",
    "sour cream", "cream cheese", "mozzarella", "parmesan", "cheddar",
  ],
  "Eggs": [
    "egg", "egg yolk", "egg white", "mayonnaise", "aioli", "meringue",
    "egg noodle", "hollandaise",
  ],
  "Wheat / Gluten": [
    "wheat", "gluten", "flour", "bread", "breadcrumbs", "panko", "pasta",
    "noodle", "soy sauce", "wrapper", "bun", "seitan", "couscous", "barley",
    "rye", "malt", "cracker", "tortilla", "dumpling wrapper", "tempura",
  ],
  "Soy": [
    "soy", "soybean", "tofu", "edamame", "soy sauce", "miso", "tempeh",
    "soy milk", "tamari",
  ],
  "Fish": [
    "fish", "tuna", "salmon", "cod", "tilapia", "anchovy", "sardine",
    "bass", "trout", "halibut", "mackerel", "snapper", "catfish", "eel",
    "unagi", "fish sauce", "fish broth", "bonito", "worcestershire",
  ],
  "Shellfish": [
    "shrimp", "prawn", "crab", "lobster", "crayfish", "scallop", "clam",
    "mussel", "oyster", "squid", "calamari", "octopus", "abalone", "snail",
    "oyster sauce", "shrimp paste",
  ],
  "Sesame": [
    "sesame", "sesame oil", "sesame seed", "tahini", "gomashio", "benne",
  ],
};
