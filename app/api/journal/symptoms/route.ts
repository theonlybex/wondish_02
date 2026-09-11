import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SEVERITY_SCORE, type Severity } from "@/lib/trials/score";

// GET /api/journal/symptoms?days=30 — mean symptom severity per logged day
// (0–3) for the Journey trend card. Empty when the user logs no symptoms.
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { id: true } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("days") ?? "30", 10) || 30, 7), 120);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  const entries = await prisma.journalEntry.findMany({
    where: { patientId: patient.id, date: { gte: from }, symptoms: { some: {} } },
    select: { date: true, symptoms: { select: { severity: true } } },
    orderBy: { date: "asc" },
  });
  const out = entries.map((e) => {
    const scores = e.symptoms.map((s) => SEVERITY_SCORE[s.severity as Severity]);
    const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return { date: e.date.toISOString().slice(0, 10), score: Math.round(score * 100) / 100, items: scores.length };
  });
  return NextResponse.json({ days: out });
}
