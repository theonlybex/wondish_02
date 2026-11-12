// GET /api/numbers?days=7&today=YYYY-MM-DD
//   days  : integer 1-31, default 7
//   today : the client's local date; ends the window. Falls back to the server
//           date when absent (UTC on Vercel, so clients should send it).
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getDayTarget, parseTodayParam } from "@/lib/meal-log";
import { loadFullLevelData, loadLevelSummary } from "@/lib/level-summary";
import { ageOn, buildFullNumbers } from "@/lib/numbers-full";
import type { FullLevelKey } from "@/lib/level-catalogue";

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
  const full = new URL(req.url).searchParams.get("full") === "1";
  if (full) return NextResponse.json(await loadFull(patient, today.value, days));
  const summary = await loadLevelSummary(patient.id, today.value, days);

  // Weight: only for a patient with a goal weight. Change = latest weigh-in
  // minus the one nearest 7 days before it.
  const weight = patient.goalWeight != null ? await loadWeight(patient.id, patient.weightUnit) : null;

  return NextResponse.json({ summary, weight });
}

// ─── full=1 — the Numbers screen's 21 levels, tracked set, goals and pills ───
async function loadFull(
  patient: { id: string; birthday: Date | null; sexAtBirth: string | null; weightGoal: string | null; goalWeight: number | null; weightUnit: string | null; startingPicture: unknown },
  today: string,
  days: number,
) {
  const [data, dayTarget, conditions, supplements, trackedRows] = await Promise.all([
    loadFullLevelData(patient.id, today, days),
    getDayTarget(patient.id, today, false),
    prisma.patientHealthCondition.findMany({ where: { patientId: patient.id }, select: { condition: { select: { name: true } } } }),
    prisma.supplement.findMany({ where: { patientId: patient.id, deletedAt: null }, select: { contents: true, estimated: true } }),
    prisma.trackedLevel.findMany({ where: { patientId: patient.id }, select: { levelKey: true, tracked: true, goal: true } }),
  ]);

  const showWeight = patient.weightGoal === "lose" || patient.weightGoal === "gain" || patient.goalWeight != null;
  const weight = showWeight ? await loadWeight(patient.id, patient.weightUnit) : null;

  const pic = patient.startingPicture as { little?: unknown; aLot?: unknown } | null;
  const picture = pic && Array.isArray(pic.little) && Array.isArray(pic.aLot)
    ? { little: pic.little as FullLevelKey[], aLot: pic.aLot as FullLevelKey[] }
    : null;

  return buildFullNumbers({
    days: data.days,
    range: data.range,
    macroTargets: dayTarget ? { calories: dayTarget.calories, protein: dayTarget.protein, carbs: dayTarget.carbs } : null,
    person: {
      sexAtBirth: patient.sexAtBirth === "MALE" || patient.sexAtBirth === "FEMALE" ? patient.sexAtBirth : null,
      age: patient.birthday ? ageOn(patient.birthday.toISOString().slice(0, 10), today) : null,
    },
    conditionNames: conditions.map((c) => c.condition.name),
    pills: supplements,
    trackedRows,
    picture,
    weight,
  });
}

// Latest weigh-in minus the one nearest 7 days before it. The caller decides
// whether the person's goal makes the weight row show at all.
async function loadWeight(
  patientId: string,
  weightUnit: string | null,
): Promise<{ value: number; unit: "lbs" | "kg"; change: number | null } | null> {
  const entries = await prisma.journalEntry.findMany({
    where: { patientId, weight: { not: null } },
    select: { date: true, weight: true },
    orderBy: { date: "desc" },
    take: 60,
  });
  const weighIns = entries.filter((e): e is { date: Date; weight: number } => e.weight != null);
  if (weighIns.length === 0) return null;
  const latest = weighIns[0];
  const target = latest.date.getTime() - 7 * 86400000;
  let nearest: { date: Date; weight: number } | null = null;
  for (const w of weighIns.slice(1)) {
    if (!nearest || Math.abs(w.date.getTime() - target) < Math.abs(nearest.date.getTime() - target)) nearest = w;
  }
  return {
    value: latest.weight,
    unit: weightUnit === "kg" ? "kg" : "lbs",
    change: nearest ? Math.round((latest.weight - nearest.weight) * 10) / 10 : null,
  };
}
