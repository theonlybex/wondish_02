// Library dishes carry portion-variant suffixes from the import sheet —
// "Scrambled Eggs, V1S- 1 egg", "Green Apple, V1", "Almonds , V1- 1/4 cup".
// The suffix is an internal id, not a name; strip it wherever a dish is shown
// (plan cards, weekly grid, journal, Clara's plan text).
// The suffix appears in several shapes in the import sheet:
//   ", V1"            ", V11"
//   ", V1S- 1 egg"    ", V1M- 3/4 cup, cooked unsalted"
//   ", V1-Plain"      ", V1. Plain"   ", V6. Decaf"
//   ", V2,5M- 4 oz plant-based ground beef."  (a comma inside the code itself)
// The dot form was missing, so "Black coffee, V1. Plain" reached /pantry cards
// intact (QA cycle 8). Anything after the code is part of the code's label.
const VARIANT_SUFFIX = /\s*,\s*V\d+(?:[,.]\d+)?[A-Za-z]*(?:\s*[-.].*)?$/;

export function displayDishName(name: string): string {
  const cleaned = name.replace(VARIANT_SUFFIX, "").trim();
  return cleaned || name.trim();
}

/**
 * An amount and its unit, written the way a person would.
 *
 * The stored unit is singular — it is a unit, not a phrase — so the card read
 * "2 slice", "2 egg", "2 cup" and "1 whole" on about 25 rows (QA 2026-09-25).
 * Mass and volume abbreviations never take an s ("2 g", not "2 gs"), and
 * "whole" is an adjective standing in for the food itself, which reads better
 * as a bare count: "2 Roma tomatoes", not "2 whole".
 */
const NEVER_PLURAL = /^(g|gr|gram|grams|kg|ml|l|oz|lb|lbs|tsp|tbsp)$/i;
const DROP_ENTIRELY = /^(whole|each|unit|units|item|items)$/i;

/**
 * A quantity as a cook writes it: ⅓, not 0.3333.
 *
 * Recipe amounts are stored as floats because they are scaled by arithmetic,
 * and a third of a cup has no exact float. The catalog holds 0.33, 0.3333 and
 * 0.666666, all meaning the mark on the measuring cup — and the card printed
 * them literally. The amount backfill of 2026-09-25 made this urgent rather
 * than cosmetic: snapping to real kitchen fractions writes MORE thirds, so a
 * repair aimed at "0.37 tablespoon" would have shipped "0.3333 tablespoon" if
 * the display had stayed as it was.
 *
 * Only the fractions a measuring set has (see KITCHEN_FRACTIONS in
 * lib/dish-plausibility.ts), and only within a tolerance wide enough to catch
 * the short forms already stored. Anything else prints as the number it is —
 * a made-up fraction would be a lie about an amount, which is the whole thing
 * this is trying to stop.
 */
const VULGAR: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
];

export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity <= 0) return `${quantity}`;
  const whole = Math.floor(quantity + 1e-9);
  const frac = quantity - whole;
  if (frac < 0.011) return `${whole}`;
  const match = VULGAR.find(([v]) => Math.abs(frac - v) < 0.011);
  if (!match) {
    // Not a kitchen fraction: print at most two decimals, and without the
    // trailing zeros a raw float carries.
    return `${Math.round(quantity * 100) / 100}`;
  }
  return whole > 0 ? `${whole}${match[1]}` : match[1];
}

export function formatAmount(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity == null || !Number.isFinite(quantity)) return "";
  const u = (unit ?? "").trim();
  const q = formatQuantity(quantity);
  if (!u || DROP_ENTIRELY.test(u)) return q;
  // Pluralise on the NUMBER, not on its printed form: "½ cup" is singular and
  // so is "1 cup", while "1½ cups" is not.
  if (NEVER_PLURAL.test(u) || quantity <= 1) return `${q} ${u}`;
  // Already plural, or a word ending that pluralises irregularly enough to
  // leave alone.
  if (/s$/i.test(u)) return `${q} ${u}`;
  if (/(ch|sh|x|z)$/i.test(u)) return `${q} ${u}es`; // pinch → pinches
  return `${q} ${u}s`;
}
