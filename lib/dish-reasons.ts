// Why a suggested dish suits this week: one reason per level rule that fires.
// Pure. Wording is about intake ("you've had little fibre this week"), never
// about the body. A rule that does not fire adds nothing — no reason is
// invented to fill the card.
//
// The fibre reason rests on WHAT IS IN the dish, never on a fibre number: the
// pricing table has no fibre column, so the only gram figure available would
// be the model's own claim. It names a fibre-rich ingredient from the list
// below and states no grams or share of the day.
import type { LevelSummary } from "@/lib/levels";

export interface DishReason {
  level: string;
  direction: "up" | "down";
  text: string;
}

/**
 * Fibre-rich ingredients, matched against the dish's (gated) ingredient names.
 * Every food noun takes `s?` — the plural trap (docs/qa/beta-test-plan.md):
 * a singular-only pattern never matches the catalog's own "Lentils".
 * Beans exclude the kinds that are not legumes eaten as pulses.
 */
const FIBRE_RICH: RegExp[] = [
  /\blentils?\b/i,
  /\bchickpeas?\b/i,
  /\bgarbanzos?\b/i,
  /\b(?<!green |string |runner |vanilla |coffee |cocoa |jelly )beans?\b/i,
  /\bedamame\b/i,
  /\b(?<!snow |snap |sugar snap )peas?\b(?! protein)/i,
  /\boats?\b(?! milk| drink)/i,
  /\boatmeal\b/i,
  /\bbarley\b/i,
  /\bquinoa\b/i,
  /\bbrown rice\b/i,
  /\bwhole[- ]?(?:wheat|grain|meal) (?:breads?|toast|pastas?|spaghetti|penne|fusilli|macaroni|tortillas?|wraps?|pitas?)\b/i,
  /\bwholemeal (?:breads?|toast|pastas?|tortillas?|wraps?|pitas?)\b/i,
  /\bchia(?: seeds?)?\b/i,
  /\bflax ?seeds?\b/i,
  /\bflax\b/i,
  /\blinseeds?\b/i,
];

/** Shown to the generator when fibre is little; the same foods the reason accepts. */
export const FIBRE_RICH_EXAMPLES =
  "lentils, chickpeas, beans, peas, oats, barley, quinoa, brown rice, whole-wheat bread or pasta, chia or flax seeds";

/** A dish "helps" sodium when one serving has this much or less. */
export const SODIUM_REASON_MAX_MG = 350;
const MAX_REASONS = 3;

/** The first ingredient (in the dish's own order) that is fibre-rich, with whether it reads as plural. */
export function fibreRichIngredient(ingredients: readonly string[]): { name: string; plural: boolean } | null {
  for (const name of ingredients) {
    for (const re of FIBRE_RICH) {
      const m = name.match(re);
      if (m) return { name: name.trim(), plural: /s$/i.test(m[0]) };
    }
  }
  return null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * `dish.sodium` must be null unless the dish's sodium is completely known
 * (fully priced, every salty seasoning weighed) — then there is no sodium
 * reason, because there is no number to back it.
 */
export function dishReasons(
  dish: { ingredients: readonly string[]; sodium: number | null },
  summary: LevelSummary,
): DishReason[] {
  const reasons: DishReason[] = [];
  if (summary.little.includes("fibre")) {
    const rich = fibreRichIngredient(dish.ingredients);
    if (rich) {
      reasons.push({
        level: "fibre",
        direction: "up",
        text: `${capitalize(rich.name)} ${rich.plural ? "are" : "is"} rich in fibre, and you've had little this week.`,
      });
    }
  }
  if (summary.aLot.includes("sodium") && dish.sodium !== null && dish.sodium <= SODIUM_REASON_MAX_MG) {
    reasons.push({
      level: "sodium",
      direction: "down",
      text: `Only ${Math.round(dish.sodium)} mg of sodium per serving, and you've had a lot of sodium this week.`,
    });
  }
  return reasons.slice(0, MAX_REASONS);
}
