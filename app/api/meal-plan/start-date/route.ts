// PREMIUM GATE (parked 2026-09-17 — uncomment with the block below to restore):
// import { premiumGatesEnabled } from "@/lib/billing/gates";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, clampPlanStartToToday, MealPlanBusyError, EmptyPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";
import { internalError } from "@/lib/api-error";
import { guardAiSpend, tierFor } from "@/lib/ai-budget";

// 300s (Vercel's current default ceiling) not 60: a real week generation was
// measured at 55-73s, so the old cap killed it mid-build — and it had also
// forced ANTHROPIC_TIMEOUT_MS down to 25s, which timed out the recipe
// top-up and left slots filled by one repeated dish (2026-09-24).
export const maxDuration = 300;

// Full regenerate-route gate set (2026-07-24 audit Task 13): this endpoint
// triggers the same expensive full-plan rebuild as /regenerate but shipped
// with none of its guards — a free-user paywall bypass, plus garbage dates
// stamping mealPlanStatus FAILED with a misleading error.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same bucket as /regenerate — both trigger the same rebuild.
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
  const { startDate } = (body ?? {}) as { startDate?: unknown };

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
    select: { id: true, profileCompleted: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  const parsed = new Date(typeof startDate === "string" || typeof startDate === "number" ? startDate : NaN);
  if (Number.isNaN(parsed.getTime())) {
    return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
  }
  parsed.setHours(0, 0, 0, 0);
  // A past start builds a plan that can end before today — the UI then reads
  // an empty "today" as generation having failed.
  const start = clampPlanStartToToday(parsed);

  // Atomic blue/green regenerate — no unguarded wipe.
  try {
    const count = await regeneratePlan(patient.id, start, undefined, {
      // Generation can trigger a Clara top-up call — spend guard. Charged
      // under the claim so a losing double-click costs nothing.
      preflight: async () => {
        const guard = await guardAiSpend(userId, "planInit", aiTier);
        return guard.ok ? null : { status: guard.status, body: { ...guard.body } };
      },
    });
    return NextResponse.json({ ok: true, count, startDate: start.toISOString() });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof PlanPreflightError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "No meals matched your current profile, so your existing plan was kept." },
        { status: 422 }
      );
    }
    return internalError("meal-plan/start-date", err, "Couldn't change your start date — please try again.");
  }
}
