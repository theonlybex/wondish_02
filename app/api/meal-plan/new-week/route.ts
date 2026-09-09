import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, clampPlanStartToToday, MealPlanBusyError, EmptyPlanError } from "@/lib/meal-plan-runner";
import { guardAiSpend } from "@/lib/ai-budget";
import { computeBasketReadiness } from "@/lib/basket-readiness";

export const maxDuration = 60;

// POST /api/meal-plan/new-week — generate the next 7-day week, constrained to
// the patient's pantry basket, sized to the ramp (anchored to the original
// plan start). Gated: the basket must be ready (min count + category coverage)
// so all 7 days can be filled without repeats. Manual, user-triggered only.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("regenerate", userId, 10, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { id: true, profileCompleted: true, mealPlanStartDate: true, activePlanVersion: true },
  });
  if (!patient) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (!patient.profileCompleted) return NextResponse.json({ error: "Profile not complete" }, { status: 422 });

  const items = await prisma.patientPantryItem.findMany({
    where: { patientId: patient.id },
    select: { ingredient: { select: { name: true } } },
  });
  const names = items.map((i) => i.ingredient.name);
  const status = computeBasketReadiness(names);
  if (!status.ready) {
    return NextResponse.json(
      { error: "Add more ingredients before generating a week.", ...status },
      { status: 422 }
    );
  }

  const guard = await guardAiSpend(userId, "planGen");
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const today = clampPlanStartToToday(new Date());
  const anchor = patient.mealPlanStartDate ? new Date(patient.mealPlanStartDate) : today;
  const basket = new Set(names.map((n) => n.trim().toLowerCase()));

  // Cross-week variety: avoid the dishes the current (about-to-be-replaced)
  // week used, so consecutive weeks don't repeat. Soft — the builder falls back
  // to reuse if the basket pool can't fill a slot otherwise.
  const prevWeek = await prisma.menu.findMany({
    where: { patientId: patient.id, planVersion: patient.activePlanVersion },
    select: { recipeId: true },
  });
  const excludeRecipeIds = new Set(prevWeek.map((m) => m.recipeId));

  try {
    const count = await regeneratePlan(patient.id, today, undefined, {
      claraFirst: true,
      windowDays: 7,
      anchorDate: anchor,
      basket,
      excludeRecipeIds,
    });
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    if (err instanceof MealPlanBusyError) {
      return NextResponse.json({ error: "A plan is already being generated." }, { status: 409 });
    }
    if (err instanceof EmptyPlanError) {
      return NextResponse.json(
        { error: "Couldn't build a week from these ingredients — add a few more and try again." },
        { status: 422 }
      );
    }
    throw err;
  }
}
