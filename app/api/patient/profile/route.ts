import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateMealPlan } from "@/lib/meal-plan";
import { addDays } from "date-fns";

async function getOrCreateAccount(userId: string) {
  let account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) {
    const clerkUser = await currentUser();
    if (!clerkUser) return null;
    const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";

    // Email may already exist (e.g. from a previous partial registration)
    // — claim that row by updating its clerkId instead of creating a duplicate
    const existing = await prisma.account.findUnique({ where: { email } });
    if (existing) {
      account = await prisma.account.update({
        where: { email },
        data: { clerkId: userId },
      });
    } else {
      account = await prisma.account.create({
        data: {
          clerkId: userId,
          email,
          firstName: clerkUser.firstName ?? "",
          lastName: clerkUser.lastName ?? "",
          agreedTerms: true,
          subscription: { create: { plan: "FREE", status: "ACTIVE" } },
        },
      });
    }
  }
  return account;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [patient, genders, physicalActivities, motivations, healthConditions, foodPreferences, foodToAvoid, foodAllergies] =
    await Promise.all([
      prisma.patient.findUnique({
        where: { accountId: account.id },
        include: {
          account: { select: { firstName: true, lastName: true, email: true } },
          motivations: true,
          healthConditions: true,
          foodPreferences: true,
          foodToAvoid: true,
          foodAllergies: true,
        },
      }),
      prisma.gender.findMany({ orderBy: { name: "asc" } }),
      prisma.physicalActivity.findMany({ orderBy: { level: "asc" } }),
      prisma.motivation.findMany({ orderBy: { name: "asc" } }),
      prisma.healthCondition.findMany({ orderBy: { name: "asc" } }),
      prisma.foodPreference.findMany({ orderBy: { name: "asc" } }),
      prisma.foodToAvoid.findMany({ orderBy: { name: "asc" } }),
      prisma.foodAllergy.findMany({ orderBy: { name: "asc" } }),
    ]);

  return NextResponse.json({
    patient,
    refData: { genders, physicalActivities, motivations, healthConditions, foodPreferences, foodToAvoid, foodAllergies },
  });
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOrCreateAccount(userId);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const body = await req.json();
  const {
    firstName, lastName, birthday, genderId, height, heightUnit,
    weight, weightUnit, physicalActivityId, goalWeight, weeklyGoal,
    motivationIds, healthConditionIds, foodPreferenceIds, foodToAvoidIds, foodAllergyIds,
  } = body;

  // Snapshot existing patient state before update — used to detect meal-plan-affecting changes
  const existing = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      motivations:      { select: { motivationId: true } },
      foodAllergies:    { select: { foodId: true } },
      foodToAvoid:      { select: { foodId: true } },
      foodPreferences:  { select: { foodId: true } },
      healthConditions: { select: { conditionId: true } },
    },
  });

  let bmi: number | null = null;
  if (height && weight) {
    const heightInM = heightUnit === "in" ? height * 0.0254 : height / 100;
    bmi = parseFloat((weight / (heightInM * heightInM)).toFixed(1));
  }

  await prisma.account.update({
    where: { id: account.id },
    data: {
      firstName: firstName || account.firstName,
      lastName: lastName || account.lastName,
      onboardingComplete: true,
    },
  });

  const patient = await prisma.patient.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      birthday: birthday ? new Date(birthday) : null,
      genderId: genderId || null,
      height: height ? parseFloat(height) : null,
      heightUnit: heightUnit ?? "cm",
      weight: weight ? parseFloat(weight) : null,
      weightUnit: weightUnit ?? "kg",
      bmi,
      physicalActivityId: physicalActivityId || null,
      goalWeight: goalWeight ? parseFloat(goalWeight) : null,
      weeklyGoal: weeklyGoal ? parseFloat(weeklyGoal) : null,
    },
    update: {
      birthday: birthday ? new Date(birthday) : undefined,
      genderId: genderId || null,
      height: height ? parseFloat(height) : undefined,
      heightUnit: heightUnit ?? "cm",
      weight: weight ? parseFloat(weight) : undefined,
      weightUnit: weightUnit ?? "kg",
      bmi: bmi ?? undefined,
      physicalActivityId: physicalActivityId || null,
      goalWeight: goalWeight ? parseFloat(goalWeight) : undefined,
      weeklyGoal: weeklyGoal ? parseFloat(weeklyGoal) : undefined,
    },
  });

  await prisma.$transaction([
    prisma.patientMotivation.deleteMany({ where: { patientId: patient.id } }),
    ...(motivationIds?.length
      ? [prisma.patientMotivation.createMany({ data: motivationIds.map((id: string) => ({ patientId: patient.id, motivationId: id })) })]
      : []),
    prisma.patientHealthCondition.deleteMany({ where: { patientId: patient.id } }),
    ...(healthConditionIds?.length
      ? [prisma.patientHealthCondition.createMany({ data: healthConditionIds.map((id: string) => ({ patientId: patient.id, conditionId: id })) })]
      : []),
    prisma.patientFoodPreference.deleteMany({ where: { patientId: patient.id } }),
    ...(foodPreferenceIds?.length
      ? [prisma.patientFoodPreference.createMany({ data: foodPreferenceIds.map((id: string) => ({ patientId: patient.id, foodId: id })) })]
      : []),
    prisma.patientFoodToAvoid.deleteMany({ where: { patientId: patient.id } }),
    ...(foodToAvoidIds?.length
      ? [prisma.patientFoodToAvoid.createMany({ data: foodToAvoidIds.map((id: string) => ({ patientId: patient.id, foodId: id })) })]
      : []),
    prisma.patientFoodAllergy.deleteMany({ where: { patientId: patient.id } }),
    ...(foodAllergyIds?.length
      ? [prisma.patientFoodAllergy.createMany({ data: foodAllergyIds.map((id: string) => ({ patientId: patient.id, foodId: id })) })]
      : []),
  ]);

  // Detect whether any meal-plan-affecting fields changed
  const sorted = (arr: string[]) => JSON.stringify([...arr].sort());
  const mealPlanFieldsChanged = existing != null && (
    existing.weeklyGoal        !== (weeklyGoal        ? parseFloat(weeklyGoal)        : null) ||
    existing.physicalActivityId !== (physicalActivityId || null) ||
    existing.weight             !== (weight            ? parseFloat(weight)            : null) ||
    existing.genderId           !== (genderId          || null) ||
    sorted(existing.motivations.map((m) => m.motivationId))      !== sorted(motivationIds      ?? []) ||
    sorted(existing.foodAllergies.map((f) => f.foodId))           !== sorted(foodAllergyIds     ?? []) ||
    sorted(existing.foodToAvoid.map((f) => f.foodId))             !== sorted(foodToAvoidIds     ?? []) ||
    sorted(existing.foodPreferences.map((f) => f.foodId))         !== sorted(foodPreferenceIds  ?? []) ||
    sorted(existing.healthConditions.map((c) => c.conditionId))   !== sorted(healthConditionIds ?? [])
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = addDays(today, 6);
  weekEnd.setHours(23, 59, 59, 999);

  if (!patient.mealPlanStartDate) {
    // First save: generate initial meal plan
    try {
      await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStartDate: today } });
      await generateMealPlan(patient.id, today, weekEnd);
    } catch (e) {
      console.error("[profile] meal plan generation failed:", e);
    }
  } else if (mealPlanFieldsChanged) {
    // Profile changed: regenerate current week to reflect new goals/motivations
    try {
      await generateMealPlan(patient.id, today, weekEnd);
    } catch (e) {
      console.error("[profile] meal plan regeneration failed:", e);
    }
  }

  return NextResponse.json({ ok: true, patientId: patient.id });
}
