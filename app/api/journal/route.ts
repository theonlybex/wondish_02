import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { convertHeight, convertWeight, calcCBMI } from "@/lib/caloric-engine";

// How far current weight must drift from the weight the active meal plan was
// generated at before we flag the plan stale. Keeps daily weigh-in noise quiet.
const WEIGHT_DRIFT_LBS = 5;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const date = dateParam ? new Date(dateParam) : new Date();
  date.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const entry = await prisma.journalEntry.findFirst({
    where: { patientId: patient.id, date: { gte: date, lte: dateEnd } },
    include: { meals: true },
  });

  return NextResponse.json({ entry });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json();
  const { date, mood, weight, energyLevel, activityLevel, notes, meals } = body;

  const entryDate = new Date(date);
  entryDate.setHours(0, 0, 0, 0);
  const dateEnd = new Date(entryDate);
  dateEnd.setHours(23, 59, 59, 999);

  const existing = await prisma.journalEntry.findFirst({
    where: { patientId: patient.id, date: { gte: entryDate, lte: dateEnd } },
  });

  const entryData = {
    mood: mood ?? null,
    weight: weight ? parseFloat(weight) : null,
    energyLevel: energyLevel ?? null,
    activityLevel: activityLevel ?? null,
    notes: notes ?? null,
  };

  let entry;
  await prisma.$transaction(async (tx) => {
    if (existing) {
      entry = await tx.journalEntry.update({ where: { id: existing.id }, data: entryData });
      await tx.journalMeal.deleteMany({ where: { journalEntryId: existing.id } });
    } else {
      entry = await tx.journalEntry.create({ data: { ...entryData, patientId: patient.id, date: entryDate } });
    }

    if (meals?.length) {
      await tx.journalMeal.createMany({
        data: meals.map((m: { mealType: string; recipeId?: string; preparation?: string; skipped?: boolean; rating?: number }) => ({
          journalEntryId: entry!.id,
          mealType: m.mealType,
          recipeId: m.recipeId ?? null,
          preparation: m.preparation ?? null,
          skipped: m.skipped ?? false,
          rating: m.rating ?? null,
        })),
      });
    }
  });

  // Keep the account's CURRENT weight in sync with the most recent actual
  // weigh-in. The journal is the ongoing ground truth — the latest-dated entry
  // with a weight wins, so editing an older day never overrides a newer one.
  const latestWeighIn = await prisma.journalEntry.findFirst({
    where: { patientId: patient.id, weight: { not: null } },
    orderBy: { date: "desc" },
    select: { weight: true },
  });
  if (latestWeighIn?.weight != null) {
    const currentWeight = latestWeighIn.weight; // lbs — the app's single unit
    const data: { weight: number; weightUnit: string; bmi?: number; mealPlanStale?: boolean } = {
      weight: currentWeight,
      weightUnit: "lbs",
    };
    if (patient.height) {
      const ht = convertHeight(patient.height, patient.heightUnit === "in" ? "in" : "cm");
      const wt = convertWeight(currentWeight, "lbs");
      data.bmi = parseFloat(calcCBMI(wt.kg, ht.m2).toFixed(1));
    }
    // Calorie targets are built from current weight. Only flag the plan stale
    // once weight has drifted past the threshold from the weight it was built
    // for — normal day-to-day fluctuation stays quiet.
    if (
      patient.mealPlanStartDate &&
      patient.mealPlanWeight != null &&
      Math.abs(currentWeight - patient.mealPlanWeight) >= WEIGHT_DRIFT_LBS
    ) {
      data.mealPlanStale = true;
    }
    await prisma.patient.update({ where: { id: patient.id }, data });
  }

  return NextResponse.json({ ok: true });
}
