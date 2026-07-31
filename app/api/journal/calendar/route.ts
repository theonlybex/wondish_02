import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { filterCalendarMeals } from "@/lib/journal";
import {
  computeAllMetrics,
  gradualDailyCals,
  maxDailyDeficit,
  resolvePlanDirection,
  type Sex,
  type CaloricProfileInput,
  type CaloricProfile,
} from "@/lib/caloric-engine";

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * GET /api/journal/calendar
 * Returns all journal entries + rated meals for the full meal-plan date range,
 * plus the caloric profile and per-day calorie targets.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // iOS journal mode: include unrated (but never skipped) meals, rating nullable.
  // Without the param the payload is byte-identical to the web contract.
  const allMeals = req.nextUrl.searchParams.get("allMeals") === "1";

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: { physicalActivity: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  if (!patient.mealPlanStartDate) {
    return NextResponse.json({ error: "No meal plan found" }, { status: 404 });
  }

  const planStart = new Date(patient.mealPlanStartDate);
  planStart.setHours(0, 0, 0, 0);

  // Find last menu date for this plan version
  const lastMenu = await prisma.menu.findFirst({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const planEnd = lastMenu ? new Date(lastMenu.date) : new Date(planStart);
  planEnd.setHours(23, 59, 59, 999);

  // Fetch journal entries + menus in the range
  const [journalEntries, menus] = await Promise.all([
    prisma.journalEntry.findMany({
      where: {
        patientId: patient.id,
        date: { gte: planStart, lte: planEnd },
      },
      include: {
        meals: {
          select: { mealType: true, recipeId: true, rating: true, skipped: true, preparation: true },
        },
      },
      orderBy: { date: "asc" },
    }),
    prisma.menu.findMany({
      where: {
        patientId: patient.id,
        planVersion: patient.activePlanVersion,
        date: { gte: planStart, lte: planEnd },
      },
      include: { recipe: { select: { id: true, name: true } }, mealType: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
  ]);

  // Build recipe name lookup from menus.
  // Plan-exchange note (spec 2026-07-30-plan-exchanges-design.md): menus here
  // feed ONLY this name lookup for journaled meals — they are not rendered as
  // planned dishes — so displaced menus are deliberately NOT filtered out:
  // a dish eaten before its slot was exchanged must keep resolving its name.
  // Eaten exchanged-in dishes flow through MealLog (planExchangeId), which
  // this journal-entry view does not read.
  const recipeNames = new Map<string, string>();
  for (const m of menus) {
    recipeNames.set(m.recipeId, m.recipe.name);
  }

  // Compute caloric profile if possible
  let caloricProfile: CaloricProfile | null = null;
  if (patient.weight && patient.height && patient.birthday && patient.physicalActivity?.level) {
    const s = (patient.sexAtBirth ?? "").toLowerCase();
    const sex: Sex | null = s === "male" ? "male" : s === "female" ? "female" : null;
    if (sex) {
      const input: CaloricProfileInput = {
        sex,
        birthday: new Date(patient.birthday),
        heightValue: patient.height,
        heightUnit: patient.heightUnit === "in" ? "in" : "cm",
        cbwValue: patient.weight,
        cbwUnit: (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue: patient.goalWeight,
        utbwUnit: (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      caloricProfile = computeAllMetrics(input);
    }
  }

  // Build entries map keyed by date string
  const entries: Record<string, {
    mood: string | null;
    weight: number | null;
    energyLevel: string | null;
    activityLevel: string | null;
    notes: string | null;
    dailyCalorieTarget: number | null;
    meals: { mealType: string; recipeName: string; rating: number | null }[];
  }> = {};

  // Index journal entries by date
  const journalByDate = new Map<string, typeof journalEntries[0]>();
  for (const entry of journalEntries) {
    journalByDate.set(fmtDate(new Date(entry.date)), entry);
  }

  // Walk each day in the plan range
  const cursor = new Date(planStart);
  while (cursor <= planEnd) {
    const key = fmtDate(cursor);
    const entry = journalByDate.get(key);

    // Compute per-day calorie target
    let dailyCalorieTarget: number | null = null;
    if (caloricProfile) {
      const dayNumber = Math.round((cursor.getTime() - planStart.getTime()) / 86400000) + 1;
      if (dayNumber >= 1) {
        dailyCalorieTarget = gradualDailyCals(
          Math.round(caloricProfile.tdeeCBW),
          dayNumber,
          resolvePlanDirection(caloricProfile),
          caloricProfile.minCaloriesValue,
          maxDailyDeficit(caloricProfile.cbmi),
        );
      }
    }

    if (entry) {
      // Only include rated meals (liked/disliked)
      const ratedMeals = filterCalendarMeals(entry.meals, allMeals)
        .map((m) => ({
          mealType: m.mealType,
          recipeName: m.recipeId ? recipeNames.get(m.recipeId) ?? "Unknown" : "Unknown",
          rating: allMeals ? m.rating ?? null : m.rating!,
        }));

      entries[key] = {
        mood: entry.mood,
        weight: entry.weight,
        energyLevel: entry.energyLevel,
        activityLevel: entry.activityLevel,
        notes: entry.notes,
        dailyCalorieTarget,
        meals: ratedMeals,
      };
    } else {
      // Day exists in plan but no journal entry — still include calorie target
      entries[key] = {
        mood: null,
        weight: null,
        energyLevel: null,
        activityLevel: null,
        notes: null,
        dailyCalorieTarget,
        meals: [],
      };
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return NextResponse.json({
    planStartDate: fmtDate(planStart),
    planEndDate: fmtDate(new Date(planEnd)),
    caloricProfile: caloricProfile
      ? {
          dailyCalories: Math.round(caloricProfile.dailyCalories),
          tdeeCBW: Math.round(caloricProfile.tdeeCBW),
          cbwKg: caloricProfile.cbwKg,
          tbwKg: caloricProfile.tbwKg,
          cbmi: caloricProfile.cbmi,
          cbmiClass: caloricProfile.cbmiClass,
          bodyFatPct: caloricProfile.bodyFatPct,
        }
      : null,
    entries,
  });
}
