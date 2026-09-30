// PREMIUM GATE (parked 2026-09-17 — uncomment with the block below to restore):
// import { premiumGatesEnabled } from "@/lib/billing/gates";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, MealPlanBusyError, EmptyPlanError, ThinPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";
import { chargeAiSpend, guardGlobalAiSpend, remainingAiSpend, tierFor, weekBuildKind, type AiTier } from "@/lib/ai-budget";
import { internalError } from "@/lib/api-error";

export const runtime = "nodejs";
// 300s (Vercel's current default ceiling) not 60: a real week generation was
// measured at 55-73s, so the old cap killed it mid-build — and it had also
// forced ANTHROPIC_TIMEOUT_MS down to 25s, which timed out the recipe
// top-up and left slots filled by one repeated dish (2026-09-24).
export const maxDuration = 300;

const MIN_INTERVAL_MS = 2 * 60 * 1000; // anti-spam: 1 regenerate / 2 min

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user endpoint guard (shared via Upstash): caps repeated hits even when
  // they fail before the per-row 2-min window / claim-lock would apply.
  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } } },
  });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const isAdmin = account.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const aiTier = tierFor(account.subscriptions, isAdmin);
  // PREMIUM GATE (parked): blocked the whole endpoint before the allowance
  // model replaced it. isPremium is gone, so this is the aiTier equivalent.
  // if (premiumGatesEnabled() && aiTier === "free") return NextResponse.json({ error: "Premium required" }, { status: 403 });

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    select: { id: true, profileCompleted: true, mealPlanStatus: true, mealPlanGenStartedAt: true, mealPlanStale: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  // Anti-spam: block only successful READY runs that finished recently.
  if (
    patient.mealPlanStatus === "READY" &&
    patient.mealPlanGenStartedAt &&
    Date.now() - patient.mealPlanGenStartedAt.getTime() < MIN_INTERVAL_MS
  ) {
    return NextResponse.json(
      { error: "Please wait a moment before regenerating again." },
      { status: 429 }
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Checked before, charged on delivery — same as /new-week.
  let spend: { kind: ReturnType<typeof weekBuildKind>; tier: AiTier } | null = null;
  try {
    const count = await regeneratePlan(patient.id, today, undefined, {
      // Generation can trigger a Clara top-up call — spend guard. Charged
      // only by the request that holds the claim, so a double-click's loser
      // (409 busy) is never billed a week it didn't get.
      preflight: async () => {
        // Same rule as /new-week (weekBuildKind). iOS calls here.
        const hasAnyPlan = (await prisma.menu.count({ where: { patientId: patient.id } })) > 0;
        const kind = weekBuildKind({ hasAnyPlan, stale: patient.mealPlanStale });
        const guard = await remainingAiSpend(userId, kind, aiTier);
        if (!guard.ok) return { status: guard.status, body: { ...guard.body } };
        // The model runs either way, so Free's daily budget pays for the attempt.
        const globalGuard = await guardGlobalAiSpend(guard.tier, kind);
        if (!globalGuard.ok) return { status: globalGuard.status, body: { ...globalGuard.body } };
        spend = { kind, tier: guard.tier };
        return null;
      },
    });
    // (Assigned inside preflight, which TypeScript can't see from here.)
    const charged = spend as { kind: ReturnType<typeof weekBuildKind>; tier: AiTier } | null;
    if (charged) await chargeAiSpend(userId, charged.kind, charged.tier);
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof PlanPreflightError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    // Rows were built, but not enough of the week to be usable (e.g. only
    // lunches). The previous plan is still active; say what was missing.
    if (err instanceof ThinPlanError) {
      return NextResponse.json(
        {
          error: `We could only fill ${err.filledCoreSlots} of ${err.expectedCoreSlots} meals from your ingredients — your previous plan was kept. Add a few more, especially breakfast staples, and try again.`,
          code: "thin_plan",
          filledCoreSlots: err.filledCoreSlots,
          expectedCoreSlots: err.expectedCoreSlots,
        },
        { status: 422 }
      );
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept. Try relaxing some restrictions." },
        { status: 422 }
      );
    }
    return internalError("meal-plan/regenerate", err, "Couldn't regenerate your plan — please try again.");
  }
}
