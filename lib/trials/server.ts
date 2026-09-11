import "server-only";
import { prisma } from "@/lib/db";
import { phaseFor, isEnforced, localDay, addDays, type TrialPhase } from "@/lib/trials/schedule";
import { buildTrialView, type TrialView } from "@/lib/trials/view";
import type { Severity } from "@/lib/trials/score";

// Prisma-facing helpers shared by /api/trials and /api/trials/[id]. Route
// files may only export HTTP handlers, so the shared pieces live here.

export const TRIAL_INCLUDE = {
  rule: { include: { condition: { select: { name: true } }, monitored: { select: { trackingItemId: true } } } },
} as const;

export async function loadTrialPatient(userId: string) {
  return prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: {
      id: true,
      mealPlanStale: true,
      healthConditions: { select: { condition: { select: { name: true } } } },
      triggerTrials: { include: TRIAL_INCLUDE, orderBy: { createdAt: "desc" } },
    },
  });
}
export type TrialPatientRow = NonNullable<Awaited<ReturnType<typeof loadTrialPatient>>>;
export type TrialRow = TrialPatientRow["triggerTrials"][number];

export function ruleLite(r: TrialRow["rule"]) {
  return {
    id: r.id, code: r.code, category: r.category, conditionName: r.condition.name, examples: r.examples, safetyNote: r.safetyNote, sourceUrl: r.sourceUrl,
    baselineDays: r.baselineDays, trialDays: r.trialDays, reintroductionDays: r.reintroductionDays, washoutDays: r.washoutDays,
    monitoredIds: r.monitored.map((m) => m.trackingItemId),
  };
}

export async function trialViewFor(patientId: string, t: TrialRow, today: Date): Promise<TrialView> {
  const from = addDays(localDay(new Date(t.startDate)), -t.rule.baselineDays);
  const entries = await prisma.journalEntry.findMany({
    where: { patientId, date: { gte: from }, symptoms: { some: {} } },
    select: { date: true, symptoms: { select: { trackingItemId: true, severity: true } } },
  });
  return buildTrialView({
    trial: { id: t.id, startDate: t.startDate, status: t.status, classification: t.classification, baselineScore: t.baselineScore, eliminationScore: t.eliminationScore, challengeScore: t.challengeScore, notes: t.notes, createdAt: t.createdAt },
    rule: ruleLite(t.rule),
    entries: entries.map((e) => ({ date: e.date, symptoms: e.symptoms.map((s) => ({ trackingItemId: s.trackingItemId, severity: s.severity as Severity })) })),
    today,
  });
}

/** Lazy phase tracking: when the phase changed since the last read and enforcement flipped, the plan is stale. */
export async function syncTrialPhase(patientId: string, t: TrialRow, today: Date): Promise<TrialPhase> {
  const phase = phaseFor(t.rule, new Date(t.startDate), today).phase;
  if (t.status !== "ACTIVE" || t.lastPhase === phase) return phase;
  const flipped = t.lastPhase === null ? isEnforced(phase) : isEnforced(t.lastPhase as TrialPhase) !== isEnforced(phase);
  await prisma.$transaction([
    prisma.triggerTrial.update({ where: { id: t.id }, data: { lastPhase: phase } }),
    ...(flipped ? [prisma.patient.update({ where: { id: patientId }, data: { mealPlanStale: true } })] : []),
  ]);
  return phase;
}
