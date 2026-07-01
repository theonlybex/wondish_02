import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { regeneratePlan, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";
import { addDays } from "date-fns";
import { computeAllMetrics, gradualDailyCals, maxDailyDeficit, type CaloricProfileInput } from "@/lib/caloric-engine";

export const maxDuration = 60;

function computeDailyTarget(
  patient: {
    mealPlanStartDate: Date | null;
    weight: number | null; weightUnit: string | null;
    goalWeight: number | null; goalWeightUnit: string | null;
    height: number | null; heightUnit: string | null;
    sexAtBirth: string | null; birthday: Date | null;
    physicalActivity: { level: number } | null;
  },
  targetDate: Date,
): number | null {
  if (!patient.mealPlanStartDate || !patient.weight || !patient.height || !patient.birthday || !patient.physicalActivity?.level) return null;
  const s = (patient.sexAtBirth ?? "").toLowerCase();
  const sex = s === "male" ? "male" as const : s === "female" ? "female" as const : null;
  if (!sex) return null;

  const pi: CaloricProfileInput = {
    sex,
    birthday:     new Date(patient.birthday),
    heightValue:  patient.height,
    heightUnit:   patient.heightUnit === "in" ? "in" : "cm",
    cbwValue:     patient.weight,
    cbwUnit:      (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
    activityLevel: patient.physicalActivity.level,
    utbwValue:    patient.goalWeight,
    utbwUnit:     (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
  };
  const profile  = computeAllMetrics(pi);
  const planStart = new Date(patient.mealPlanStartDate);
  planStart.setHours(0, 0, 0, 0);
  const tgt = new Date(targetDate);
  tgt.setHours(0, 0, 0, 0);
  const dayNumber = Math.round((tgt.getTime() - planStart.getTime()) / 86400000) + 1;
  if (dayNumber < 1) return null;

  return gradualDailyCals(
    Math.round(profile.tdeeCBW),
    dayNumber,
    profile.cbmiClass,
    profile.minCaloriesValue,
    maxDailyDeficit(profile.cbmi),
  );
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: {
      id: true, mealPlanStartDate: true, activePlanVersion: true,
      weight: true, weightUnit: true,
      goalWeight: true, goalWeightUnit: true,
      height: true, heightUnit: true,
      sexAtBirth: true, birthday: true,
      physicalActivity: { select: { level: true } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const weekStartParam = searchParams.get("weekStart");

  let startDate: Date;
  let endDate: Date;

  // Parse "yyyy-MM-dd" as local midnight — new Date("yyyy-MM-dd") parses as UTC
  // which causes a day shift in UTC- timezones. Use explicit local construction instead.
  function localMidnight(str: string): Date {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  if (weekStartParam) {
    startDate = localMidnight(weekStartParam);
    endDate = addDays(startDate, 6);
    endDate.setHours(23, 59, 59, 999);
  } else {
    const d = dateParam ? localMidnight(dateParam) : new Date(new Date().setHours(0, 0, 0, 0));
    startDate = d;
    endDate = new Date(d);
    endDate.setHours(23, 59, 59, 999);
  }

  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion, date: { gte: startDate, lte: endDate } },
    include: {
      recipe: { include: { mealType: true, dishType: true, ethnic: true, ingredients: { include: { ingredient: true } } } },
      mealType: true,
    },
    orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
  });

  // For single-day requests, also return which recipes are logged in journal
  let loggedRecipeIds: string[] = [];
  let mealRatings: Record<string, number> = {};
  if (!weekStartParam) {
    const journalEntry = await prisma.journalEntry.findFirst({
      where: { patientId: patient.id, date: { gte: startDate, lte: endDate } },
      include: { meals: { select: { recipeId: true, skipped: true, rating: true } } },
    });
    const activeMeals = (journalEntry?.meals ?? []).filter((m) => !m.skipped && m.recipeId);
    loggedRecipeIds = activeMeals.map((m) => m.recipeId as string);
    for (const m of activeMeals) {
      if (m.recipeId && m.rating != null) mealRatings[m.recipeId] = m.rating;
    }
  }

  const dailyCalorieTarget = !weekStartParam ? computeDailyTarget(patient, startDate) : null;

  return NextResponse.json({ menus, mealPlanStartDate: patient.mealPlanStartDate, loggedRecipeIds, mealRatings, dailyCalorieTarget });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } }, patient: true },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const sub = account.subscription;
  const isPremium = isAdmin || (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = account.patient;
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  if (!patient.profileCompleted) {
    return NextResponse.json({ error: "Profile not complete" }, { status: 422 });
  }

  const { startDate } = await req.json();
  const start = new Date(startDate);

  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  try {
    const count = await regeneratePlan(patient.id, start);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept." },
        { status: 422 }
      );
    }
    throw err;
  }
}
