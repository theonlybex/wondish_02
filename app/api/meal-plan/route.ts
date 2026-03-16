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

  if (weekStartParam) {
    startDate = new Date(weekStartParam);
    startDate.setHours(0, 0, 0, 0);
    endDate = addDays(startDate, 6);
    endDate.setHours(23, 59, 59, 999);
  } else {
    const d = dateParam ? new Date(dateParam) : new Date();
    d.setHours(0, 0, 0, 0);
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
