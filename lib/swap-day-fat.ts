/**
 * Whether a swap candidate takes the day past its fat ceiling.
 *
 * A candidate may not push the day over `budget × tolerance` — unless the day
 * was already there and the candidate still carries no more fat than the dish
 * it replaces: refusing an improvement costs the user a swap and leaves them
 * worse off. Extracted from the Clara swap route, where the budget was computed
 * and never read until QA saw a day at 162% of its fat target (cycle 17).
 */
export function swapPushesDayFat(a: {
  otherFatG: number;
  candidateFatG: number;
  replacedFatG: number;
  dayFatBudgetG: number;
  tolerance: number;
}): boolean {
  if (!(a.dayFatBudgetG > 0)) return false;
  if (a.otherFatG + a.candidateFatG <= a.dayFatBudgetG * a.tolerance) return false;
  return a.candidateFatG > a.replacedFatG;
}
