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

export function formatAmount(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity == null || !Number.isFinite(quantity)) return "";
  const u = (unit ?? "").trim();
  if (!u || DROP_ENTIRELY.test(u)) return `${quantity}`;
  if (NEVER_PLURAL.test(u) || quantity === 1) return `${quantity} ${u}`;
  // Already plural, or a word ending that pluralises irregularly enough to
  // leave alone.
  if (/s$/i.test(u)) return `${quantity} ${u}`;
  if (/(ch|sh|x|z)$/i.test(u)) return `${quantity} ${u}es`; // pinch → pinches
  return `${quantity} ${u}s`;
}
