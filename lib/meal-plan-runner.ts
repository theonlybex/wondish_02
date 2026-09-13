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

// Thrown by regeneratePlan / withPlanClaim when the caller's preflight (the
// AI spend guard) rejects AFTER the claim was taken. Carries the exact JSON
// the route should answer with. Status is restored, nothing is built.
export class PlanPreflightError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>
  ) {
    super("PLAN_PREFLIGHT");
    this.name = "PlanPreflightError";
  }
}

export type PlanPreflight = () => Promise<{ status: number; body: Record<string, unknown> } | null>;

// A GENERATING run older than this is considered dead and may be re-claimed.
const STUCK_AFTER_MS = 3 * 60 * 1000;

/**
 * Clamp a client-supplied plan start date to today's local midnight.
 * A start date in the past builds a plan whose window can end before today,
 * so "today's meals" is legitimately empty and the UI reads as generation
 * having failed (2026-07-24: client re-sent the old mealPlanStartDate).
 * Every route that passes a client date to regeneratePlan must clamp first.
 */
export function clampPlanStartToToday(start: Date, now: Date = new Date()): Date {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return start < today ? today : new Date(start);
}

// Only the prisma members regeneratePlan actually touches. Method syntax (not
// arrow-property syntax) keeps parameter checking bivariant so the real
// PrismaClient satisfies this shape while tests can inject an in-memory stub.
export interface PrismaLike {
  patient: {
    updateMany(args: any): Promise<{ count: number }>;
    findUnique(args: any): Promise<{ activePlanVersion?: number; mealPlanStatus?: string; mealPlanGenStartedAt?: Date | null } | null>;
    update(args: any): Promise<unknown>;
  };
  menu: {
    deleteMany(args: any): Promise<unknown>;
    createMany(args: any): Promise<unknown>;
  };
}

// Injectable collaborators. Defaults are the real singletons, so existing
// callers (`regeneratePlan(id, date)`) are unchanged.
export interface RunnerDeps {
  prisma: PrismaLike;
  buildMealPlanMenus: typeof buildMealPlanMenus;
}

const defaultDeps: RunnerDeps = { prisma, buildMealPlanMenus };

type PreviousStatus = { mealPlanStatus?: string; mealPlanGenStartedAt?: Date | null } | null;

async function readPlanStatus(patientId: string, deps: RunnerDeps): Promise<PreviousStatus> {
  return deps.prisma.patient.findUnique({
    where: { id: patientId },
    select: { activePlanVersion: true, mealPlanStatus: true, mealPlanGenStartedAt: true },
  });
}

/** Put the row back the way it was before the claim (never leaves GENERATING behind). */
async function restorePlanStatus(patientId: string, before: PreviousStatus, deps: RunnerDeps): Promise<void> {
  const status = before?.mealPlanStatus && before.mealPlanStatus !== "GENERATING" ? before.mealPlanStatus : "READY";
  await deps.prisma.patient
    .update({
      where: { id: patientId },
      data: { mealPlanStatus: status, mealPlanGenStartedAt: before?.mealPlanGenStartedAt ?? null },
    })
    .catch(() => {});
}

/**
 * Atomically claim the patient's generation slot (status -> GENERATING).
 * Succeeds only if not GENERATING, OR the previous run is stuck. Throws
 * MealPlanBusyError otherwise. Every writer of Menu rows must hold this.
 */
export async function claimPlanSlot(patientId: string, deps: RunnerDeps = defaultDeps): Promise<void> {
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const claim = await deps.prisma.patient.updateMany({
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
}

/**
 * Run `fn` while holding the plan claim, then restore the previous status.
 * For writers that edit the ACTIVE version in place (cuisine-for-today)
 * rather than doing the blue/green swap: holding the claim means no
 * regenerate can flip activePlanVersion underneath them, and no second
 * copy of themselves can double-insert. `fn` receives the live version.
 */
export async function withPlanClaim<T>(
  patientId: string,
  fn: (activePlanVersion: number) => Promise<T>,
  deps: RunnerDeps = defaultDeps,
): Promise<T> {
  const before = await readPlanStatus(patientId, deps);
  await claimPlanSlot(patientId, deps);
  try {
    const live = await deps.prisma.patient.findUnique({ where: { id: patientId }, select: { activePlanVersion: true } });
    const result = await fn(live?.activePlanVersion ?? 0);
    await restorePlanStatus(patientId, before, deps);
    return result;
  } catch (err) {
    await restorePlanStatus(patientId, before, deps);
    throw err;
  }
}

/**
 * Regenerate a patient's meal plan as a blue/green swap:
 *  1. Atomically claim the slot (status -> GENERATING). Reject if already running.
 *  2. Build the next version's menus in memory (algorithm unchanged).
 *  3. Insert them under a NEW planVersion (invisible to version-scoped reads).
 *  4. Atomically flip activePlanVersion -> new version (+ READY, stale=false).
 *  5. Best-effort delete of stale older-version rows.
 * On any failure after claiming, status -> FAILED and the OLD plan stays active.
 */
export async function regeneratePlan(
  patientId: string,
  startDate: Date,
  deps: RunnerDeps = defaultDeps,
  opts: { claraFirst?: boolean; cuisine?: string | null; windowDays?: number; anchorDate?: Date; basket?: Set<string>; excludeRecipeIds?: Set<string>; preflight?: PlanPreflight } = {},
): Promise<number> {
  // Only read the previous status when a preflight can need to restore it,
  // so callers without one keep the exact call sequence the tests pin.
  const before = opts.preflight ? await readPlanStatus(patientId, deps) : null;

  // 1. Claim. Succeeds only if not GENERATING, OR the previous run is stuck.
  await claimPlanSlot(patientId, deps);

  // 1b. Preflight UNDER the claim (the AI spend guard). Only the request
  // that will actually build is charged: a double-click's loser fails the
  // claim above and never reaches here, so it costs the user nothing.
  if (opts.preflight) {
    const rejected = await opts.preflight();
    if (rejected) {
      await restorePlanStatus(patientId, before, deps);
      throw new PlanPreflightError(rejected.status, rejected.body);
    }
  }

  try {
    const patient = await deps.prisma.patient.findUnique({
      where: { id: patientId },
      select: { activePlanVersion: true },
    });
    const nextVersion = (patient?.activePlanVersion ?? 0) + 1;

    // 2. Build the next version's menus in memory. Normalize the start to
    // midnight BEFORE building so menu row dates and the stored
    // mealPlanStartDate agree instead of the rows carrying request time-of-day.
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const { rows, builtForWeight } = await deps.buildMealPlanMenus(patientId, start, nextVersion, opts);

    // Guard: never flip to an empty plan. If the builder produced nothing
    // (e.g. an over-restrictive profile vs the recipe catalog), keep the current
    // plan active by NOT flipping the version — the caller is told it failed.
    if (rows.length === 0) throw new EmptyPlanError();

    // 3. Insert the new version (still invisible to version-scoped reads).
    // A previous run may have inserted this same version's rows and then failed
    // before the flip; purge them first or the retry would double every meal.
    await deps.prisma.menu.deleteMany({ where: { patientId, planVersion: nextVersion } });
    await deps.prisma.menu.createMany({ data: rows });

    // 4. Atomic flip — the moment version-scoped reads start seeing the new plan.
    await deps.prisma.patient.update({
      where: { id: patientId },
      data: {
        activePlanVersion: nextVersion,
        // Rolling weeks keep the original anchor (day-1 of the calorie ramp);
        // only a fresh plan (no anchor passed) stamps today's start.
        mealPlanStartDate: opts.anchorDate ?? start,
        mealPlanStatus: "READY",
        mealPlanStale: false,
        mealPlanError: null,
        // Anchor the plan to the weight it was built for — from the builder's
        // own patient read, so a weigh-in landing mid-generation can't make
        // the anchor disagree with the weight the calorie targets used.
        mealPlanWeight: builtForWeight,
      },
    });

    // 5. Best-effort cleanup of old versions. Safe to fail (orphans only).
    await deps.prisma.menu
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
    await deps.prisma.patient
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
