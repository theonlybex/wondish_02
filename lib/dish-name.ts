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
