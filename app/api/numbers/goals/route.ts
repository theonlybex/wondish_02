// PUT /api/numbers/goals  { goals: [{ key: "fibre", amount: 30 }] }  (amount null clears)
//   ->  { goals: [{ key, amount }] }
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ageOn, rowsToMaterialize, validateGoalsBody } from "@/lib/numbers-full";

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("numbers-write", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true, birthday: true, sexAtBirth: true, healthConditions: { select: { condition: { select: { name: true } } } } },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const parsed = validateGoalsBody(body, {
    sexAtBirth: patient.sexAtBirth === "MALE" || patient.sexAtBirth === "FEMALE" ? patient.sexAtBirth : null,
    age: patient.birthday ? ageOn(patient.birthday.toISOString().slice(0, 10), today) : null,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: parsed.status });

  // A first stored row would replace the condition defaults with "tracks only
  // this", so a person with no rows gets the defaults written out first.
  const existing = await prisma.trackedLevel.findMany({ where: { patientId: patient.id }, select: { levelKey: true } });
  const base = rowsToMaterialize(existing, patient.healthConditions.map((h) => h.condition.name));
  const defaults = new Map(base.map((r) => [r.levelKey, r.tracked]));

  await prisma.$transaction([
    ...base.filter((r) => !parsed.value.some((g) => g.key === r.levelKey)).map((r) =>
      prisma.trackedLevel.create({ data: { patientId: patient.id, levelKey: r.levelKey, tracked: r.tracked } }),
    ),
    ...parsed.value.map((g) =>
      prisma.trackedLevel.upsert({
        where: { patientId_levelKey: { patientId: patient.id, levelKey: g.key } },
        // Existing rows only change the goal. A new row for a person who already
        // has rows starts untracked, so saving a goal never adds to their set.
        create: { patientId: patient.id, levelKey: g.key, tracked: defaults.get(g.key) ?? false, goal: g.amount },
        update: { goal: g.amount },
      }),
    ),
  ]);
  return NextResponse.json({ goals: parsed.value });
}
