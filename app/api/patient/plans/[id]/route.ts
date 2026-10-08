import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { validateCustomPlan } from "@/lib/custom-plans";
import { flagPlanStale, patientForClerk } from "@/lib/custom-conditions-server";
import { CUSTOM_PLAN_SELECT, ownedPlan, planNameTaken, toCustomPlanView } from "@/lib/custom-plans-server";

// PATCH  /api/patient/plans/[id] — edit one of the caller's own plans
// DELETE /api/patient/plans/[id] — remove it (and the caller from it)

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("custom-plans", userId, 30, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const v = validateCustomPlan(body);
  if (!v.ok) return NextResponse.json({ error: v.error, field: v.field }, { status: 422 });

  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const plan = await ownedPlan(patient.id, params.id);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (await planNameTaken(patient.id, v.value.name, plan.id)) {
    return NextResponse.json({ error: "A diet or plan with that name already exists — choose another name.", field: "name" }, { status: 409 });
  }

  const row = await prisma.$transaction(async (tx) => {
    await tx.foodPreference.update({ where: { id: plan.id }, data: { name: v.value.name, guidance: v.value.guidance } });
    await tx.foodPreferenceBannedIngredient.deleteMany({ where: { preferenceId: plan.id } });
    if (v.value.avoid.length) {
      await tx.foodPreferenceBannedIngredient.createMany({ data: v.value.avoid.map((name) => ({ preferenceId: plan.id, name })), skipDuplicates: true });
    }
    return tx.foodPreference.findUniqueOrThrow({ where: { id: plan.id }, select: CUSTOM_PLAN_SELECT });
  });
  await flagPlanStale(patient);
  return NextResponse.json({ plan: toCustomPlanView(row) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const plan = await ownedPlan(patient.id, params.id);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.patientFoodPreference.deleteMany({ where: { foodId: plan.id } }),
    prisma.foodPreference.delete({ where: { id: plan.id } }),
  ]);
  await flagPlanStale(patient);
  return NextResponse.json({ ok: true });
}
