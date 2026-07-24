import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  computeAllMetrics, computeWeeklyTarget, convertWeight, resolveSex,
  type Sex, type CaloricProfileInput,
} from "@/lib/caloric-engine";

/**
 * GET /api/patient/caloric-profile
 * Returns the full CaloricProfile for the authenticated user.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip: fetch the patient directly via the Clerk id relation
  // instead of account-then-patient (two sequential queries).
  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: {
      physicalActivity: true,
      gender: true,
    },
  });

  if (!patient) {
    return NextResponse.json({ error: "Patient profile not found" }, { status: 404 });
  }

  // Require all essential fields
  if (!patient.weight || !patient.height || !patient.birthday || !patient.physicalActivity?.level) {
    return NextResponse.json(
      { error: "Incomplete profile. Please fill in weight, height, birthday, and activity level." },
      { status: 422 }
    );
  }

  // Canonical resolution with the gender-name fallback (audit Task 16) —
  // this route previously 422'd for gender-only patients while the plan
  // builder correctly sexed the same profile.
  const sex: Sex | null = resolveSex(patient.sexAtBirth, patient.gender?.name);

  if (!sex) {
    return NextResponse.json(
      { error: "Sex at birth is required for caloric calculations." },
      { status: 422 }
    );
  }

  const input: CaloricProfileInput = {
    sex,
    birthday: new Date(patient.birthday),
    heightValue: patient.height,
    heightUnit: patient.heightUnit === "in" ? "in" : "cm",
    cbwValue: patient.weight,
    cbwUnit: (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
    activityLevel: patient.physicalActivity.level,
    utbwValue: patient.goalWeight,
    utbwUnit: (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
  };

  const profile = computeAllMetrics(input);

  // mealPlanWeight is stored in lbs (see Patient schema); convert to kg.
  const anchorStartKg =
    patient.mealPlanWeight != null ? convertWeight(patient.mealPlanWeight, "lbs").kg : null;

  const weeklyTarget = computeWeeklyTarget({
    profile,
    anchorStartKg,
    planStartDate: patient.mealPlanStartDate ?? null,
  });

  return NextResponse.json({ profile: { ...profile, weeklyTarget } });
}
