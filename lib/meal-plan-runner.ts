import { prisma } from "@/lib/db";
import { buildMealPlanMenus } from "@/lib/meal-plan";
import * as Sentry from "@sentry/nextjs";

// Thrown when a generation is already in flight for this patient.
export class MealPlanBusyError extends Error {
  constructor() {
    super("MEAL_PLAN_BUSY");
    this.name = "MealPlanBusyError";
  }
}

// Thrown when generation produced zero menus — we refuse to replace a working
// plan with nothing, so the current plan is kept and this is surfaced instead.
export class EmptyPlanError extends Error {
  constructor() {
    super("EMPTY_PLAN");
    this.name = "EmptyPlanError";
  }
}

// A GENERATING run older than this is considered dead and may be re-claimed.
const STUCK_AFTER_MS = 3 * 60 * 1000;

/**
 * Regenerate a patient's meal plan as a blue/green swap:
 *  1. Atomically claim the slot (status -> GENERATING). Reject if already running.
 *  2. Build the next version's menus in memory (algorithm unchanged).
 *  3. Insert them under a NEW planVersion (invisible to version-scoped reads).
 *  4. Atomically flip activePlanVersion -> new version (+ READY, stale=false).
 *  5. Best-effort delete of stale older-version rows.
 * On any failure after claiming, status -> FAILED and the OLD plan stays active.
 */
export async function regeneratePlan(patientId: string, startDate: Date): Promise<number> {
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MS);

  // 1. Claim. Succeeds only if not GENERATING, OR the previous run is stuck.
  const claim = await prisma.patient.updateMany({
    where: {
      id: patientId,
      OR: [
        { mealPlanStatus: { not: "GENERATING" } },
        { mealPlanGenStartedAt: { lt: stuckCutoff } },
      ],
    },
    data: { mealPlanStatus: "GENERATING", mealPlanGenStartedAt: new Date(), mealPlanError: null },
  });
  if (claim.count === 0) throw new MealPlanBusyError();

  try {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { activePlanVersion: true, weight: true },
    });
    const nextVersion = (patient?.activePlanVersion ?? 0) + 1;

    // 2. Build the next version's menus in memory.
    const rows = await buildMealPlanMenus(patientId, startDate, nextVersion);

    // Guard: never flip to an empty plan. If the builder produced nothing
    // (e.g. an over-restrictive profile vs the recipe catalog), keep the current
    // plan active by NOT flipping the version — the caller is told it failed.
    if (rows.length === 0) throw new EmptyPlanError();

    // 3. Insert the new version (still invisible to version-scoped reads).
    await prisma.menu.createMany({ data: rows });

    // 4. Atomic flip — the moment version-scoped reads start seeing the new plan.
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        activePlanVersion: nextVersion,
        mealPlanStartDate: start,
        mealPlanStatus: "READY",
        mealPlanStale: false,
        mealPlanError: null,
        // Anchor the plan to the weight it was built for, so later journal
        // weigh-ins can detect meaningful drift and offer a regenerate.
        mealPlanWeight: patient?.weight ?? null,
      },
    });

    // 5. Best-effort cleanup of old versions. Safe to fail (orphans only).
    await prisma.menu
      .deleteMany({ where: { patientId, planVersion: { not: nextVersion } } })
      .catch(() => {});

    return rows.length;
  } catch (err) {
    const message =
      err instanceof EmptyPlanError
        ? "No meals matched your current profile, so your existing plan was kept."
        : err instanceof Error
        ? err.message
        : String(err);
    await prisma.patient
      .update({
        where: { id: patientId },
        data: { mealPlanStatus: "FAILED", mealPlanError: message },
      })
      .catch(() => {});
    // EmptyPlanError is an expected business outcome, not an incident.
    if (!(err instanceof EmptyPlanError)) {
      Sentry.captureException(err, { tags: { area: "meal-plan-runner" }, extra: { patientId } });
    }
    throw err;
  }
}
