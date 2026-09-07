import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { guardAiSpend } from "@/lib/ai-budget";
import {
  normalizeCuisine,
  generateAndPersistRecipes,
  type TopUpRequest,
} from "@/lib/clara/recipe-generation";
import { getPlanDayCalories } from "@/lib/meal-plan";
import { computeMealCalories } from "@/lib/caloric-engine";
import { derivePatientBans, buildDietMatchers, PATIENT_DIET_INCLUDE } from "@/lib/diet-match";

export const maxDuration = 60;

// POST /api/meal-plan/day — regenerate ONLY the requested day in a chosen
// cuisine, leaving the rest of the active plan untouched. This is the "pick a
// cuisine for today" action: additive on top of the unchanged whole-plan
// builder. Clara proposes; the same deterministic gates (allergen filter,
// macro/calorie sanity) dispose, and survivors overwrite just that date's
// Menu rows for the active plan version.

function localMidnight(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same bucket as the whole-plan rebuild — a day patch is a plan write too.
  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { date, cuisine } = (body ?? {}) as { date?: unknown; cuisine?: unknown };

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: { ...PATIENT_DIET_INCLUDE },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) {
    return NextResponse.json({ error: "Profile not complete" }, { status: 422 });
  }

  // Day patches can trigger a Clara generation — same spend guard as full plans.
  const guard = await guardAiSpend(userId, "planGen");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const localDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : toLocalDateString(new Date());
  const dayStart = localMidnight(localDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  // Day calorie total from the same engine the plan uses; split per meal.
  const dayTotal = (await getPlanDayCalories(patient.id, localDate)) ?? 2000;
  const mealCals = computeMealCalories(dayTotal);

  const mealTypes = await prisma.mealType.findMany();
  const order = ["breakfast", "lunch", "dinner", "snack"];
  const slots = mealTypes
    .filter((mt) => order.includes(mt.name.toLowerCase()))
    .sort((a, b) => order.indexOf(a.name.toLowerCase()) - order.indexOf(b.name.toLowerCase()));
  if (slots.length === 0) {
    return NextResponse.json({ error: "No meal types configured." }, { status: 500 });
  }

  const { allergyNames, exactBanned } = derivePatientBans(patient);
  const matchers = buildDietMatchers({ allergyNames, exactBanned });

  const existingNames = new Set(
    (await prisma.recipe.findMany({ where: { isPublic: true }, select: { name: true } })).map((r) =>
      r.name.trim().toLowerCase()
    )
  );

  // One dish per slot, in the chosen cuisine, sized to that slot's target.
  const requests: TopUpRequest[] = slots.map((s) => ({
    mealTypeId: s.id,
    mealTypeName: s.name,
    count: 1,
    targetCalories: mealCals[s.name.toLowerCase()] ?? Math.round(dayTotal / slots.length),
  }));

  const createdIds = await generateAndPersistRecipes({
    requests,
    bannedNames: [...allergyNames, ...exactBanned.map((b) => b.name)],
    matchers,
    existingNames,
    cuisine: normalizeCuisine(cuisine),
  });
  if (createdIds.length === 0) {
    return NextResponse.json(
      { error: "Clara couldn't build a safe day in that cuisine — try another." },
      { status: 422 }
    );
  }

  // Map created dishes to slots (one per meal type) and write just this day.
  const created = await prisma.recipe.findMany({
    where: { id: { in: createdIds } },
    select: { id: true, mealTypeId: true },
  });
  const bySlot = new Map<string, string>();
  for (const r of created) {
    if (r.mealTypeId && !bySlot.has(r.mealTypeId)) bySlot.set(r.mealTypeId, r.id);
  }
  if (bySlot.size === 0) {
    return NextResponse.json(
      { error: "Clara couldn't build a safe day in that cuisine — try another." },
      { status: 422 }
    );
  }

  const planVersion = patient.activePlanVersion;
  const rows = Array.from(bySlot.entries()).map(([mealTypeId, recipeId]) => ({
    patientId: patient.id,
    recipeId,
    mealTypeId,
    date: dayStart,
    planVersion,
  }));

  await prisma.$transaction([
    prisma.menu.deleteMany({
      where: { patientId: patient.id, planVersion, date: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.menu.createMany({ data: rows }),
  ]);

  return NextResponse.json({ ok: true, count: rows.length });
}
