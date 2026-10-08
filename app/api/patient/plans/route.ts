import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { CUSTOM_PLAN_LIMITS, validateCustomPlan } from "@/lib/custom-plans";
import { flagPlanStale, patientForClerk } from "@/lib/custom-conditions-server";
import { CUSTOM_PLAN_SELECT, listCustomPlans, planNameTaken, toCustomPlanView } from "@/lib/custom-plans-server";

// GET  /api/patient/plans — the caller's own eating plans
// POST /api/patient/plans — { name, avoid[], guidance? }: creates the plan and
// puts the caller on it (a FoodPreference they own, enforced like any diet).

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await patientForClerk(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({ plans: await listCustomPlans(patient.id), limit: CUSTOM_PLAN_LIMITS.perPatient });
}

export async function POST(req: NextRequest) {
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
  const count = await prisma.foodPreference.count({ where: { ownerPatientId: patient.id } });
  if (count >= CUSTOM_PLAN_LIMITS.perPatient) {
    return NextResponse.json({ error: `You can keep up to ${CUSTOM_PLAN_LIMITS.perPatient} plans of your own.`, field: "name" }, { status: 422 });
  }
  if (await planNameTaken(patient.id, v.value.name)) {
    return NextResponse.json({ error: "A diet or plan with that name already exists — pick it from the list or choose another name.", field: "name" }, { status: 409 });
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.foodPreference.create({
      data: {
        name: v.value.name,
        guidance: v.value.guidance,
        ownerPatientId: patient.id,
        bannedIngredients: { create: v.value.avoid.map((name) => ({ name })) },
      },
      select: { id: true },
    });
    await tx.patientFoodPreference.create({ data: { patientId: patient.id, foodId: created.id } });
    return tx.foodPreference.findUniqueOrThrow({ where: { id: created.id }, select: CUSTOM_PLAN_SELECT });
  });
  await flagPlanStale(patient);
  return NextResponse.json({ plan: toCustomPlanView(row) }, { status: 201 });
}
