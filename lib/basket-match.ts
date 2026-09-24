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
  // The basket is consulted before the staple list, exact match and tolerant
  // match alike. An ingredient the user actually owns must be attributed to
  // THEIR entry, not silently reclassified as free seasoning: the staple path
  // returns "", which drops it from coverage accounting and from What-to-buy.
  // Checking staples first turned "olive oil" into "" for a basket holding
  // "Extra virgin olive oil", and "bell pepper" into the seasoning "pepper".
  const exact = basket.find((b) => b.trim().toLowerCase() === lowered);
  if (exact !== undefined) return exact;
  const tokens = ingredientTokens(lowered);
  if (tokens.size === 0) return BASKET_STAPLES.has(lowered) ? "" : null;
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
  if (best !== null) return best;

  // Only once the basket cannot claim it: staples get the same tolerance as
  // basket entries, because the model writes "extra-virgin olive oil" and
  // "freshly ground black pepper" where the list says "olive oil" and "black
  // pepper". An exact-string staple check made the list far narrower in
  // practice than it reads, and the caller was told a dish was out-of-basket
  // over a seasoning.
  //
  // The basket MUST be tried first. Staple tokens are a subset of many real
  // foods — "pepper" ⊆ "bell pepper", "salt" ⊆ "salt cod" — so checking
  // staples earlier silently reclassified a vegetable the user actually owns
  // as free seasoning, and dropped it from What-to-buy.
  //
  // One-directional on purpose (staple ⊆ ingredient): "extra virgin olive oil"
  // ⊇ {olive, oil} is olive oil, but a bare "oil" must not match the staple
  // "olive oil" — it is too vague to resolve to a specific fat.
  if (BASKET_STAPLES.has(lowered)) return "";
  for (const st of BASKET_STAPLES) {
    const stt = ingredientTokens(st);
    if (stt.size > 0 && subset(stt, tokens)) return "";
  }
  return null;
}
