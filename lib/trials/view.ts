// Read model for one trigger trial: phase, per-phase symptom scores, the
// workbook's suggestion and the terms currently removed. Pure — the API
// route loads rows and hands them in.
import { phaseFor, phaseWindows, isEnforced, localDay, type PhaseInfo, type TrialPhase } from "./schedule";
import { dayScore, phaseScore, evaluate, classify, type Severity, type EvaluationSuggestion, type SuggestedClassification } from "./score";
import { termsForCategory, categoryTitle } from "./category-terms";

export interface TrialEntryLite {
  date: Date;
  symptoms: { trackingItemId: string; severity: Severity }[];
}

export interface TrialRowLite {
  id: string;
  startDate: Date;
  status: "ACTIVE" | "STOPPED" | "COMPLETED";
  classification: "TOLERATED" | "DOSE_DEPENDENT" | "LIKELY_TRIGGER" | null;
  baselineScore: number | null;
  eliminationScore: number | null;
  challengeScore: number | null;
  notes: string | null;
  createdAt: Date;
}

export interface TrialRuleLite {
  id: string;
  code: string;
  category: string;
  conditionName: string;
  examples: string;
  safetyNote: string | null;
  sourceUrl: string | null;
  baselineDays: number;
  trialDays: number;
  reintroductionDays: number;
  washoutDays: number;
  monitoredIds: string[];
}

export interface TrialView {
  id: string;
  ruleId: string;
  category: string;
  title: string;
  conditionName: string;
  status: TrialRowLite["status"];
  classification: TrialRowLite["classification"];
  startDate: string; // YYYY-MM-DD
  phase: { phase: TrialPhase; dayNumber: number; dayInPhase: number; phaseLength: number; nextPhaseOn: string | null; enforced: boolean };
  windows: Record<TrialPhase, { from: string; to: string | null }>;
  scores: { baseline: number | null; elimination: number | null; challenge: number | null; loggedDays: { baseline: number; elimination: number; challenge: number } };
  evaluation: { improvementPct: number | null; suggestion: EvaluationSuggestion };
  suggestedClassification: SuggestedClassification | null;
  terms: string[];
  examples: string;
  safetyNote: string | null;
  sourceUrl: string | null;
  notes: string | null;
  canClassify: boolean;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function inWindow(d: Date, w: { from: Date; to: Date | null }): boolean {
  const t = localDay(d).getTime();
  return t >= w.from.getTime() && (w.to === null || t <= w.to.getTime());
}

/** Last `n` days of a window, clipped to `today` when the window is still running. */
function tail(w: { from: Date; to: Date | null }, today: Date, n: number): { from: Date; to: Date | null } {
  const end = w.to && w.to.getTime() < localDay(today).getTime() ? w.to : localDay(today);
  const from = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (n - 1));
  return { from: from.getTime() > w.from.getTime() ? from : w.from, to: end };
}

export function buildTrialView(input: { trial: TrialRowLite; rule: TrialRuleLite; entries: TrialEntryLite[]; today: Date }): TrialView {
  const { trial, rule, entries, today } = input;
  const p: PhaseInfo = phaseFor(rule, trial.startDate, today);
  const w = phaseWindows(rule, trial.startDate);
  const monitored = new Set(rule.monitoredIds);

  const scoresIn = (win: { from: Date; to: Date | null }) => {
    const days = entries.filter((e) => inWindow(e.date, win)).map((e) => dayScore(e.symptoms, monitored));
    return { score: phaseScore(days), logged: days.filter((d) => d !== null).length };
  };
  const baseline = scoresIn(w.BASELINE);
  const elimination = scoresIn(tail(w.ELIMINATION, today, 14));
  const challenge = scoresIn(w.REINTRODUCTION);

  const scores = {
    baseline: trial.baselineScore ?? baseline.score,
    elimination: trial.eliminationScore ?? elimination.score,
    challenge: trial.challengeScore ?? challenge.score,
    loggedDays: { baseline: baseline.logged, elimination: elimination.logged, challenge: challenge.logged },
  };
  const evaluation = evaluate({ baseline: scores.baseline, elimination: scores.elimination });
  const suggestedClassification = classify({ elimination: scores.elimination, challenge: scores.challenge });
  const phaseIdx = ["BASELINE", "ELIMINATION", "EVALUATION", "REINTRODUCTION", "WASHOUT", "FINAL"].indexOf(p.phase);

  return {
    id: trial.id,
    ruleId: rule.id,
    category: rule.category,
    title: categoryTitle(rule.category),
    conditionName: rule.conditionName,
    status: trial.status,
    classification: trial.classification,
    startDate: iso(localDay(trial.startDate)),
    phase: { ...p, nextPhaseOn: p.nextPhaseOn ? iso(p.nextPhaseOn) : null, enforced: isEnforced(p.phase) },
    windows: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, { from: iso(v.from), to: v.to ? iso(v.to) : null }])) as TrialView["windows"],
    scores,
    evaluation,
    suggestedClassification,
    terms: termsForCategory(rule.category).terms,
    examples: rule.examples,
    safetyNote: rule.safetyNote,
    sourceUrl: rule.sourceUrl,
    notes: trial.notes,
    // The user may classify from the evaluation day onwards.
    canClassify: trial.status === "ACTIVE" && phaseIdx >= 2,
  };
}
