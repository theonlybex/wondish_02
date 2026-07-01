import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { regeneratePlan, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { startDate } = await req.json();

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
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
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept." },
        { status: 422 }
      );
    }
    throw err;
  }
}
