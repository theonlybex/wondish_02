// What counts as a dish's protein, what a person has at home, and what a main may be built on.
// Pure: no database, no model client.
import { gramsOf, priceDish } from "../staple-density";
import { proteinKey, type KeptFoods } from "./kept-foods";

export type ProteinClass = "meat" | "plant" | "egg" | "pulse" | "dairy";
export interface ProteinKind { key: string; cls: ProteinClass }

// Names that describe a product made from the food, or a plant-based copy, not the food.
const NOT_THE_FOOD = /\b(sprouts?|sauces?|paste|flour|milk|noodles?|broths?|stocks?|meatless|meat[- ]free|plant[- ]based|vegan|vegetarian|veggie|imitation|substitutes?|mock|faux)\b/;
const EGG = /\beggs?\b/;
const EGG_PASTA = /\beggs?\s+(noodles?|pasta)\b/;
const NOT_BEANS = /\b(green|string|runner|vanilla|coffee|cocoa|jelly)\s+beans?\b/;

export function proteinKind(name: string): ProteinKind | null {
  const lower = name.toLowerCase();
  const meat = proteinKey(name);
  if (meat) return { key: meat, cls: "meat" };
  if (NOT_THE_FOOD.test(lower)) return null;
  for (const w of ["tofu", "tempeh", "seitan"]) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) return { key: w, cls: "plant" };
  }
  if (EGG.test(lower) && !EGG_PASTA.test(lower)) return { key: "egg", cls: "egg" };
  if (/\blentils?\b/.test(lower)) return { key: "lentil", cls: "pulse" };
  if (/\b(chickpeas?|garbanzos?)\b/.test(lower)) return { key: "chickpea", cls: "pulse" };
  if (/\bbeans?\b/.test(lower) && !NOT_BEANS.test(lower)) return { key: "bean", cls: "pulse" };
  if (/\bgreek\s+yogh?urt\b/.test(lower)) return { key: "greek yogurt", cls: "dairy" };
  if (/\bcottage\s+cheese\b/.test(lower)) return { key: "cottage cheese", cls: "dairy" };
  return null;
}

export interface DishIngredient { name: string; quantity: number | null; unit: string }

export const BUILT_ON_MIN_PROTEIN_G = 8;

export interface BuiltOn { key: string; cls: ProteinClass; name: string }

/** The protein ingredient giving the most protein; null when it gives under 8 g (one egg in pancakes is not an egg dish). */
export function builtOn(ingredients: readonly DishIngredient[], steps?: readonly string[]): BuiltOn | null {
  let best: { kind: ProteinKind; name: string; protein: number; grams: number } | null = null;
  for (const ing of ingredients) {
    const kind = proteinKind(ing.name);
    if (!kind) continue;
    const protein = priceDish([ing], steps)?.protein ?? 0;
    const grams = gramsOf(ing.name, ing.quantity, ing.unit) ?? 0;
    // Strictly greater: on a tie the earlier ingredient stays.
    if (!best || protein > best.protein || (protein === best.protein && grams > best.grams)) {
      best = { kind, name: ing.name, protein, grams };
    }
  }
  if (!best) return null;
  if (best.protein > 0 && best.protein < BUILT_ON_MIN_PROTEIN_G) return null;
  return { key: best.kind.key, cls: best.kind.cls, name: best.name };
}

export interface HomeProtein { key: string; cls: ProteinClass; name: string; favourite: boolean }

/** At-home proteins, one per key (first name wins), in kept order: proteinNames, then atHome. */
export function homeProteins(kept: KeptFoods): HomeProtein[] {
  const favKeys = new Set<string>();
  for (const f of kept.favorites) {
    const k = proteinKind(f);
    if (k) favKeys.add(k.key);
  }
  const seen = new Set<string>();
  const out: HomeProtein[] = [];
  for (const name of [...kept.proteinNames, ...kept.atHome]) {
    const kind = proteinKind(name);
    if (!kind || seen.has(kind.key)) continue;
    seen.add(kind.key);
    out.push({ key: kind.key, cls: kind.cls, name, favourite: favKeys.has(kind.key) });
  }
  return out;
}

/** The proteins a lunch or dinner may be built on. */
export function mainProteins(home: readonly HomeProtein[]): HomeProtein[] {
  const main = home.filter((p) => p.cls === "meat" || p.cls === "plant" || p.cls === "pulse");
  return main.length > 0 ? main : home.filter((p) => p.cls === "egg");
}
