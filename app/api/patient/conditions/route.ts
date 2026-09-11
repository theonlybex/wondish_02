import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { CUSTOM_CONDITION_LIMITS, validateCustomCondition } from "@/lib/custom-conditions";
import {
  CUSTOM_CONDITION_SELECT,
  conditionNameTaken,
  flagPlanStale,
  listCustomConditions,
  newTrackingItem,
  patientForClerk,
  toCustomConditionView,
} from "@/lib/custom-conditions-server";

// GET  /api/patient/conditions — the caller's own conditions
// POST /api/patient/conditions — { name, avoid[], guidance?, symptoms[] }
// Spec: docs/superpowers/specs/2026-09-11-custom-conditions-design.md

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({ conditions: await listCustomConditions(patient.id), limit: CUSTOM_CONDITION_LIMITS.perPatient });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("custom-conditions", userId, 30, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const v = validateCustomCondition(body);
  if (!v.ok) return NextResponse.json({ error: v.error, field: v.field }, { status: 422 });

  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const count = await prisma.healthCondition.count({ where: { ownerPatientId: patient.id } });
  if (count >= CUSTOM_CONDITION_LIMITS.perPatient) {
    return NextResponse.json({ error: `You can keep up to ${CUSTOM_CONDITION_LIMITS.perPatient} of your own conditions.`, field: "name" }, { status: 422 });
  }
  if (await conditionNameTaken(patient.id, v.value.name)) {
    return NextResponse.json({ error: "A condition with that name already exists — pick it from the list above or choose another name.", field: "name" }, { status: 409 });
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.healthCondition.create({
      data: {
        name: v.value.name,
        guidance: v.value.guidance,
        ownerPatientId: patient.id,
        bannedIngredients: { create: v.value.avoid.map((name) => ({ name })) },
        trackingItems: { create: v.value.symptoms.map(newTrackingItem) },
      },
      select: CUSTOM_CONDITION_SELECT,
    });
    await tx.patientHealthCondition.create({ data: { patientId: patient.id, conditionId: created.id } });
    return created;
  });
  await flagPlanStale(patient);
  return NextResponse.json({ condition: toCustomConditionView(row) }, { status: 201 });
}
