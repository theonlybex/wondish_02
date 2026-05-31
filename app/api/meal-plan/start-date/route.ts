import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { regeneratePlan, MealPlanBusyError } from "@/lib/meal-plan-runner";

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

  // Atomic blue/green regenerate — no unguarded wipe.
  try {
    const count = await regeneratePlan(patient.id, start);
    return NextResponse.json({ ok: true, count, startDate: start.toISOString() });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    throw err;
  }
}
