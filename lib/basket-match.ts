// Tolerant "is this ingredient in the basket?" matching — pure.
//
// The generation prompt lists the basket by exact catalog name ("Boneless
// chicken breasts", "Extra virgin olive oil", "Yellow onions") but the model
// paraphrases ("chicken breast", "olive oil", "onion"). An exact lowercase
// comparison rejected 12 of 28 generated dishes as out-of-basket and left a
// week with no lunches (2026-09-11). Two names match when, after dropping
// descriptor words and singularising, one's token set contains the other's.
import { singularize } from "@/lib/diet-match";
import { BASKET_STAPLES } from "@/lib/basket-coverage";

// Words that describe a form or grade, not the food itself.
const DESCRIPTORS = new Set([
  "boneless", "skinless", "fresh", "frozen", "sliced", "canned", "tinned", "large", "small", "medium",
  "extra", "virgin", "plain", "raw", "dried", "chopped", "diced", "minced", "cooked", "unsalted", "salted",
  "organic", "ripe", "baby", "yellow", "whole", "grain", "lean", "skin-on", "bone-in",
  "leaf", "leaves", "florets", "cloves", "clove", "of", "and", "the", "a",
]);
// Cuts stay significant on purpose: "chicken thighs" must NOT match a basket
// that only holds "Boneless chicken breasts".

export function ingredientTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of name.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/)) {
    const t = raw.trim();
    if (!t || DESCRIPTORS.has(t)) continue;
    out.add(singularize(t));
  }
  return out;
}

const subset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));

/**
 * Returns the basket entry `name` corresponds to (exact name first, then the
 * tolerant token match), or "" when it is a free staple, or null when the
 * ingredient is outside the basket.
 */
export function findBasketMatch(name: string, basket: readonly string[]): string | "" | null {
  const lowered = name.trim().toLowerCase();
  if (!lowered) return null;
  if (BASKET_STAPLES.has(lowered)) return "";
  const exact = basket.find((b) => b.trim().toLowerCase() === lowered);
  if (exact !== undefined) return exact;
  const tokens = ingredientTokens(lowered);
  if (tokens.size === 0) return null;
  // Prefer the basket entry sharing the most tokens; ties → shortest name.
  let best: string | null = null;
  let bestScore = 0;
  for (const b of basket) {
    const bt = ingredientTokens(b);
    if (bt.size === 0) continue;
    if (!(subset(tokens, bt) || subset(bt, tokens))) continue;
    const score = Math.min(tokens.size, bt.size) * 10 - Math.abs(tokens.size - bt.size);
    if (score > bestScore || (score === bestScore && best !== null && b.length < best.length)) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}
