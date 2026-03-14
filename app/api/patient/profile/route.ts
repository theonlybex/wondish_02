import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [patient, genders, physicalActivities, motivations, healthConditions, foodPreferences, foodToAvoid, foodAllergies] =
    await Promise.all([
      prisma.patient.findUnique({
        where: { accountId: session.user.id },
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
    refData: {
      genders,
      physicalActivities,
      motivations,
      healthConditions,
      foodPreferences,
      foodToAvoid,
      foodAllergies,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const {
    firstName,
    lastName,
    birthday,
    genderId,
    height,
    heightUnit,
    weight,
    weightUnit,
    physicalActivityId,
    goalWeight,
    weeklyGoal,
    motivationIds,
    healthConditionIds,
    foodPreferenceIds,
    foodToAvoidIds,
    foodAllergyIds,
  } = body;

  // Compute BMI
  let bmi: number | null = null;
  if (height && weight) {
    const heightInM = heightUnit === "in" ? height * 0.0254 : height / 100;
    bmi = parseFloat((weight / (heightInM * heightInM)).toFixed(1));
  }

  // Update account name
  if (firstName || lastName) {
    const account = await prisma.account.findUnique({ where: { id: session.user.id } });
    await prisma.account.update({
      where: { id: session.user.id },
      data: {
        firstName: firstName ?? account?.firstName,
        lastName: lastName ?? account?.lastName,
        onboardingComplete: true,
      },
    });
  } else {
    await prisma.account.update({
      where: { id: session.user.id },
      data: { onboardingComplete: true },
    });
  }

  // Upsert patient
  const patient = await prisma.patient.upsert({
    where: { accountId: session.user.id },
    create: {
      accountId: session.user.id,
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

  // Replace junction tables in a transaction
  await prisma.$transaction([
    // Motivations
    prisma.patientMotivation.deleteMany({ where: { patientId: patient.id } }),
    ...(motivationIds?.length
      ? [
          prisma.patientMotivation.createMany({
            data: motivationIds.map((id: string) => ({
              patientId: patient.id,
              motivationId: id,
            })),
          }),
        ]
      : []),
    // Health conditions
    prisma.patientHealthCondition.deleteMany({ where: { patientId: patient.id } }),
    ...(healthConditionIds?.length
      ? [
          prisma.patientHealthCondition.createMany({
            data: healthConditionIds.map((id: string) => ({
              patientId: patient.id,
              conditionId: id,
            })),
          }),
        ]
      : []),
    // Food preferences
    prisma.patientFoodPreference.deleteMany({ where: { patientId: patient.id } }),
    ...(foodPreferenceIds?.length
      ? [
          prisma.patientFoodPreference.createMany({
            data: foodPreferenceIds.map((id: string) => ({
              patientId: patient.id,
              foodId: id,
            })),
          }),
        ]
      : []),
    // Food to avoid
    prisma.patientFoodToAvoid.deleteMany({ where: { patientId: patient.id } }),
    ...(foodToAvoidIds?.length
      ? [
          prisma.patientFoodToAvoid.createMany({
            data: foodToAvoidIds.map((id: string) => ({
              patientId: patient.id,
              foodId: id,
            })),
          }),
        ]
      : []),
    // Food allergies
    prisma.patientFoodAllergy.deleteMany({ where: { patientId: patient.id } }),
    ...(foodAllergyIds?.length
      ? [
          prisma.patientFoodAllergy.createMany({
            data: foodAllergyIds.map((id: string) => ({
              patientId: patient.id,
              foodId: id,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true, patientId: patient.id });
}
