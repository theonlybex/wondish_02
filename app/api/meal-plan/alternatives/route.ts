import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PATIENT_DIET_INCLUDE } from "@/lib/diet-match";
import { findAlternatives } from "@/lib/meal-plan";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mealTypeId      = searchParams.get("mealTypeId");
  const excludeRecipeId = searchParams.get("excludeRecipeId");
  const currentCalories = parseFloat(searchParams.get("currentCalories") ?? "0");

  if (!mealTypeId) {
    return NextResponse.json({ error: "mealTypeId required" }, { status: 400 });
  }

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: PATIENT_DIET_INCLUDE,
  });

  // Shared candidate search + in-memory ban filter (S3 extraction —
  // lib/meal-plan.ts findAlternatives; same two-stage pattern as before).
  const alternatives = await findAlternatives(
    patient ?? { foodAllergies: [], foodToAvoid: [], healthConditions: [], foodPreferences: [], motivations: [] },
    { mealTypeId, excludeRecipeId: excludeRecipeId ?? undefined, currentCalories }
  );

  return NextResponse.json({ alternatives });
}
