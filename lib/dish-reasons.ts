// Why a suggested dish suits this week: one reason per level rule that fires.
// Pure. Wording is about intake ("you've had little fibre this week"), never
// about the body. A rule that does not fire adds nothing — no reason is
// invented to fill the card.
import { FIBRE_TARGET_G, type LevelSummary } from "@/lib/levels";

export interface DishReason {
  level: string;
  direction: "up" | "down";
  text: string;
}

/** A dish "helps" fibre when one serving gives a quarter of the 28 g target. */
export const FIBRE_REASON_MIN_G = FIBRE_TARGET_G * 0.25;
/** A dish "helps" sodium when one serving has this much or less. */
export const SODIUM_REASON_MAX_MG = 350;
const MAX_REASONS = 3;

/**
 * `perServing.sodium` is null when the dish could not be priced from its
 * amounts; then there is no sodium reason, because there is no number to back it.
 */
export function dishReasons(
  perServing: { fibre: number; sodium: number | null },
  summary: LevelSummary,
): DishReason[] {
  const reasons: DishReason[] = [];
  if (summary.little.includes("fibre") && perServing.fibre >= FIBRE_REASON_MIN_G) {
    reasons.push({
      level: "fibre",
      direction: "up",
      text: `${Math.round(perServing.fibre)} g of fibre per serving, and you've had little fibre this week.`,
    });
  }
  if (summary.aLot.includes("sodium") && perServing.sodium !== null && perServing.sodium <= SODIUM_REASON_MAX_MG) {
    reasons.push({
      level: "sodium",
      direction: "down",
      text: `Only ${Math.round(perServing.sodium)} mg of sodium per serving, and you've had a lot of sodium this week.`,
    });
  }
  return reasons.slice(0, MAX_REASONS);
}
