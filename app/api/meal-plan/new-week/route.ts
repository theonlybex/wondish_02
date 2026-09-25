import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { regeneratePlan, clampPlanStartToToday, MealPlanBusyError, EmptyPlanError, ThinPlanError, PlanPreflightError } from "@/lib/meal-plan-runner";
import { internalError } from "@/lib/api-error";
import { guardAiSpend } from "@/lib/ai-budget";
import { computeBasketReadiness } from "@/lib/basket-readiness";
import { parseRecentDishes, recentDishIds, mergeRecentDishes } from "@/lib/recent-dishes";

// 300s (Vercel's current default ceiling) not 60: a real week generation was
// measured at 55-73s, so the old cap killed it mid-build — and it had also
// forced ANTHROPIC_TIMEOUT_MS down to 25s, which timed out the recipe
// top-up and left slots filled by one repeated dish (2026-09-24).
export const maxDuration = 300;

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
    select: { id: true, profileCompleted: true, mealPlanStartDate: true, activePlanVersion: true, recentDishes: true },
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
      {
        // Name the gap. "Add more ingredients" to someone holding fifteen
        // savoury items and no breakfast food is not actionable (QA cycle 8).
        error: status.missingBreakfast
          ? "Add something for breakfast first — eggs, oats, bread or yoghurt. A week needs one."
          : status.count < status.min
            ? `Add ${status.min - status.count} more ingredient${status.min - status.count === 1 ? "" : "s"} before generating a week.`
            : `Add a ${status.missingCategories.join(" and a ")} before generating a week.`,
        ...status,
      },
      { status: 422 }
    );
  }

  const today = clampPlanStartToToday(new Date());
  const anchor = patient.mealPlanStartDate ? new Date(patient.mealPlanStartDate) : today;
  const basket = new Set(names.map((n) => n.trim().toLowerCase()));

  // Cross-week variety over a rolling ~2-month window: avoid every dish served
  // in the last RECENT_DISH_WINDOW_DAYS, so weeks don't repeat until a dish
  // rolls out and becomes eligible again. Soft — the builder falls back to
  // reuse if the basket pool can't otherwise fill a slot.
  const recent = parseRecentDishes(patient.recentDishes);
  const excludeRecipeIds = recentDishIds(recent);

  try {
    const count = await regeneratePlan(patient.id, today, undefined, {
      claraFirst: true,
      windowDays: 7,
      anchorDate: anchor,
      basket,
      excludeRecipeIds,
      // Charged only by the request that holds the claim (S8).
      preflight: async () => {
        const guard = await guardAiSpend(userId, "planGen");
        return guard.ok ? null : { status: guard.status, body: { ...guard.body } };
      },
    });

    // Record this week's dishes in the rolling window (prunes expired entries).
    const after = await prisma.patient.findUnique({
      where: { id: patient.id },
      select: { activePlanVersion: true },
    });
    const newMenus = await prisma.menu.findMany({
      where: { patientId: patient.id, planVersion: after?.activePlanVersion ?? patient.activePlanVersion },
      select: { recipeId: true },
    });
    const newIds = Array.from(new Set(newMenus.map((m) => m.recipeId)));
    const merged = mergeRecentDishes(recent, newIds);
    await prisma.patient
      .update({ where: { id: patient.id }, data: { recentDishes: merged } })
      .catch(() => {}); // best-effort: variety memory must never fail the request

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
        { error: "Couldn't build a week from these ingredients — add a few more and try again." },
        { status: 422 }
      );
    }
    return internalError("meal-plan/new-week", err, "Couldn't generate your week — please try again.");
  }
}
