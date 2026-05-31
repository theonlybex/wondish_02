import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    select: {
      mealPlanStatus: true,
      mealPlanStale: true,
      mealPlanError: true,
      activePlanVersion: true,
      mealPlanStartDate: true,
    },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  return NextResponse.json({
    status: patient.mealPlanStatus,
    stale: patient.mealPlanStale,
    error: patient.mealPlanError,
    hasPlan: patient.activePlanVersion > 0 && patient.mealPlanStartDate != null,
  });
}
