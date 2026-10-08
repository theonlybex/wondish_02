import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAiTier } from "@/lib/ai-budget";
import { patientForClerk } from "@/lib/custom-conditions-server";
import { uploadPrivateFile, deleteFile } from "@/lib/s3";
import { validateFeedbackText, validateArea, sniffImage, FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_IMAGE_MB } from "@/lib/feedback/validate";
import { triageReport } from "@/lib/feedback/triage";
import { FEEDBACK_RATE_BUCKET } from "@/lib/feedback/validate";
import { screenshotFailure } from "@/lib/feedback/storage";

// Room for the 8 s inline triage plus the upload (Vercel default may be shorter).
export const maxDuration = 30;

// POST /api/feedback — a user's bug report (multipart). GET — the caller's own reports.
// Spec: docs/superpowers/specs/2026-10-07-feedback-reports-design.md
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid form" }, { status: 400 }); }
  const t = validateFeedbackText(form.get("text"));
  if (!t.ok) return NextResponse.json({ error: t.error, field: "text" }, { status: 422 });
  // After validation, so a rejected attempt doesn't use up the day's
  // allowance; an "ai-" bucket because every report costs a model call, and
  // spend buckets fall back to a per-instance counter on a Redis error
  // instead of failing open (deferred minors, 2026-10-07).
  const { success } = await rateLimit(FEEDBACK_RATE_BUCKET, userId, 10, 86400);
  if (!success) return NextResponse.json({ error: "You've sent 10 reports today — thank you! Please try again tomorrow." }, { status: 429 });

  const context: Record<string, unknown> = {
    from: String(form.get("from") ?? "").slice(0, 200) || null,
    viewport: String(form.get("viewport") ?? "").slice(0, 20) || null,
    sentryEventId: String(form.get("sentryEventId") ?? "").slice(0, 64) || null,
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    tier: await resolveAiTier(userId),
    appVersion: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  };

  let screenshotKey: string | null = null;
  const file = form.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) return NextResponse.json({ error: `Screenshots can be up to ${FEEDBACK_MAX_IMAGE_MB} MB.`, field: "screenshot" }, { status: 422 });
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniffImage(buf);
    if (!type) return NextResponse.json({ error: "Please attach a PNG, JPEG or WebP image.", field: "screenshot" }, { status: 422 });
    try {
      screenshotKey = await uploadPrivateFile(buf, type, "feedback");
    } catch (e) {
      const f = screenshotFailure(e);
      context.screenshot = f.note;
      if (f.log) console.error("[feedback] screenshot upload failed", e);
    }
  }

  let report: { id: string };
  try {
    report = await prisma.feedbackReport.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { patientId: patient.id, text: t.text, area: validateArea(form.get("area")), context: context as any, screenshotKey },
      select: { id: true },
    });
  } catch (e) {
    // The image was uploaded but the report was not saved: don't orphan it.
    if (screenshotKey) await deleteFile(screenshotKey).catch(() => {});
    throw e;
  }
  // The report is saved: from here on nothing may turn this into an error,
  // or the user resends and the report is duplicated.
  const triage = await triageReport(report.id);
  const row = await prisma.feedbackReport
    .findUnique({ where: { id: report.id }, select: { issue: { select: { status: true } } } })
    .catch(() => null);
  return NextResponse.json({ report: { id: report.id, status: row?.issue?.status ?? "NEW", triaged: triage === "DONE" } }, { status: 201 });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const rows = await prisma.feedbackReport.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, text: true, createdAt: true, issue: { select: { status: true } } },
  });
  return NextResponse.json({ reports: rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, status: r.issue?.status ?? "NEW" })) });
}
