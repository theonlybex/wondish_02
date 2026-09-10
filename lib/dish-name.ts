// Library dishes carry portion-variant suffixes from the import sheet —
// "Scrambled Eggs, V1S- 1 egg", "Green Apple, V1", "Almonds , V1- 1/4 cup".
// The suffix is an internal id, not a name; strip it wherever a dish is shown
// (plan cards, weekly grid, journal, Clara's plan text).
const VARIANT_SUFFIX = /\s*,\s*V\d+[A-Za-z]*(?:\s*-.*)?$/;

export function displayDishName(name: string): string {
  const cleaned = name.replace(VARIANT_SUFFIX, "").trim();
  return cleaned || name.trim();
}
