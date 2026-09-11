// Which trigger rules a patient may start a trial on, pure.

export interface RuleLite {
  id: string;
  code: string;
  category: string;
  conditionName: string;
  active: boolean;
}

export interface TrialLite {
  ruleId: string;
  category: string;
  status: "ACTIVE" | "STOPPED" | "COMPLETED";
  classification: string | null;
}

/**
 * Active rules whose condition is on the profile, minus categories that are
 * already being trialled or already classified as a likely trigger. One rule
 * per category (two conditions can share ALCOHOL; the first wins).
 */
export function eligibleRules(conditionNames: readonly string[], rules: readonly RuleLite[], trials: readonly TrialLite[]): RuleLite[] {
  const conditions = new Set(conditionNames.map((n) => n.trim().toLowerCase()));
  const blocked = new Set(
    trials
      .filter((t) => t.status === "ACTIVE" || (t.status === "COMPLETED" && t.classification === "LIKELY_TRIGGER"))
      .map((t) => t.category)
  );
  const seen = new Set<string>();
  const out: RuleLite[] = [];
  for (const r of rules) {
    if (!r.active || !conditions.has(r.conditionName.trim().toLowerCase())) continue;
    if (blocked.has(r.category) || seen.has(r.category)) continue;
    seen.add(r.category);
    out.push(r);
  }
  return out;
}

/** A trial may only be started on a rule whose condition is on the profile. */
export function mayStart(conditionNames: readonly string[], rule: RuleLite): boolean {
  return rule.active && conditionNames.some((n) => n.trim().toLowerCase() === rule.conditionName.trim().toLowerCase());
}
