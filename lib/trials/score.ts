// Symptom scoring for trigger trials, pure. The app suggests, the user
// decides: every function here returns a suggestion, never a decision.

export type Severity = "NOT_PRESENT" | "MILD" | "MODERATE" | "SEVERE";

export const SEVERITY_SCORE: Record<Severity, number> = { NOT_PRESENT: 0, MILD: 1, MODERATE: 2, SEVERE: 3 };

export const MIN_LOGGED_DAYS = 3;
export const IMPROVEMENT_THRESHOLD_PCT = 30;
export const TRIGGER_DELTA = 0.5;

/** Mean severity over the rule's monitored items logged that day; null when none logged. */
export function dayScore(rows: readonly { trackingItemId: string; severity: Severity }[], monitoredIds: ReadonlySet<string>): number | null {
  const scores = rows.filter((r) => monitoredIds.has(r.trackingItemId)).map((r) => SEVERITY_SCORE[r.severity]);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Mean of the logged day scores; null under MIN_LOGGED_DAYS logged days. */
export function phaseScore(dayScores: readonly (number | null)[]): number | null {
  const logged = dayScores.filter((d): d is number => d !== null);
  if (logged.length < MIN_LOGGED_DAYS) return null;
  return logged.reduce((a, b) => a + b, 0) / logged.length;
}

export type EvaluationSuggestion = "PROCEED" | "STOP_RESTRICTION" | "INSUFFICIENT_DATA";

/** Baseline vs elimination (workbook: "if symptoms did not improve, stop the unnecessary restriction"). */
export function evaluate(a: { baseline: number | null; elimination: number | null }): { improvementPct: number | null; suggestion: EvaluationSuggestion } {
  if (a.baseline === null || a.elimination === null) return { improvementPct: null, suggestion: "INSUFFICIENT_DATA" };
  if (a.baseline === 0) {
    // Nothing to improve on: treat "still nothing" as improved enough to test.
    return { improvementPct: a.elimination === 0 ? 100 : 0, suggestion: a.elimination === 0 ? "PROCEED" : "STOP_RESTRICTION" };
  }
  const pct = ((a.baseline - a.elimination) / a.baseline) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return { improvementPct: rounded, suggestion: rounded >= IMPROVEMENT_THRESHOLD_PCT ? "PROCEED" : "STOP_RESTRICTION" };
}

export type SuggestedClassification = "TOLERATED" | "LIKELY_TRIGGER";

/** Challenge (reintroduction) vs elimination. DOSE_DEPENDENT is only ever chosen by the user. */
export function classify(a: { elimination: number | null; challenge: number | null }): SuggestedClassification | null {
  if (a.elimination === null || a.challenge === null) return null;
  return a.challenge > a.elimination + TRIGGER_DELTA ? "LIKELY_TRIGGER" : "TOLERATED";
}
