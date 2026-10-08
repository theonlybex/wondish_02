import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { KITCHEN_BASICS, validateMissingBasics } from "@/lib/kitchen-basics";

// GET  /api/pantry/basics — the kitchen basics and which ones the diner lacks
// PUT  /api/pantry/basics — { missing: string[] } (keys from lib/kitchen-basics)
// An unticked basic is never assumed by plans, cookable, Clara or What to buy.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { missingStaples: true } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({
    basics: KITCHEN_BASICS.map((b) => ({ key: b.key, label: b.label })),
    missing: validateMissingBasics(patient.missingStaples),
  });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("pantry-basics", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  let body: { missing?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const missing = validateMissingBasics(body.missing);
  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { id: true, missingStaples: true, mealPlanStartDate: true } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const changed = [...missing].sort().join(",") !== [...validateMissingBasics(patient.missingStaples)].sort().join(",");
  await prisma.patient.update({
    where: { id: patient.id },
    // What the plan may assume changed: an existing plan is offered a rebuild.
    data: { missingStaples: missing, ...(changed && patient.mealPlanStartDate ? { mealPlanStale: true } : {}) },
  });
  return NextResponse.json({ missing });
}
