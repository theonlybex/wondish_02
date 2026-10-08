import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { SEVERITIES } from "@/lib/feedback/triage-parse";

// PATCH /api/admin/feedback/issues/[id] — { status?, title?, severity? }
const STATUSES = ["NEW", "INVESTIGATING", "FIXED", "WONT_FIX"] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const b = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if ((STATUSES as readonly string[]).includes(b.status)) data.status = b.status;
    if ((SEVERITIES as string[]).includes(b.severity)) data.severity = b.severity;
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim().slice(0, 90);
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 422 });
    const exists = await prisma.feedbackIssue.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    const issue = await prisma.feedbackIssue.update({ where: { id: params.id }, data, select: { id: true, status: true, severity: true, title: true } });
    return NextResponse.json({ issue });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
