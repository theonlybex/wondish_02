import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { triageReport } from "@/lib/feedback/triage";
import { isSafetyReport } from "@/lib/feedback/safety";

// PATCH /api/admin/feedback/reports/[id] — { moveTo: issueId | "new" } fixes a
// wrong grouping; { retry: true } re-runs the triage bot.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const report = await prisma.feedbackReport.findUnique({ where: { id: params.id }, select: { id: true, text: true, issue: { select: { category: true, severity: true } } } });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    if (b.retry === true) {
      await prisma.feedbackReport.update({ where: { id: report.id }, data: { triage: "PENDING", triageTries: 0, issueId: null } });
      return NextResponse.json({ triage: await triageReport(report.id) });
    }
    if (b.moveTo === "new") {
      const issue = await prisma.feedbackIssue.create({
        // A safety report stays CRITICAL wherever an admin moves it.
        data: isSafetyReport(report.text)
          ? { title: report.text.split("\n")[0].slice(0, 90), category: "SAFETY_FOOD", severity: "CRITICAL" }
          : { title: report.text.split("\n")[0].slice(0, 90), category: report.issue?.category ?? "OTHER", severity: report.issue?.severity ?? "MEDIUM" },
        select: { id: true },
      });
      await prisma.feedbackReport.update({ where: { id: report.id }, data: { issueId: issue.id, triage: "DONE" } });
      return NextResponse.json({ issueId: issue.id });
    }
    if (typeof b.moveTo === "string") {
      const target = await prisma.feedbackIssue.findUnique({ where: { id: b.moveTo }, select: { id: true } });
      if (!target) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
      await prisma.feedbackReport.update({ where: { id: report.id }, data: { issueId: target.id, triage: "DONE" } });
      return NextResponse.json({ issueId: target.id });
    }
    return NextResponse.json({ error: "Nothing to change" }, { status: 422 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
