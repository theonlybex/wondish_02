// Kitchen basics: the staples the app assumes a kitchen has (lib/basket-coverage
// BASKET_STAPLES), grouped into the items a user sees and can untick on the
// Ingredients screen. A user who said "no garlic powder" gets no garlic powder
// — before 2026-10-08 the assumption was invisible and unconditional, and 11
// of 26 dishes in a reproduced week used garlic powder the diner never chose.
//
// Stored per patient as the keys they DON'T have (Patient.missingStaples), so
// the default — everything assumed — needs no data and changes nothing.
import { BASKET_STAPLES } from "@/lib/basket-coverage";

export type KitchenBasic = { key: string; label: string; names: string[]; oil?: boolean };

export const KITCHEN_BASICS: KitchenBasic[] = [
  { key: "salt", label: "Salt", names: ["salt", "kosher salt", "sea salt", "table salt"] },
  { key: "olive-oil", label: "Olive oil", names: ["olive oil", "extra virgin olive oil"], oil: true },
  { key: "vegetable-oil", label: "Vegetable / canola / sunflower oil", names: ["vegetable oil", "canola oil", "sunflower oil"], oil: true },
  { key: "avocado-oil", label: "Avocado oil", names: ["avocado oil"], oil: true },
  { key: "butter", label: "Butter", names: ["butter", "unsalted butter"] },
  { key: "onion-powder", label: "Onion powder", names: ["onion powder"] },
  { key: "paprika", label: "Paprika", names: ["paprika", "smoked paprika"] },
  { key: "cumin", label: "Cumin", names: ["cumin", "ground cumin"] },
  { key: "chili-powder", label: "Chili powder", names: ["chili powder"] },
  { key: "cayenne", label: "Cayenne", names: ["cayenne", "cayenne pepper"] },
  { key: "red-pepper-flakes", label: "Red pepper flakes", names: ["red pepper flakes", "crushed red pepper"] },
  { key: "italian-seasoning", label: "Italian seasoning", names: ["italian seasoning"] },
  { key: "oregano", label: "Dried oregano", names: ["oregano", "dried oregano"] },
  { key: "basil", label: "Dried basil", names: ["basil", "dried basil"] },
  { key: "thyme", label: "Dried thyme", names: ["thyme", "dried thyme"] },
  { key: "rosemary", label: "Dried rosemary", names: ["rosemary", "dried rosemary"] },
  { key: "parsley", label: "Dried parsley", names: ["parsley", "dried parsley"] },
  { key: "bay-leaves", label: "Bay leaves", names: ["bay leaf", "bay leaves"] },
  { key: "cinnamon", label: "Cinnamon", names: ["cinnamon", "ground cinnamon"] },
  { key: "turmeric", label: "Turmeric", names: ["turmeric", "ground turmeric"] },
  { key: "ground-ginger", label: "Ground ginger", names: ["ground ginger"] },
  { key: "curry-powder", label: "Curry powder", names: ["curry powder"] },
];

// Not assumed at all — garlic and pepper are "not for everybody" (product call
// 2026-10-08). A diner who lists one spelling in What I have owns them all:
// the catalog offers "Black peppercorns" while recipes say "pepper", "Black
// pepper" or "ground black pepper".
const OWNED_FAMILIES: string[][] = [
  ["pepper", "black pepper", "black peppercorns", "ground black pepper", "freshly ground black pepper", "cracked black pepper"],
  ["garlic powder", "granulated garlic"],
];

// Generic cooking-fat words: assumed only while the user keeps SOME oil.
const GENERIC_OIL = ["oil", "cooking oil", "cooking spray", "nonstick cooking spray"];
const KEYS = new Set(KITCHEN_BASICS.map((b) => b.key));

/**
 * The staples this user may be assumed to have (lowercased names). `basket`:
 * what they listed in What I have — owning one spelling of a family (pepper,
 * garlic powder) makes every spelling free.
 */
export function staplesFor(missing: readonly string[] | null | undefined, basket?: Iterable<string>): Set<string> {
  const gone = new Set(missing ?? []);
  const out = new Set(BASKET_STAPLES);
  for (const b of KITCHEN_BASICS) if (gone.has(b.key)) for (const n of b.names) out.delete(n);
  const keepsAnOil = KITCHEN_BASICS.some((b) => b.oil && !gone.has(b.key));
  if (!keepsAnOil) for (const n of GENERIC_OIL) out.delete(n);
  if (basket) {
    const have = new Set(Array.from(basket, (n) => n.trim().toLowerCase()));
    for (const family of OWNED_FAMILIES) if (family.some((n) => have.has(n))) for (const n of family) out.add(n);
  }
  return out;
}

/** Keys from a request body: known basics only, deduplicated. */
export function validateMissingBasics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((k): k is string => typeof k === "string" && KEYS.has(k))));
}
