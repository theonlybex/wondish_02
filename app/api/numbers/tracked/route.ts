// PUT /api/numbers/tracked  { tracked: ["iron", "fibre"] }  ->  { tracked: [...] }
// Replaces the tracked set: one row per level, tracked true or false.
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { LEVELS } from "@/lib/level-catalogue";
import { isAvailable, validateTrackedBody } from "@/lib/numbers-full";

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("numbers-write", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({ where: { account: { clerkId: userId } }, select: { id: true, healthConditions: { select: { condition: { select: { name: true } } } } } });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const conditionNames = patient.healthConditions.map((h) => h.condition.name);
  const parsed = validateTrackedBody(body, conditionNames);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: parsed.status });

  const on = new Set<string>(parsed.value);
  await prisma.$transaction(
    LEVELS.filter((l) => isAvailable(l.key, conditionNames)).map((l) =>
      prisma.trackedLevel.upsert({
        where: { patientId_levelKey: { patientId: patient.id, levelKey: l.key } },
        create: { patientId: patient.id, levelKey: l.key, tracked: on.has(l.key) },
        update: { tracked: on.has(l.key) },
      }),
    ),
  );
  return NextResponse.json({ tracked: parsed.value });
}
