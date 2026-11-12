// GET /api/numbers?days=7&today=YYYY-MM-DD
//   days  : integer 1-31, default 7
//   today : the client's local date; ends the window. Falls back to the server
//           date when absent (UTC on Vercel, so clients should send it).
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { parseTodayParam } from "@/lib/meal-log";
import { loadLevelSummary } from "@/lib/level-summary";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;

// ─── GET /api/numbers?days=7 — read-only Numbers tab feed ────────────────────
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("numbers-read", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const daysParam = new URL(req.url).searchParams.get("days");
  let days = DEFAULT_DAYS;
  if (daysParam != null) {
    if (!/^\d+$/.test(daysParam)) {
      return NextResponse.json({ error: `days must be an integer from 1 to ${MAX_DAYS}` }, { status: 400 });
    }
    days = Number(daysParam);
    if (days < 1 || days > MAX_DAYS) {
      return NextResponse.json({ error: `days must be an integer from 1 to ${MAX_DAYS}` }, { status: 400 });
    }
  }

  const today = parseTodayParam(new URL(req.url).searchParams.get("today"));
  if (!today.ok) return NextResponse.json({ error: today.error }, { status: today.status });
  const summary = await loadLevelSummary(patient.id, today.value, days);

  // Weight: only for a patient with a goal weight. Change = latest weigh-in
  // minus the one nearest 7 days before it.
  let weight: { value: number; unit: "lbs" | "kg"; change: number | null } | null = null;
  if (patient.goalWeight != null) {
    const entries = await prisma.journalEntry.findMany({
      where: { patientId: patient.id, weight: { not: null } },
      select: { date: true, weight: true },
      orderBy: { date: "desc" },
      take: 60,
    });
    const weighIns = entries.filter((e): e is { date: Date; weight: number } => e.weight != null);
    if (weighIns.length > 0) {
      const latest = weighIns[0];
      const target = latest.date.getTime() - 7 * 86400000;
      let nearest: { date: Date; weight: number } | null = null;
      for (const w of weighIns.slice(1)) {
        if (!nearest || Math.abs(w.date.getTime() - target) < Math.abs(nearest.date.getTime() - target)) nearest = w;
      }
      weight = {
        value: latest.weight,
        unit: patient.weightUnit === "kg" ? "kg" : "lbs",
        change: nearest ? Math.round((latest.weight - nearest.weight) * 10) / 10 : null,
      };
    }
  }

  return NextResponse.json({ summary, weight });
}
