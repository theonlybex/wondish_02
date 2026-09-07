import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  derivePatientBans,
  buildDietMatchers,
  evaluateDishAgainstProfile,
  PATIENT_DIET_INCLUDE,
} from "@/lib/diet-match";
import {
  computeAllMetrics,
  computeMealCalories,
  resolveSex,
  type CaloricProfileInput,
} from "@/lib/caloric-engine";

// "What can I cook right now?" — public recipes scored against the patient's
// pantry. `ready` = every ingredient on hand; `almost` = missing 1–2 (named,
// so the user knows what one purchase unlocks). Diet/allergy bans are applied
// with the shared engine before coverage, so a banned dish never shows as
// cookable.

const MAX_READY = 30;
const MAX_ALMOST = 20;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("pantry-cookable", userId, 120, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: { ...PATIENT_DIET_INCLUDE, physicalActivity: true, gender: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const pantry = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredientId: true },
  });
  const onHand = new Set(pantry.map((p) => p.ingredientId));
  if (onHand.size === 0) {
    return NextResponse.json({ ready: [], almost: [], pantryCount: 0 });
  }

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });
  const hasBans = matchers.allergyMatchers.length > 0 || matchers.exactBanned.length > 0;

  // Single catalog load + in-memory scoring, same shape the meal-plan builder
  // uses (one query, not one per recipe).
  const recipes = await prisma.recipe.findMany({
    where: { isPublic: true, ingredients: { some: {} } },
    select: {
      id: true,
      name: true,
      emoji: true,
      calories: true,
      tags: true,
      mealType: { select: { name: true } },
      ingredients: { select: { ingredientId: true, ingredient: { select: { name: true } } } },
    },
  });

  type Scored = {
    id: string;
    name: string;
    emoji: string | null;
    calories: number | null;
    mealType: string | null;
    ingredientCount: number;
    missing: string[];
  };
  const ready: Scored[] = [];
  const almost: Scored[] = [];

  for (const r of recipes) {
    const names = r.ingredients.map((ri) => ri.ingredient.name);
    if (hasBans && !evaluateDishAgainstProfile(names, matchers).passed) continue;

    const missing = r.ingredients
      .filter((ri) => !onHand.has(ri.ingredientId))
      .map((ri) => ri.ingredient.name);

    const scored: Scored = {
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      calories: r.calories,
      mealType: r.mealType?.name ?? null,
      ingredientCount: r.ingredients.length,
      missing,
    };
    if (missing.length === 0) ready.push(scored);
    else if (missing.length <= 2) almost.push(scored);
  }

  // Ready: simplest dishes first (fewest ingredients = fastest to cook).
  ready.sort((a, b) => a.ingredientCount - b.ingredientCount);
  // Almost: closest to cookable first.
  almost.sort((a, b) => a.missing.length - b.missing.length || a.ingredientCount - b.ingredientCount);

  // ── Day coverage: can the DB-cookable dishes alone close a full day? ───────
  // Greedy pick: for each meal slot, the ready dish (with calories) closest to
  // the slot's target, each dish used once. If a slot can't be filled, or the
  // assembled day lands under 85% of the daily target, the database alone
  // can't satisfy the day — the client offers Clara's cook-my-day.
  let dailyCalories = 2000;
  if (patient.weight && patient.height && patient.birthday && patient.physicalActivity?.level) {
    const sex = resolveSex(patient.sexAtBirth, patient.gender?.name);
    if (sex) {
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
      dailyCalories = Math.round(computeAllMetrics(input).dailyCalories);
    }
  }
  const mealCals = computeMealCalories(dailyCalories);
  const slotNames = ["breakfast", "lunch", "dinner", "snack"];
  const used = new Set<string>();
  const missingSlots: string[] = [];
  let coveredCalories = 0;
  for (const slot of slotNames) {
    const target = mealCals[slot] ?? dailyCalories / slotNames.length;
    const candidates = ready.filter(
      (d) => !used.has(d.id) && d.calories != null && (d.mealType ?? "").toLowerCase() === slot
    );
    if (candidates.length === 0) {
      missingSlots.push(slot);
      continue;
    }
    const best = candidates.reduce((a, b) =>
      Math.abs((a.calories ?? 0) - target) <= Math.abs((b.calories ?? 0) - target) ? a : b
    );
    used.add(best.id);
    coveredCalories += best.calories ?? 0;
  }
  const canFillDay = missingSlots.length === 0 && coveredCalories >= dailyCalories * 0.85;

  return NextResponse.json({
    ready: ready.slice(0, MAX_READY),
    almost: almost.slice(0, MAX_ALMOST),
    pantryCount: onHand.size,
    readyTotal: ready.length,
    dayCoverage: {
      canFillDay,
      missingSlots,
      coveredCalories: Math.round(coveredCalories),
      targetCalories: dailyCalories,
    },
  });
}
