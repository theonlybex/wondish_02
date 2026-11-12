// GET /api/numbers?days=7&today=YYYY-MM-DD
//   days  : integer 1-31, default 7
//   today : the client's local date; ends the window. Falls back to the server
//           date when absent (UTC on Vercel, so clients should send it).
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { addDays } from "@/lib/local-date";
import { getDayTarget, parseTodayParam } from "@/lib/meal-log";
import { summarizeLevels, type LevelDayInput } from "@/lib/levels";

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
  const toDate = today.value;
  const fromDate = addDays(toDate, -(days - 1));

  const rows = await prisma.mealLog.findMany({
    where: { patientId: patient.id, localDate: { gte: fromDate, lte: toDate }, deletedAt: null },
    select: { localDate: true, servings: true, calories: true, protein: true, carbs: true, fat: true, fiber: true, sodium: true },
  });

  const byDate = new Map<string, LevelDayInput>();
  for (const r of rows) {
    let d = byDate.get(r.localDate);
    if (!d) {
      d = { localDate: r.localDate, meals: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sodium: null };
      byDate.set(r.localDate, d);
    }
    const s = r.servings;
    d.meals += 1;
    d.calories += (r.calories ?? 0) * s;
    d.protein += (r.protein ?? 0) * s;
    d.carbs += (r.carbs ?? 0) * s;
    d.fat += (r.fat ?? 0) * s;
    d.fibre += (r.fiber ?? 0) * s;
    if (r.sodium != null) d.sodium = (d.sodium ?? 0) + r.sodium * s;
  }

  const dayTarget = await getDayTarget(patient.id, toDate, false);
  const targets = dayTarget
    ? { calories: dayTarget.calories, protein: dayTarget.protein, carbs: dayTarget.carbs, fat: dayTarget.fat }
    : null;
  const summary = summarizeLevels(Array.from(byDate.values()), targets, { fromDate, toDate });

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
