import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { guardAiSpend } from "@/lib/ai-budget";
import { normalizeCuisine } from "@/lib/clara/recipe-generation";
import { buildMealPlanMenus } from "@/lib/meal-plan";

export const maxDuration = 60;

// POST /api/meal-plan/day — "cuisine for today": rebuild ONLY the requested day
// in a chosen cuisine, leaving the rest of the week untouched. Runs the real
// builder for one day (windowDays: 1) — basket-constrained + cache-first, with
// cuisine as a soft lens on Clara generation — then overwrites just that date's
// Menu rows in the active plan version.

function localMidnight(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("regenerate", userId, 15, 60);
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { date, cuisine } = (body ?? {}) as { date?: unknown; cuisine?: unknown };

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true, profileCompleted: true, mealPlanStartDate: true, activePlanVersion: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  // Per-day cuisine changes are cheaper than a full week — own modest quota.
  const guard = await guardAiSpend(userId, "swap");
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const localDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : toLocalDateString(new Date());
  const dayStart = localMidnight(localDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const pantry = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredient: { select: { name: true } } },
  });
  const basket = new Set(pantry.map((p) => p.ingredient.name.trim().toLowerCase()));
  const anchor = patient.mealPlanStartDate ? new Date(patient.mealPlanStartDate) : dayStart;

  try {
    const { rows } = await buildMealPlanMenus(patient.id, dayStart, patient.activePlanVersion, {
      windowDays: 1,
      anchorDate: anchor,
      basket,
      cuisine: normalizeCuisine(cuisine),
      claraFirst: true,
      // One day needs only ~1 dish per slot — generate a small pool so the
      // model call stays fast (was 28 dishes for a single day).
      claraPerType: 2,
    });
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Couldn't rebuild today in that cuisine — try another, or add a few ingredients." },
        { status: 422 }
      );
    }
    await prisma.$transaction([
      prisma.menu.deleteMany({
        where: { patientId: patient.id, planVersion: patient.activePlanVersion, date: { gte: dayStart, lte: dayEnd } },
      }),
      prisma.menu.createMany({ data: rows }),
    ]);
    return NextResponse.json({ ok: true, count: rows.length });
  } catch {
    return NextResponse.json({ error: "Couldn't rebuild today — try again." }, { status: 500 });
  }
}
