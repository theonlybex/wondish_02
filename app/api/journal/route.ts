import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { convertHeight, convertWeight, calcCBMI } from "@/lib/caloric-engine";
import { parseLocalDateStrict, shouldReplaceMeals, validateJournalPost } from "@/lib/journal";
import { trackingItemsForPatient, validateSymptoms } from "@/lib/journal-symptoms";

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
  let date: Date;
  if (dateParam) {
    const parsed = parseLocalDateStrict(dateParam);
    if (!parsed) return NextResponse.json({ error: "date must be a YYYY-MM-DD string" }, { status: 400 });
    date = parsed;
  } else {
    date = new Date();
  }
  date.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const [entry, trackingItems] = await Promise.all([
    prisma.journalEntry.findFirst({
      where: { patientId: patient.id, date: { gte: date, lte: dateEnd } },
      include: { meals: true, symptoms: { select: { trackingItemId: true, severity: true } } },
    }),
    // Empty for a user without a condition → the UI shows no symptoms step.
    trackingItemsForPatient(prisma, patient.id),
  ]);

  return NextResponse.json({ entry, symptoms: entry?.symptoms ?? [], trackingItems });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Single round-trip via the Clerk id relation (was account-then-patient).
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const MAX_NOTES_CHARS = 2000;
  const { mood, energyLevel, activityLevel, notes } = body as {
    mood?: string | null;
    energyLevel?: string | null;
    activityLevel?: string | null;
    notes?: string | null;
  };

  // Validation (audit Task 14): garbage dates previously reached Prisma as
  // Invalid Dates (500), NaN/negative weights were stored and synced into
  // patient BMI, and ratings were entirely unvalidated.
  const validated = validateJournalPost(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  // A 100,000-character note was accepted and stored (QA 2026-09-11).
  if (typeof notes === "string" && notes.length > MAX_NOTES_CHARS) {
    return NextResponse.json({ error: `notes must be ${MAX_NOTES_CHARS} characters or fewer` }, { status: 400 });
  }
  const { date: entryDate, weight: parsedWeight, meals } = validated;
  // Condition symptoms (workbook 05): only items the patient's conditions own.
  const allowedItems = await trackingItemsForPatient(prisma, patient.id);
  const symptomsValidated = validateSymptoms(body.symptoms, new Set(allowedItems.map((i) => i.id)));
  if (!symptomsValidated.ok) return NextResponse.json({ error: symptomsValidated.error }, { status: 400 });
  const symptomRows = symptomsValidated.rows;
  entryDate.setHours(0, 0, 0, 0);
  const dateEnd = new Date(entryDate);
  dateEnd.setHours(23, 59, 59, 999);

  const existing = await prisma.journalEntry.findFirst({
    where: { patientId: patient.id, date: { gte: entryDate, lte: dateEnd } },
  });

  const entryData = {
    mood: mood ?? null,
    weight: parsedWeight,
    energyLevel: energyLevel ?? null,
    activityLevel: activityLevel ?? null,
    notes: notes ?? null,
  };

  let entry;
  await prisma.$transaction(async (tx) => {
    if (existing) {
      entry = await tx.journalEntry.update({ where: { id: existing.id }, data: entryData });
      // Replace meal rows ONLY when the client sent the meals key — a
      // mood/weight-only save must not destroy log-meal ratings for the day
      // (audit Task 14). An explicit meals: [] remains a clear.
      if (shouldReplaceMeals(body)) {
        await tx.journalMeal.deleteMany({ where: { journalEntryId: existing.id } });
      }
    } else {
      entry = await tx.journalEntry.create({ data: { ...entryData, patientId: patient.id, date: entryDate } });
    }

    if (meals?.length) {
      await tx.journalMeal.createMany({
        data: meals.map((m) => ({
          journalEntryId: entry!.id,
          mealType: m.mealType,
          recipeId: m.recipeId ?? null,
          preparation: m.preparation ?? null,
          skipped: m.skipped ?? false,
          rating: m.rating ?? null,
        })),
      });
    }

    // Symptoms: null clears the item for the day, a severity upserts it.
    const cleared = symptomRows.filter((s) => s.severity === null).map((s) => s.trackingItemId);
    if (cleared.length) await tx.journalSymptom.deleteMany({ where: { journalEntryId: entry!.id, trackingItemId: { in: cleared } } });
    for (const s of symptomRows) {
      if (s.severity === null) continue;
      await tx.journalSymptom.upsert({
        where: { journalEntryId_trackingItemId: { journalEntryId: entry!.id, trackingItemId: s.trackingItemId } },
        update: { severity: s.severity },
        create: { journalEntryId: entry!.id, trackingItemId: s.trackingItemId, severity: s.severity },
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
