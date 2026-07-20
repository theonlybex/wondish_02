import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { regeneratePlan, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";
import { getPlanDayCalories } from "@/lib/meal-plan";
import { addDays } from "date-fns";

export const maxDuration = 60;

// "YYYY-MM-DD" local-calendar string for a Date — the string-out twin of
// getPlanDayCalories' localDateFromString, matching the local-date semantics
// the rest of this route already uses (localMidnight below).
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

  const dailyCalorieTarget = !weekStartParam
    ? await getPlanDayCalories(patient.id, toLocalDateString(startDate))
    : null;

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
