import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateMealPlan } from "@/lib/meal-plan";
import { addDays } from "date-fns";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const { startDate } = await req.json();

  const patient = await prisma.patient.findUnique({ where: { accountId: account.id } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);

  await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStartDate: start } });
  const count = await generateMealPlan(patient.id, start, end);

  return NextResponse.json({ ok: true, count, startDate: start.toISOString() });
}
