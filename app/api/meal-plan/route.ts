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

  console.log("[meal-plan GET] querying date range:", startDate.toISOString(), "→", endDate.toISOString());
  const menus = await prisma.menu.findMany({
    where: { patientId: patient.id, date: { gte: startDate, lte: endDate } },
    include: {
      recipe: { include: { mealType: true, dishType: true, ethnic: true, ingredients: { include: { ingredient: true } } } },
      mealType: true,
    },
    orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
  });

  console.log("[meal-plan GET] found", menus.length, "menus. mealPlanStartDate:", patient.mealPlanStartDate?.toISOString());
  return NextResponse.json({ menus, mealPlanStartDate: patient.mealPlanStartDate });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { startDate, endDate } = await req.json();
  const count = await generateMealPlan(patient.id, new Date(startDate), new Date(endDate));

  return NextResponse.json({ ok: true, count });
}
