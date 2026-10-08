import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { rankIssues } from "@/lib/feedback/rank";
import { retryPendingTriage } from "@/lib/feedback/triage";

// GET /api/admin/feedback — issues ranked by importance, with their reports.
// Retries a few untriaged reports first (best effort, never blocks the page).
const reportSelect = { id: true, patientId: true, text: true, area: true, createdAt: true, context: true, screenshotKey: true, triage: true, triageNote: true } as const;
type ReportRowSrc = { id: string; text: string; area: string | null; createdAt: Date; context: unknown; screenshotKey: string | null; triage: string; triageNote: string | null };
const toReportRow = (r: ReportRowSrc) => ({ id: r.id, text: r.text, area: r.area, createdAt: r.createdAt, context: r.context, hasScreenshot: Boolean(r.screenshotKey), triage: r.triage, triageNote: r.triageNote });

export async function GET() {
  try {
    await requireAdmin();
    await retryPendingTriage(5).catch(() => 0);
    const issues = await prisma.feedbackIssue.findMany({ include: { reports: { select: reportSelect, orderBy: { createdAt: "desc" } } } });
    const ranked = rankIssues(issues, new Date());
    const row = (i: (typeof ranked.open)[number]) => ({
      id: i.id, title: i.title, category: i.category, severity: i.severity, status: i.status,
      score: i.score, reporters: i.reporters, reportCount: i.reports.length, lastSeen: i.lastSeen, reports: i.reports.map(toReportRow),
    });
    const untriaged = await prisma.feedbackReport.findMany({ where: { issueId: null }, select: reportSelect, orderBy: { createdAt: "desc" } });
    return NextResponse.json({
      counts: { openCritical: ranked.open.filter((i) => i.severity === "CRITICAL").length, open: ranked.open.length, untriaged: untriaged.length },
      open: ranked.open.map(row),
      closed: ranked.closed.map(row),
      untriaged: untriaged.map(toReportRow),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
