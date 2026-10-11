// The daily sodium ceiling a diner is planned against, in mg of TOTAL dietary
// sodium (added salt plus what the food carries — see lib/meal-plan
// dishSodiumMg).
//
// 2,300 mg is the general guideline (FDA / WHO). Anyone with a condition in the
// profile's "Cardiovascular and cerebrovascular" group — heart disease, high
// blood pressure, high cholesterol, high triglycerides, stroke — is planned
// against 1,500 mg, the American Heart Association's ideal limit (product call
// 2026-10-08). Read from the group itself so a condition added there later is
// covered without a second list to keep in step.
import { CONDITION_GROUPS } from "@/lib/condition-groups";

export const DAILY_SODIUM_MAX_MG = 2300;
export const HEART_SODIUM_MAX_MG = 1500;

const HEART_AND_BRAIN = new Set(
  (CONDITION_GROUPS.find((g) => g.title === "Cardiovascular and cerebrovascular")?.conditions ?? []).map((c) => c.name)
);

export function dailySodiumLimitMg(conditionNames: readonly string[]): number {
  return conditionNames.some((n) => HEART_AND_BRAIN.has(n)) ? HEART_SODIUM_MAX_MG : DAILY_SODIUM_MAX_MG;
}
