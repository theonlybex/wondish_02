// Pure, dependency-free cuisine constants — safe to import from client
// components (unlike lib/clara/recipe-generation.ts, which pulls in Prisma
// and the Anthropic SDK).

export const CUISINES = [
  "Surprise me",
  "Italian",
  "Mexican",
  "Chinese",
  "Thai",
  "Indian",
  "Japanese",
  "Mediterranean",
  "American",
  "French",
  "Korean",
  "Middle Eastern",
] as const;

export type Cuisine = (typeof CUISINES)[number];

/** A real cuisine constraint, or null for "Surprise me"/unset. */
export function normalizeCuisine(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = CUISINES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  if (!match || match === "Surprise me") return null;
  return match;
}
