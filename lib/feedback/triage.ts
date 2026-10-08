// Runs the triage bot on one saved report and files it under an issue.
// Never throws: a model failure or timeout leaves the report saved as FAILED
// for retryPendingTriage (admin page load / "Retry triage").
import { prisma } from "@/lib/db";
import { createAnthropic } from "@/lib/anthropic";
import { TRIAGE_TOOL, buildTriageMessage, parseTriage, maxSeverity, type OpenIssueBrief } from "./triage-parse";
import { isSafetyReport } from "./safety";

export type TriageCaller = (message: string) => Promise<unknown>;
const TRIAGE_TIMEOUT_MS = 8000;
const MAX_TRIES = 3;

export const defaultTriageCaller: TriageCaller = async (message) => {
  const client = createAnthropic({ timeout: TRIAGE_TIMEOUT_MS, maxRetries: 0 });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: "You triage bug reports for Wondish, a nutrition and meal-planning app. Be terse and factual.",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [TRIAGE_TOOL as any],
    tool_choice: { type: "tool", name: TRIAGE_TOOL.name },
    messages: [{ role: "user", content: message }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no tool_use in triage response");
  return block.input;
};

let callerOverride: TriageCaller | null = null;
/** Simulation/tests only: replace the model call (routes call triageReport without a caller). */
export function setTriageCallerForTests(fn: TriageCaller | null) {
  callerOverride = fn;
}
const pickCaller = (call?: TriageCaller) => call ?? callerOverride ?? defaultTriageCaller;

const withTimeout = <T,>(p: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`triage timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
};

/** Categorise one saved report and attach it to an issue. Never throws. */
export async function triageReport(reportId: string, call?: TriageCaller): Promise<"DONE" | "FAILED"> {
  const report = await prisma.feedbackReport.findUnique({ where: { id: reportId } });
  if (!report || report.triage === "DONE") return "DONE";
  const openRows = await prisma.feedbackIssue.findMany({
    where: { status: { in: ["NEW", "INVESTIGATING"] } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, category: true },
  });
  const open: OpenIssueBrief[] = openRows.map((o) => ({ id: o.id, title: o.title, category: o.category }));
  try {
    const message = buildTriageMessage({ text: report.text, area: report.area, context: (report.context ?? {}) as Record<string, unknown> }, open);
    const raw = await withTimeout(pickCaller(call)(message), TRIAGE_TIMEOUT_MS);
    const t = parseTriage(raw, report.text, open);
    await prisma.$transaction(async (tx) => {
      let issueId = t.duplicateOf;
      if (issueId) {
        const issue = await tx.feedbackIssue.findUnique({ where: { id: issueId }, select: { severity: true } });
        if (issue) await tx.feedbackIssue.update({ where: { id: issueId }, data: { severity: maxSeverity(issue.severity, t.severity) } });
        else issueId = null;
      }
      if (!issueId) {
        issueId = (await tx.feedbackIssue.create({ data: { title: t.title, category: t.category, severity: t.severity }, select: { id: true } })).id;
      }
      await tx.feedbackReport.update({ where: { id: report.id }, data: { issueId, triage: "DONE", triageNote: t.reasoning || null, triageTries: { increment: 1 } } });
    });
    return "DONE";
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    // The safety rule needs no model: an allergy/diet report is filed as
    // CRITICAL even during an outage, so it is counted and ranked first
    // instead of waiting in "Untriaged" (final review, 2026-10-07).
    if (isSafetyReport(report.text)) {
      const issue = await prisma.feedbackIssue.create({
        data: { title: report.text.trim().split("\n")[0].slice(0, 90), category: "SAFETY_FOOD", severity: "CRITICAL" },
        select: { id: true },
      });
      await prisma.feedbackReport.update({
        where: { id: report.id },
        data: { issueId: issue.id, triage: "DONE", triageNote: `Filed by the safety rule; model failed: ${why}`, triageTries: { increment: 1 } },
      });
      return "DONE";
    }
    await prisma.feedbackReport.update({
      where: { id: report.id },
      data: { triage: "FAILED", triageNote: why, triageTries: { increment: 1 } },
    });
    return "FAILED";
  }
}

/** Retry untriaged reports (admin page load / "Retry triage"). */
export async function retryPendingTriage(limit = 5, call?: TriageCaller): Promise<number> {
  const rows = await prisma.feedbackReport.findMany({
    where: { triage: { in: ["PENDING", "FAILED"] }, triageTries: { lt: MAX_TRIES } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  for (const r of rows) if ((await triageReport(r.id, call)) === "DONE") done++;
  return done;
}
