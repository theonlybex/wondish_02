// GET/PUT /api/onboarding — what the phone's first run reads and saves besides
// the profile itself (conditions, basics and allergies go through
// PATCH /api/patient/profile). Logic is in lib/onboarding.ts.
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { internalError } from "@/lib/api-error";
import { AccountClaimConflictError, getOrCreateAccount } from "@/lib/auth";
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
  let account;
  try {
    account = await getOrCreateAccount(userId);
  } catch (err) {
    if (err instanceof AccountClaimConflictError) {
      return {
        error: NextResponse.json(
          { error: "email_conflict", message: "This email is already associated with another Wondish account. Contact support." },
          { status: 409 },
        ),
      };
    }
    return { error: internalError("onboarding:account", err, "Couldn't load your account — please try again.") };
  }
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
    // One interactive transaction. Postgres runs READ COMMITTED, so reading the
    // live pills in the same transaction is not enough on its own: the patient
    // row is locked first, which makes overlapping PUTs for one person run one
    // after the other, and the second reads the first's committed pills.
    await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.upsert({
        where: { accountId: a.account.id },
        create: { accountId: a.account.id },
        update: {},
        select: { id: true },
      });
      await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${patient.id} FOR UPDATE`;
      // The merge base is read AFTER the lock, so an overlapping PUT's committed
      // answers are never dropped.
      const locked = await tx.patient.findUniqueOrThrow({ where: { id: patient.id }, select: { usualEating: true } });
      const supplements = await tx.supplement.findMany({
        where: { patientId: patient.id, deletedAt: null },
        select: { id: true, name: true, estimated: true, contents: true },
      });
      const { patientData, pillOps, removeBuiltInConditions } = planOnboardingPut(v.value, {
        usualEating: locked.usualEating,
        supplements,
      });
      for (const name of pillOps.create) {
        await tx.supplement.create({
          data: {
            patientId: patient.id,
            name,
            timeSlot: "MORNING",
            contents: TYPICAL_PILLS[name] as unknown as Prisma.InputJsonValue,
            estimated: true,
          },
        });
      }
      for (const f of pillOps.fillContents) {
        await tx.supplement.update({
          where: { id: f.id },
          data: { contents: TYPICAL_PILLS[f.name] as unknown as Prisma.InputJsonValue, estimated: true },
        });
      }
      if (pillOps.softDelete.length) {
        await tx.supplement.updateMany({
          where: { id: { in: pillOps.softDelete }, patientId: patient.id },
          data: { deletedAt: new Date() },
        });
      }
      if (removeBuiltInConditions) {
        // Built-in links only; the person's own conditions stay.
        await tx.patientHealthCondition.deleteMany({
          where: { patientId: patient.id, condition: { ownerPatientId: null } },
        });
      }
      await tx.patient.update({
        where: { id: patient.id },
        data: {
          startingPicture: patientData.startingPicture as unknown as Prisma.InputJsonValue,
          ...(patientData.usualEating ? { usualEating: patientData.usualEating as unknown as Prisma.InputJsonValue } : {}),
          ...(patientData.weightGoal !== undefined ? { weightGoal: patientData.weightGoal } : {}),
          ...(patientData.noCondition !== undefined ? { noCondition: patientData.noCondition } : {}),
        },
      });
    });
    return NextResponse.json(await load(a.account.id));
  } catch (err) {
    return internalError("onboarding:put", err, "Couldn't save your answers — please try again.");
  }
}
