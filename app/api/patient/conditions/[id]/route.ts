import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { validateCustomCondition } from "@/lib/custom-conditions";
import {
  CUSTOM_CONDITION_SELECT,
  conditionNameTaken,
  flagPlanStale,
  patientForClerk,
  syncSymptomItems,
  toCustomConditionView,
} from "@/lib/custom-conditions-server";

// PATCH  /api/patient/conditions/:id — same body as POST; replaces name, bans
//        and guidance; symptoms are synced by label (history kept).
// DELETE /api/patient/conditions/:id — unlinks, then deletes (bans, items and
//        their journal symptoms cascade).

async function ownedCondition(userId: string, id: string) {
  const patient = await patientForClerk(userId);
  if (!patient) return { patient: null, condition: null };
  const condition = await prisma.healthCondition.findFirst({ where: { id, ownerPatientId: patient.id }, select: { id: true } });
  return { patient, condition };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("custom-conditions", userId, 30, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const v = validateCustomCondition(body);
  if (!v.ok) return NextResponse.json({ error: v.error, field: v.field }, { status: 422 });

  const { patient, condition } = await ownedCondition(userId, params.id);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!condition) return NextResponse.json({ error: "Condition not found" }, { status: 404 });
  if (await conditionNameTaken(patient.id, v.value.name, condition.id)) {
    return NextResponse.json({ error: "A condition with that name already exists — choose another name.", field: "name" }, { status: 409 });
  }

  const row = await prisma.$transaction(async (tx) => {
    await tx.healthCondition.update({ where: { id: condition.id }, data: { name: v.value.name, guidance: v.value.guidance } });
    await tx.healthConditionBannedIngredient.deleteMany({ where: { conditionId: condition.id } });
    if (v.value.avoid.length) {
      await tx.healthConditionBannedIngredient.createMany({ data: v.value.avoid.map((name) => ({ conditionId: condition.id, name })), skipDuplicates: true });
    }
    await syncSymptomItems(tx, condition.id, v.value.symptoms);
    return tx.healthCondition.findUniqueOrThrow({ where: { id: condition.id }, select: CUSTOM_CONDITION_SELECT });
  });
  await flagPlanStale(patient);
  return NextResponse.json({ condition: toCustomConditionView(row) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { patient, condition } = await ownedCondition(userId, params.id);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!condition) return NextResponse.json({ error: "Condition not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.patientHealthCondition.deleteMany({ where: { conditionId: condition.id } }),
    prisma.healthCondition.delete({ where: { id: condition.id } }),
  ]);
  await flagPlanStale(patient);
  return NextResponse.json({ ok: true });
}
