import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateMealPlan } from "@/lib/meal-plan";
import { addDays } from "date-fns";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
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
    where: { patientId: patient.id, date: { gte: startDate, lte: endDate } },
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

  return NextResponse.json({ menus, mealPlanStartDate: patient.mealPlanStartDate, loggedRecipeIds, mealRatings });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const sub = account.subscription;
  const isPremium = isAdmin || (sub?.plan === "PREMIUM" && ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(sub?.status ?? ""));
  if (!isPremium) return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { startDate, endDate } = await req.json();
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const daysDiff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 0 || daysDiff > 14) {
    return NextResponse.json({ error: "Date range must be between 1 and 14 days" }, { status: 400 });
  }

  const count = await generateMealPlan(patient.id, start, end);

  return NextResponse.json({ ok: true, count });
}
