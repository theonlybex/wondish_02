import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { eligibleRules, mayStart } from "@/lib/trials/eligibility";
import { phaseFor, isEnforced, startDateFor } from "@/lib/trials/schedule";
import { categoryTitle, termsForCategory } from "@/lib/trials/category-terms";
import { loadTrialPatient, syncTrialPhase, trialViewFor } from "@/lib/trials/server";

// Trigger trials (workbook 04). One ACTIVE trial per patient; the phase is
// computed from the start date; enforcement happens in lib/diet-match.

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("trials", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const patient = await loadTrialPatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const today = new Date();
  const conditionNames = patient.healthConditions.map((hc) => hc.condition.name);

  const active = patient.triggerTrials.find((t) => t.status === "ACTIVE") ?? null;
  if (active) await syncTrialPhase(patient.id, active, today);

  const rules = conditionNames.length === 0 ? [] : await prisma.triggerRule.findMany({
    where: { active: true, condition: { name: { in: conditionNames } } },
    include: { condition: { select: { name: true } } },
    orderBy: [{ condition: { name: "asc" } }, { category: "asc" }],
  });
  const eligible = eligibleRules(
    conditionNames,
    rules.map((r) => ({ id: r.id, code: r.code, category: r.category, conditionName: r.condition.name, active: r.active })),
    patient.triggerTrials.map((t) => ({ ruleId: t.ruleId, category: t.rule.category, status: t.status, classification: t.classification }))
  ).map((e) => {
    const r = rules.find((x) => x.id === e.id)!;
    return { id: r.id, category: r.category, title: categoryTitle(r.category), conditionName: r.condition.name, examples: r.examples, safetyNote: r.safetyNote, sourceUrl: r.sourceUrl, baselineDays: r.baselineDays, trialDays: r.trialDays, terms: termsForCategory(r.category).terms };
  });

  const activeView = active ? await trialViewFor(patient.id, active, today) : null;
  const history = await Promise.all(patient.triggerTrials.filter((t) => t.status !== "ACTIVE").map((t) => trialViewFor(patient.id, t, today)));
  const fresh = await prisma.patient.findUnique({ where: { id: patient.id }, select: { mealPlanStale: true } });

  return NextResponse.json({ eligible, active: activeView, history, mealPlanStale: fresh?.mealPlanStale ?? patient.mealPlanStale, conditionNames });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("trials", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: { ruleId?: unknown; skipBaseline?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof body.ruleId !== "string") return NextResponse.json({ error: "ruleId is required" }, { status: 400 });
  const skipBaseline = body.skipBaseline === true;

  const patient = await loadTrialPatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (patient.triggerTrials.some((t) => t.status === "ACTIVE")) {
    return NextResponse.json({ error: "You already have a trial running — finish or stop it first." }, { status: 409 });
  }
  const rule = await prisma.triggerRule.findUnique({ where: { id: body.ruleId }, include: { condition: { select: { name: true } } } });
  if (!rule) return NextResponse.json({ error: "Unknown trigger" }, { status: 404 });
  const conditionNames = patient.healthConditions.map((hc) => hc.condition.name);
  if (!mayStart(conditionNames, { id: rule.id, code: rule.code, category: rule.category, conditionName: rule.condition.name, active: rule.active })) {
    return NextResponse.json({ error: "That trigger belongs to a condition that isn't on your profile." }, { status: 403 });
  }

  const today = new Date();
  const startDate = startDateFor(rule, today, skipBaseline);
  const phase = phaseFor(rule, startDate, today).phase;
  try {
    const trial = await prisma.$transaction(async (tx) => {
      const created = await tx.triggerTrial.create({ data: { patientId: patient.id, ruleId: rule.id, startDate, status: "ACTIVE", lastPhase: phase } });
      if (isEnforced(phase)) await tx.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } });
      return created;
    });
    return NextResponse.json({ ok: true, id: trial.id, phase }, { status: 201 });
  } catch (err) {
    // Partial unique index TriggerTrial_one_active_per_patient → a race started two.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "You already have a trial running — finish or stop it first." }, { status: 409 });
    }
    throw err;
  }
}
