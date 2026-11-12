// PUT /api/numbers/goals  { goals: [{ key: "fibre", amount: 30 }] }  (amount null clears)
//   ->  { goals: [{ key, amount }] }
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getDayTarget } from "@/lib/meal-log";
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
  const conditionNames = patient.healthConditions.map((h) => h.condition.name);
  const dayTarget = await getDayTarget(patient.id, today, false);
  const parsed = validateGoalsBody(body, {
    person: {
      sexAtBirth: patient.sexAtBirth === "MALE" || patient.sexAtBirth === "FEMALE" ? patient.sexAtBirth : null,
      age: patient.birthday ? ageOn(patient.birthday.toISOString().slice(0, 10), today) : null,
    },
    macroTargets: dayTarget ? { protein: dayTarget.protein, carbs: dayTarget.carbs } : null,
    conditionNames,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: parsed.status });

  // A first stored row would replace the condition defaults with "tracks only
  // this", so a person with no rows gets the defaults written out first.
  const existing = await prisma.trackedLevel.findMany({ where: { patientId: patient.id }, select: { levelKey: true } });
  const base = rowsToMaterialize(existing, conditionNames);
  const defaults = new Map(base.map((r) => [r.levelKey, r.tracked]));

  // Seed with skipDuplicates so two overlapping saves never collide, then set goals.
  const seed = base;
  await prisma.$transaction([
    ...(seed.length > 0
      ? [prisma.trackedLevel.createMany({ data: seed.map((r) => ({ patientId: patient.id, levelKey: r.levelKey, tracked: r.tracked })), skipDuplicates: true })]
      : []),
    ...parsed.value.map((g) =>
      prisma.trackedLevel.upsert({
        where: { patientId_levelKey: { patientId: patient.id, levelKey: g.key } },
        // A new row for a person who already has rows starts untracked, so
        // saving a goal never adds to their set.
        create: { patientId: patient.id, levelKey: g.key, tracked: defaults.get(g.key) ?? false, goal: g.amount },
        update: { goal: g.amount },
      }),
    ),
  ]);
  return NextResponse.json({ goals: parsed.value });
}
