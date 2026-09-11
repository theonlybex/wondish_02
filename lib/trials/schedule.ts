// Trigger-trial schedule (workbook 04 "Trial Schedule" v1), pure.
//
//   BASELINE        the `baselineDays` before day 1 (usual diet, log symptoms)
//   ELIMINATION     days 1 … trialDays-1   (trigger removed from the plan)
//   EVALUATION      day trialDays          (compare with baseline; still removed)
//   REINTRODUCTION  next reintroductionDays (challenge: trigger allowed)
//   WASHOUT         next washoutDays        (removed again, observe)
//   FINAL           afterwards, until the user classifies the result
//
// Dates are local calendar days; day arithmetic uses UTC noon so DST
// changes never shift a day boundary.

export type TrialPhase = "BASELINE" | "ELIMINATION" | "EVALUATION" | "REINTRODUCTION" | "WASHOUT" | "FINAL";

export const ENFORCED_PHASES: ReadonlySet<TrialPhase> = new Set<TrialPhase>(["ELIMINATION", "EVALUATION", "WASHOUT", "FINAL"]);
export const PHASE_ORDER: readonly TrialPhase[] = ["BASELINE", "ELIMINATION", "EVALUATION", "REINTRODUCTION", "WASHOUT", "FINAL"];

export interface ScheduleRule {
  baselineDays: number;
  trialDays: number;
  reintroductionDays: number;
  washoutDays: number;
}

export interface PhaseInfo {
  phase: TrialPhase;
  dayNumber: number;      // 1 on startDate; 0 and below during baseline
  dayInPhase: number;     // 1-based within the phase
  phaseLength: number;    // days in the phase (FINAL: 0 = open-ended)
  nextPhaseOn: Date | null;
}

export function localDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const utcNoon = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 1 on startDate, 2 the day after, 0 the day before. */
export function dayNumber(startDate: Date, today: Date): number {
  return Math.round((utcNoon(today) - utcNoon(startDate)) / 86_400_000) + 1;
}

export function isEnforced(phase: TrialPhase): boolean {
  return ENFORCED_PHASES.has(phase);
}

export function phaseWindows(rule: ScheduleRule, startDate: Date): Record<TrialPhase, { from: Date; to: Date | null }> {
  const start = localDay(startDate);
  const evalDay = rule.trialDays;                                // day 28
  const reintroFrom = evalDay + 1;                               // 29
  const reintroTo = evalDay + rule.reintroductionDays;           // 31
  const washoutFrom = reintroTo + 1;                             // 32
  const washoutTo = reintroTo + rule.washoutDays;                // 34
  const day = (n: number) => addDays(start, n - 1);
  return {
    BASELINE: { from: addDays(start, -rule.baselineDays), to: addDays(start, -1) },
    ELIMINATION: { from: day(1), to: day(evalDay - 1) },
    EVALUATION: { from: day(evalDay), to: day(evalDay) },
    REINTRODUCTION: { from: day(reintroFrom), to: day(reintroTo) },
    WASHOUT: { from: day(washoutFrom), to: day(washoutTo) },
    FINAL: { from: day(washoutTo + 1), to: null },
  };
}

export function phaseFor(rule: ScheduleRule, startDate: Date, today: Date): PhaseInfo {
  const n = dayNumber(startDate, today);
  const w = phaseWindows(rule, startDate);
  const evalDay = rule.trialDays;
  const reintroTo = evalDay + rule.reintroductionDays;
  const washoutTo = reintroTo + rule.washoutDays;

  if (n < 1) {
    const dayInPhase = n + rule.baselineDays; // n = -6 → 1 … n = 0 → 7 (baselineDays 7)
    return { phase: "BASELINE", dayNumber: n, dayInPhase: Math.max(1, dayInPhase), phaseLength: rule.baselineDays, nextPhaseOn: w.ELIMINATION.from };
  }
  if (n < evalDay) return { phase: "ELIMINATION", dayNumber: n, dayInPhase: n, phaseLength: evalDay - 1, nextPhaseOn: w.EVALUATION.from };
  if (n === evalDay) return { phase: "EVALUATION", dayNumber: n, dayInPhase: 1, phaseLength: 1, nextPhaseOn: w.REINTRODUCTION.from };
  if (n <= reintroTo) return { phase: "REINTRODUCTION", dayNumber: n, dayInPhase: n - evalDay, phaseLength: rule.reintroductionDays, nextPhaseOn: w.WASHOUT.from };
  if (n <= washoutTo) return { phase: "WASHOUT", dayNumber: n, dayInPhase: n - reintroTo, phaseLength: rule.washoutDays, nextPhaseOn: w.FINAL.from };
  return { phase: "FINAL", dayNumber: n, dayInPhase: n - washoutTo, phaseLength: 0, nextPhaseOn: null };
}

/** Start date for a trial begun today: elimination starts after the baseline unless skipped. */
export function startDateFor(rule: ScheduleRule, today: Date, skipBaseline: boolean): Date {
  return addDays(localDay(today), skipBaseline ? 0 : rule.baselineDays);
}
