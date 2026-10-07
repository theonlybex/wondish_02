// "Cooking oil" is not an ingredient you can buy. The free-staples line in
// Clara's prompt offered it by that name, so Clara wrote it: 344 library
// dishes list "cooking oil" and 433 tell the cook to heat it (2026-10-07).
// The shopping list could not say which oil to buy, and the dish could not
// say what it tastes of.
//
// specifyCookingOil names the oil: one the dish already uses if it has one
// (a stir-fry with toasted sesame oil cooks in it), avocado oil for high-heat
// methods (sear, stir-fry, pan-fry — high smoke point), olive oil otherwise.
// Neither is on any profile's ban list; both are basket staples.
type OilDish = {
  name: string;
  usesIngredients: string[];
  missingIngredients: string[];
  steps: string[];
  amounts?: { name: string; quantity?: number | null; unit?: string | null }[];
};

const GENERIC = new Set(["oil", "cooking oil", "cooking spray", "nonstick cooking spray", "non-stick cooking spray", "oil spray"]);
const SPRAY_PHRASE = /\b(?:non-?stick )?cooking spray\b/gi;
const OIL_PHRASE = /\bcooking oil\b/gi;
// Methods that need a high smoke point. Not "medium-high heat" (a sauté olive
// oil handles; it was 291 of 344 library hits) and not "crisp" ("crisp-tender").
const HIGH_HEAT = /\b(?:stir[- ]?fr(?:y|ied|ying)|sear(?:ed|ing)?|wok|pan[- ]?fr(?:y|ied|ying)|deep[- ]?fr(?:y|ied|ying)|blacken(?:ed)?)\b|(?<!medium[- ])\bhigh heat\b/i;
const SPECIFIC_OIL = /\boil\b/i;

const isGeneric = (s: string) => GENERIC.has(s.trim().toLowerCase());

export function chooseOil(dish: OilDish): string {
  const specific = [...dish.usesIngredients, ...dish.missingIngredients].find((i) => SPECIFIC_OIL.test(i) && !isGeneric(i));
  if (specific) return specific.trim();
  return HIGH_HEAT.test([dish.name, ...dish.steps].join(" \n ")) ? "avocado oil" : "olive oil";
}

export function specifyCookingOil<T extends OilDish>(dish: T): T {
  const lists = [...dish.usesIngredients, ...dish.missingIngredients];
  const mentions = lists.some(isGeneric) || dish.steps.some((s) => OIL_PHRASE.test(s) || SPRAY_PHRASE.test(s));
  OIL_PHRASE.lastIndex = SPRAY_PHRASE.lastIndex = 0;
  if (!mentions) return dish;

  const oil = chooseOil(dish);
  const fixList = (list: string[]) => {
    const out: string[] = [];
    for (const item of list) {
      const next = isGeneric(item) ? oil : item;
      if (!out.some((o) => o.toLowerCase() === next.toLowerCase())) out.push(next);
    }
    return out;
  };
  const usesIngredients = fixList(dish.usesIngredients);
  // An oil already in usesIngredients is not also "missing".
  const missingIngredients = fixList(dish.missingIngredients).filter((m) => !usesIngredients.some((u) => u.toLowerCase() === m.toLowerCase()));
  const steps = dish.steps.map((s) => s.replace(SPRAY_PHRASE, `${oil} spray`).replace(OIL_PHRASE, oil));
  const amounts = dish.amounts?.map((a) => (isGeneric(a.name) ? { ...a, name: oil } : a));
  return { ...dish, usesIngredients, missingIngredients, steps, ...(dish.amounts ? { amounts } : {}) };
}
