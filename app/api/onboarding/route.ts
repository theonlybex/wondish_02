// GET/PUT /api/onboarding — what the phone's first run reads and saves besides
// the profile itself (conditions, basics and allergies go through
// PATCH /api/patient/profile). Logic is in lib/onboarding.ts.
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { internalError } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildOnboardingResponse,
  planOnboardingPut,
  validateOnboardingBody,
} from "@/lib/onboarding";
import { TYPICAL_PILLS } from "@/lib/level-catalogue";

async function authorise() {
  const { userId } = await auth();
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { success } = await rateLimit("onboarding", userId, 60, 60);
  if (!success) {
    return { error: NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 }) };
  }
  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return { error: NextResponse.json({ error: "Account not found" }, { status: 404 }) };
  return { account };
}

async function load(accountId: string) {
  const [patient, conditions, allergies, activities] = await Promise.all([
    prisma.patient.findUnique({
      where: { accountId },
      include: {
        healthConditions: { select: { conditionId: true } },
        foodAllergies: { select: { foodId: true } },
        supplements: { where: { deletedAt: null }, select: { name: true } },
      },
    }),
    prisma.healthCondition.findMany({ where: { ownerPatientId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.foodAllergy.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.physicalActivity.findMany({ where: { level: { lte: 4 } }, orderBy: { level: "asc" }, select: { id: true, name: true } }),
  ]);
  return buildOnboardingResponse({
    conditions,
    allergies,
    activities,
    patient: patient && {
      ...patient,
      conditionIds: patient.healthConditions.map((c) => c.conditionId),
      allergyIds: patient.foodAllergies.map((a) => a.foodId),
    },
    pills: patient?.supplements.map((s) => s.name) ?? [],
  });
}

export async function GET() {
  const a = await authorise();
  if (a.error) return a.error;
  try {
    return NextResponse.json(await load(a.account.id));
  } catch (err) {
    return internalError("onboarding:get", err, "Couldn't load your answers — please try again.");
  }
}

export async function PUT(req: NextRequest) {
  const a = await authorise();
  if (a.error) return a.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", field: "body" }, { status: 422 });
  }
  const v = validateOnboardingBody(body);
  if (!v.ok) return NextResponse.json({ error: v.error, field: v.field }, { status: 422 });

  try {
    const patient = await prisma.patient.upsert({
      where: { accountId: a.account.id },
      create: { accountId: a.account.id },
      update: {},
      include: { supplements: { where: { deletedAt: null }, select: { id: true, name: true, estimated: true } } },
    });
    const { patientData, pillOps } = planOnboardingPut(v.value, {
      usualEating: patient.usualEating,
      supplements: patient.supplements,
    });
    await prisma.$transaction([
      ...pillOps.create.map((name) =>
        prisma.supplement.create({
          data: {
            patientId: patient.id,
            name,
            timeSlot: "MORNING",
            contents: TYPICAL_PILLS[name] as unknown as Prisma.InputJsonValue,
            estimated: true,
          },
        }),
      ),
      ...(pillOps.softDelete.length
        ? [prisma.supplement.updateMany({ where: { id: { in: pillOps.softDelete }, patientId: patient.id }, data: { deletedAt: new Date() } })]
        : []),
      prisma.patient.update({
        where: { id: patient.id },
        data: {
          startingPicture: patientData.startingPicture as unknown as Prisma.InputJsonValue,
          ...(patientData.usualEating ? { usualEating: patientData.usualEating as unknown as Prisma.InputJsonValue } : {}),
          ...(patientData.weightGoal !== undefined ? { weightGoal: patientData.weightGoal } : {}),
          ...(patientData.noCondition !== undefined ? { noCondition: patientData.noCondition } : {}),
        },
      }),
    ]);
    return NextResponse.json(await load(a.account.id));
  } catch (err) {
    return internalError("onboarding:put", err, "Couldn't save your answers — please try again.");
  }
}
