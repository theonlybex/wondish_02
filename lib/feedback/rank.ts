// Which problems matter most: severity × distinct reporters (people, not
// volume — the Clara gaps rule) × recency. CRITICAL always sorts first.
import type { FeedbackSeverity, FeedbackStatus } from "@prisma/client";

const WEIGHT: Record<FeedbackSeverity, number> = { CRITICAL: 100, HIGH: 20, MEDIUM: 5, LOW: 1 };
export type RankableIssue = { id: string; severity: FeedbackSeverity; status: FeedbackStatus; reports: { patientId: string; createdAt: Date }[] };

const lastSeenOf = (i: RankableIssue) => (i.reports.length ? new Date(Math.max(...i.reports.map((r) => r.createdAt.getTime()))) : null);

export function issueScore(i: RankableIssue, now: Date): number {
  const reporters = new Set(i.reports.map((r) => r.patientId)).size;
  const last = lastSeenOf(i);
  if (!last || reporters === 0) return 0;
  const age = (now.getTime() - last.getTime()) / 86400000;
  const recency = age <= 7 ? 1 : age <= 30 ? 0.5 : 0.25;
  return WEIGHT[i.severity] * reporters * recency;
}

export function rankIssues<T extends RankableIssue>(issues: T[], now: Date) {
  const scored = issues.map((i) => ({ ...i, score: issueScore(i, now), reporters: new Set(i.reports.map((r) => r.patientId)).size, lastSeen: lastSeenOf(i) }));
  const byRank = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    Number(b.severity === "CRITICAL") - Number(a.severity === "CRITICAL") || b.score - a.score || (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0);
  return {
    open: scored.filter((i) => i.status === "NEW" || i.status === "INVESTIGATING").sort(byRank),
    closed: scored.filter((i) => i.status === "FIXED" || i.status === "WONT_FIX").sort(byRank),
  };
}
