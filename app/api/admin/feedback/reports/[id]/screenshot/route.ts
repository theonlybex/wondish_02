import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { getPresignedUrl } from "@/lib/s3";

// GET /api/admin/feedback/reports/[id]/screenshot — a 10-minute signed URL.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const r = await prisma.feedbackReport.findUnique({ where: { id: params.id }, select: { screenshotKey: true } });
    if (!r?.screenshotKey) return NextResponse.json({ error: "No screenshot" }, { status: 404 });
    return NextResponse.json({ url: await getPresignedUrl(r.screenshotKey, 600) });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
