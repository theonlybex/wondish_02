import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { loadTrialPatient, trialViewFor } from "@/lib/trials/server";

// PATCH /api/trials/:id  { action: "stop" | "classify" | "clear", classification?, notes? }
//   stop     — ACTIVE → STOPPED (releases the ban)
//   classify — ACTIVE, from the evaluation day on → COMPLETED with the user's
//              classification; scores frozen; LIKELY_TRIGGER keeps the ban
//   clear    — COMPLETED LIKELY_TRIGGER → STOPPED (classification kept for history)
const CLASSIFICATIONS = new Set(["TOLERATED", "DOSE_DEPENDENT", "LIKELY_TRIGGER"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await rateLimit("trials", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let body: { action?: unknown; classification?: unknown; notes?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const action = body.action;
  if (action !== "stop" && action !== "classify" && action !== "clear") return NextResponse.json({ error: "action must be stop, classify or clear" }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : undefined;

  const patient = await loadTrialPatient(userId);
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  const trial = patient.triggerTrials.find((t) => t.id === params.id);
  if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
  const today = new Date();

  if (action === "stop") {
    if (trial.status !== "ACTIVE") return NextResponse.json({ error: "Only a running trial can be stopped" }, { status: 409 });
    await prisma.$transaction([
      prisma.triggerTrial.update({ where: { id: trial.id }, data: { status: "STOPPED", ...(notes !== undefined ? { notes } : {}) } }),
      prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } }),
    ]);
    return NextResponse.json({ ok: true, status: "STOPPED" });
  }

  if (action === "classify") {
    if (trial.status !== "ACTIVE") return NextResponse.json({ error: "Only a running trial can be classified" }, { status: 409 });
    if (typeof body.classification !== "string" || !CLASSIFICATIONS.has(body.classification)) {
      return NextResponse.json({ error: "classification must be TOLERATED, DOSE_DEPENDENT or LIKELY_TRIGGER" }, { status: 400 });
    }
    const view = await trialViewFor(patient.id, trial, today);
    if (!view.canClassify) return NextResponse.json({ error: "You can classify from the evaluation day (day 28) onwards." }, { status: 409 });
    const classification = body.classification as "TOLERATED" | "DOSE_DEPENDENT" | "LIKELY_TRIGGER";
    await prisma.$transaction([
      prisma.triggerTrial.update({
        where: { id: trial.id },
        data: {
          status: "COMPLETED",
          classification,
          baselineScore: view.scores.baseline,
          eliminationScore: view.scores.elimination,
          challengeScore: view.scores.challenge,
          ...(notes !== undefined ? { notes } : {}),
        },
      }),
      // A likely trigger keeps its ban, so the plan does not change; anything
      // else releases the trigger and the week should be rebuilt.
      ...(classification === "LIKELY_TRIGGER" ? [] : [prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } })]),
    ]);
    return NextResponse.json({ ok: true, status: "COMPLETED", classification });
  }

  // clear
  if (trial.status !== "COMPLETED" || trial.classification !== "LIKELY_TRIGGER") {
    return NextResponse.json({ error: "Only a likely-trigger result can be cleared" }, { status: 409 });
  }
  await prisma.$transaction([
    prisma.triggerTrial.update({ where: { id: trial.id }, data: { status: "STOPPED" } }),
    prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStale: true } }),
  ]);
  return NextResponse.json({ ok: true, status: "STOPPED" });
}
