import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { internalError } from "@/lib/api-error";
import { convertWeight, convertHeight, calcCBMI } from "@/lib/caloric-engine";
import { AccountClaimConflictError, getOrCreateAccount } from "@/lib/auth";
import { CM_PER_IN, checkBodyMetrics, firstBodyMetricsError } from "@/lib/body-bounds";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [patient, physicalActivities, motivations, healthConditions, foodPreferences, foodToAvoid, foodAllergies] =
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
      prisma.physicalActivity.findMany({ orderBy: { level: "asc" }, where: { level: { lte: 4 } } }),
      prisma.motivation.findMany({ orderBy: { name: "asc" } }),
      // Built-in only; a user's own conditions come from /api/patient/conditions.
      prisma.healthCondition.findMany({ where: { ownerPatientId: null }, orderBy: { name: "asc" } }),
      prisma.foodPreference.findMany({ orderBy: { name: "asc" } }),
      prisma.foodToAvoid.findMany({ orderBy: { name: "asc" } }),
      prisma.foodAllergy.findMany({ orderBy: { name: "asc" } }),
    ]);

  return NextResponse.json({
    patient,
    refData: { physicalActivities, motivations, healthConditions, foodPreferences, foodToAvoid, foodAllergies },
  });
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let account;
  try {
    account = await getOrCreateAccount(userId);
  } catch (err) {
    if (err instanceof AccountClaimConflictError) {
      return NextResponse.json(
        {
          error: "email_conflict",
          message: "This email is already associated with another Wondish account. Contact support.",
        },
        { status: 409 }
      );
    }
    return internalError("patient/profile:account", err, "Couldn't save your profile — please try again.");
  }
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const body = await req.json();
  const {
    firstName, lastName, birthday, sexAtBirth, height, heightUnit,
    heightFt, heightIn,
    weight, physicalActivityId, goalWeight,
    motivationIds, healthConditionIds, foodPreferenceIds, foodToAvoidIds, foodAllergyIds,
  } = body;

  // Boundary validation: reject unusable birthday/goalWeight values instead
  // of persisting them into the caloric engine's inputs.
  if (birthday) {
    const b = new Date(birthday);
    const ageYears = (Date.now() - b.getTime()) / (365.25 * 86400000);
    if (Number.isNaN(b.getTime()) || ageYears < 13 || ageYears > 120) {
      return NextResponse.json(
        { error: "Birthday must be a valid past date (age 13–120)." },
        { status: 422 }
      );
    }
  }
  // Plausibility bounds (lib/body-bounds, shared with the wizard, the
  // settings form and the journal weigh-in): weight 50–700 lbs, height
  // 90–250 cm, the two must give a BMI of 10–100, and a goal weight must be
  // a BMI 15–60 target for the height. Until 2026-09-11 the server took
  // 0–1500 lbs and 0–300 cm with no cross-check. Zero/absent is left to the
  // existing truthiness handling (treated as not provided).
  const badNumber = (raw: unknown, min: number, max: number): boolean => {
    if (raw == null || raw === "") return false;
    const n = parseFloat(String(raw));
    return !Number.isFinite(n) || n < min || n > max;
  };
  if (badNumber(heightFt, 0, 8)) {
    return NextResponse.json({ error: "Height (ft) must be a number between 0 and 8.", field: "height" }, { status: 422 });
  }
  if (badNumber(heightIn, 0, 11.999)) {
    return NextResponse.json({ error: "Height (in) must be a number between 0 and 12.", field: "height" }, { status: 422 });
  }
  const num = (raw: unknown): number | null => (raw == null || raw === "" ? null : parseFloat(String(raw)));
  const heightRaw = num(height);
  const heightCm = heightRaw == null ? null : heightUnit === "in" ? heightRaw * CM_PER_IN : heightRaw;
  const bodyErr = firstBodyMetricsError(
    checkBodyMetrics(
      { weightLbs: num(weight), heightCm, goalWeightLbs: num(goalWeight) },
      { weight: "lbs", height: heightUnit === "ftin" ? "ftin" : heightUnit === "in" ? "in" : "cm" }
    )
  );
  if (bodyErr) {
    return NextResponse.json({ error: bodyErr.message, field: bodyErr.field }, { status: 422 });
  }
  // Names: a 5,000-character first name was accepted and stored (QA 2026-09-11).
  const MAX_NAME_CHARS = 100;
  for (const [field, value] of [["firstName", firstName], ["lastName", lastName]] as const) {
    if (value != null && (typeof value !== "string" || value.trim().length > MAX_NAME_CHARS)) {
      return NextResponse.json({ error: `Name must be ${MAX_NAME_CHARS} characters or fewer.`, field }, { status: 422 });
    }
  }

  // Snapshot existing patient state before update — used to detect meal-plan-affecting changes
  const existing = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      motivations:      { select: { motivationId: true } },
      foodAllergies:    { select: { foodId: true } },
      foodToAvoid:      { select: { foodId: true } },
      foodPreferences:  { select: { foodId: true } },
      healthConditions: { select: { conditionId: true, condition: { select: { ownerPatientId: true } } } },
    },
  });

  // Weight is always stored and displayed in lbs. The caloric engine converts
  // lbs → kg internally at its single input boundary (convertWeight).
  // Compute BMI using the caloric engine's unit-aware conversions.
  let bmi: number | null = null;
  if (height && weight) {
    const ht = convertHeight(parseFloat(height), heightUnit === "in" ? "in" : "cm");
    const wt = convertWeight(parseFloat(weight), "lbs");
    bmi = parseFloat(calcCBMI(wt.kg, ht.m2).toFixed(1));
  }

  await prisma.account.update({
    where: { id: account.id },
    data: {
      firstName: (typeof firstName === "string" && firstName.trim()) || account.firstName,
      lastName: (typeof lastName === "string" && lastName.trim()) || account.lastName,
      onboardingComplete: true,
      // Consent is recorded only when the client says the box was ticked —
      // never flipped back to false by a later save.
      ...((body as { agreedTerms?: unknown }).agreedTerms === true ? { agreedTerms: true } : {}),
    },
  });

  const isProfileComplete = !!(birthday && (height || (heightFt && heightIn)) && weight && physicalActivityId);

  // PATCH semantics: a key the client did not send is left unchanged. Until
  // 2026-09-11 an omitted sexAtBirth / physicalActivityId was written as null
  // and every omitted relation list was wiped (deleteMany + nothing), so a
  // client sending `{ weight }` alone silently erased the diet, allergies and
  // conditions. The web forms always send the full body; other clients may not.
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const idList = (key: string, raw: unknown): string[] | undefined =>
    sent(key) ? (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []) : undefined;
  const motivationList = idList("motivationIds", motivationIds);
  const conditionList = idList("healthConditionIds", healthConditionIds);
  const preferenceList = idList("foodPreferenceIds", foodPreferenceIds);
  const avoidList = idList("foodToAvoidIds", foodToAvoidIds);
  const allergyList = idList("foodAllergyIds", foodAllergyIds);
  const heightUnitValue = sent("heightUnit") ? (heightUnit ?? "ftin") : undefined;

  const patient = await prisma.patient.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      birthday: birthday ? new Date(birthday) : null,
      sexAtBirth: sexAtBirth || null,
      height: height ? parseFloat(height) : null,
      heightUnit: heightUnit ?? "ftin",
      heightFt: heightFt ? parseInt(heightFt) : null,
      heightIn: heightIn ? parseFloat(heightIn) : null,
      weight: weight ? parseFloat(weight) : null,
      weightUnit: "lbs",
      bmi,
      physicalActivityId: physicalActivityId || null,
      goalWeight: goalWeight ? parseFloat(goalWeight) : null,
      goalWeightUnit: "lbs",
      profileCompleted: isProfileComplete,
    },
    update: {
      birthday: birthday ? new Date(birthday) : undefined,
      sexAtBirth: sent("sexAtBirth") ? sexAtBirth || null : undefined,
      height: height ? parseFloat(height) : undefined,
      heightUnit: heightUnitValue,
      heightFt: sent("heightFt") ? (heightFt ? parseInt(heightFt) : null) : undefined,
      heightIn: sent("heightIn") ? (heightIn ? parseFloat(heightIn) : null) : undefined,
      weight: weight ? parseFloat(weight) : undefined,
      weightUnit: "lbs",
      bmi: bmi ?? undefined,
      physicalActivityId: sent("physicalActivityId") ? physicalActivityId || null : undefined,
      goalWeight: goalWeight ? parseFloat(goalWeight) : undefined,
      goalWeightUnit: "lbs",
      ...(isProfileComplete ? { profileCompleted: true } : {}),
    },
  });

  try {
    await prisma.$transaction([
      ...(motivationList
        ? [
            prisma.patientMotivation.deleteMany({ where: { patientId: patient.id } }),
            ...(motivationList.length ? [prisma.patientMotivation.createMany({ data: motivationList.map((id) => ({ patientId: patient.id, motivationId: id })), skipDuplicates: true })] : []),
          ]
        : []),
      // The built-in list is replaced; the user's own conditions (owner = this
      // patient, managed under /api/patient/conditions) keep their links.
      ...(conditionList
        ? [
            prisma.patientHealthCondition.deleteMany({ where: { patientId: patient.id, condition: { ownerPatientId: null } } }),
            ...(conditionList.length ? [prisma.patientHealthCondition.createMany({ data: conditionList.map((id) => ({ patientId: patient.id, conditionId: id })), skipDuplicates: true })] : []),
          ]
        : []),
      ...(preferenceList
        ? [
            prisma.patientFoodPreference.deleteMany({ where: { patientId: patient.id } }),
            ...(preferenceList.length ? [prisma.patientFoodPreference.createMany({ data: preferenceList.map((id) => ({ patientId: patient.id, foodId: id })), skipDuplicates: true })] : []),
          ]
        : []),
      ...(avoidList
        ? [
            prisma.patientFoodToAvoid.deleteMany({ where: { patientId: patient.id } }),
            ...(avoidList.length ? [prisma.patientFoodToAvoid.createMany({ data: avoidList.map((id) => ({ patientId: patient.id, foodId: id })), skipDuplicates: true })] : []),
          ]
        : []),
      ...(allergyList
        ? [
            prisma.patientFoodAllergy.deleteMany({ where: { patientId: patient.id } }),
            ...(allergyList.length ? [prisma.patientFoodAllergy.createMany({ data: allergyList.map((id) => ({ patientId: patient.id, foodId: id })), skipDuplicates: true })] : []),
          ]
        : []),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Two saves raced (double-submit): the winner's write is correct and
      // complete, so tell the loser to reload rather than 500 (S14).
      return NextResponse.json(
        { error: "Your profile was just saved — refresh the page to see it." },
        { status: 409 }
      );
    }
    return internalError("patient/profile", err, "Couldn't save your profile — please try again.");
  }

  // Detect whether any meal-plan-affecting fields changed. Fields whose
  // update-path preserves on omission (weight/height/birthday/goalWeight →
  // `undefined`) only count as changed when the client actually sent a value
  // — comparing an omitted field against null used to flag phantom changes
  // (audit Task 16). goalWeight was missing entirely despite driving the
  // ramp direction via resolvePlanDirection.
  const sorted = (arr: string[]) => JSON.stringify([...arr].sort());
  const listChanged = (current: string[], next: string[] | undefined) => next !== undefined && sorted(current) !== sorted(next);
  const mealPlanFieldsChanged = existing != null && (
    (sent("physicalActivityId") && existing.physicalActivityId !== (physicalActivityId || null)) ||
    (!!weight     && existing.weight     !== parseFloat(weight)) ||
    (!!height     && existing.height     !== parseFloat(height)) ||
    (!!goalWeight && existing.goalWeight !== parseFloat(goalWeight)) ||
    (heightUnitValue !== undefined && existing.heightUnit !== heightUnitValue) ||
    (!!birthday && (existing.birthday?.getTime() ?? null) !== new Date(birthday).getTime()) ||
    (sent("sexAtBirth") && existing.sexAtBirth !== (sexAtBirth || null)) ||
    listChanged(existing.motivations.map((m) => m.motivationId), motivationList) ||
    listChanged(existing.foodAllergies.map((f) => f.foodId), allergyList) ||
    listChanged(existing.foodToAvoid.map((f) => f.foodId), avoidList) ||
    listChanged(existing.foodPreferences.map((f) => f.foodId), preferenceList) ||
    // Built-in links only: custom links are untouched by this route.
    listChanged(existing.healthConditions.filter((c) => c.condition.ownerPatientId == null).map((c) => c.conditionId), conditionList)
  );

  // Strategy B: the profile save NEVER generates. If a plan already exists and a
  // plan-affecting field changed, mark it stale so the meal-plan page can offer a
  // Regenerate button. First-ever generation happens on the meal-plan page.
  if (patient.mealPlanStartDate && mealPlanFieldsChanged) {
    await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } });
  }

  return NextResponse.json({ ok: true, patientId: patient.id });
}
