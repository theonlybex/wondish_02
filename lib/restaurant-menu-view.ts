// Phase 2 web — presentation rules for the consumer restaurant menu
// (docs/restaurants/phase-2.md). Pure and unit-tested on purpose: this is the
// surface that makes allergy-relevant claims about third-party food, so the
// rules that decide what a diner is told live here, not scattered in JSX.
//
// Two invariants the tests pin:
//   1. A dish is "fits" only on positive evidence — a null verdict (signed
//      out, or no patient profile) is "unknown", never "fits".
//   2. A failing dish always carries a readable reason. Colour/graying alone
//      would fail WCAG "don't convey meaning by colour" and, worse, would tell
//      an allergic diner nothing about WHY.

import type { Violation, BanSource } from "@/lib/diet-match";
import type { Verdict, DishDTO } from "@/lib/restaurants";

export type VerdictState = "fits" | "doesntFit" | "unknown";

export function dishVerdictState(verdict: Verdict | null): VerdictState {
  if (verdict == null) return "unknown";
  return verdict.passed ? "fits" : "doesntFit";
}

const SOURCE_LABEL: Record<BanSource, string> = {
  allergy: "allergy",
  avoid: "you avoid this",
  condition: "health condition",
  preference: "food preference",
  motivation: "your goal",
};

export function describeViolation(v: Violation): string {
  return `Contains ${v.ingredient} — ${SOURCE_LABEL[v.source]}`;
}

/// One line for a badge. Allergies lead regardless of match order — they are
/// the highest-stakes reason a dish is refused, and the badge has room for one.
export function summarizeViolations(violations: readonly Violation[]): string | null {
  if (violations.length === 0) return null;
  const lead = violations.find((v) => v.source === "allergy") ?? violations[0];
  const rest = violations.length - 1;
  return rest > 0 ? `${describeViolation(lead)} +${rest} more` : describeViolation(lead);
}

export interface MenuSection {
  section: string;
  dishes: DishDTO[];
}

/// Sections in first-seen order (the query already orders by section, then
/// sortOrder), dishes by sortOrder within each. A dish with no section still
/// renders — under a neutral heading rather than vanishing from the menu.
export function groupDishesBySection(dishes: readonly DishDTO[]): MenuSection[] {
  const order: string[] = [];
  const bySection = new Map<string, DishDTO[]>();

  for (const dish of dishes) {
    const key = dish.section?.trim() ? dish.section : "Menu";
    if (!bySection.has(key)) {
      bySection.set(key, []);
      order.push(key);
    }
    bySection.get(key)!.push(dish);
  }

  return order.map((section) => ({
    section,
    dishes: [...bySection.get(section)!].sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}
