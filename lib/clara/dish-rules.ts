// The eight switches a person can turn off on how Clara builds a dish.
// Pure: no database, no model client.
import type { KeptFoods } from "./kept-foods";

export interface DishRules {
  cookFromHome: boolean; // off: the at-home list is ignored
  onlyHomeProteins: boolean; // off: any protein may be used
  mainsOnProtein: boolean; // off: mains need no protein ingredient and no protein minimum
  sameProteinToday: boolean; // off: rotate freely
  sizeToCalories: boolean; // off: no calorie target per meal
  followMacroSplit: boolean; // off: no macro split
  steerByLevels: boolean; // off: week and day levels are ignored
  favourFavourites: boolean; // off: favourites are not lifted
}

const KEYS: readonly (keyof DishRules)[] = [
  "cookFromHome", "onlyHomeProteins", "mainsOnProtein", "sameProteinToday",
  "sizeToCalories", "followMacroSplit", "steerByLevels", "favourFavourites",
];

export const DEFAULT_DISH_RULES: Readonly<DishRules> = Object.freeze({
  cookFromHome: true,
  onlyHomeProteins: true,
  mainsOnProtein: true,
  sameProteinToday: true,
  sizeToCalories: true,
  followMacroSplit: true,
  steerByLevels: true,
  favourFavourites: true,
});

/** Piece D's stored JSON. Not an object, an unknown key, or a non-boolean value: the default for that key. */
export function dishRulesFrom(raw: unknown): DishRules {
  const out: DishRules = { ...DEFAULT_DISH_RULES };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const k of KEYS) {
    const v = Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** cookFromHome off: proteinKeys, proteinNames and atHome emptied. favourFavourites off: favorites emptied. */
export function keptUnderRules(kept: KeptFoods, rules: DishRules): KeptFoods {
  return {
    proteinKeys: rules.cookFromHome ? kept.proteinKeys : [],
    proteinNames: rules.cookFromHome ? kept.proteinNames : [],
    atHome: rules.cookFromHome ? kept.atHome : [],
    favorites: rules.favourFavourites ? kept.favorites : [],
  };
}
