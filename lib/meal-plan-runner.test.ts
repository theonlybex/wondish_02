import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regeneratePlan,
  clampPlanStartToToday,
  MealPlanBusyError,
  EmptyPlanError,
  type RunnerDeps,
} from "./meal-plan-runner";
import type { BuildResult, MenuRow } from "./meal-plan";

// The two error classes' identity is a real contract: app/api/meal-plan/route.ts,
// .../regenerate/route.ts and .../start-date/route.ts all discriminate errors
// via `instanceof`, and the runner itself skips Sentry capture for
// EmptyPlanError via `instanceof`.

test("MealPlanBusyError carries the stable name and message code", () => {
  const err = new MealPlanBusyError();
  assert.equal(err.name, "MealPlanBusyError");
  assert.equal(err.message, "MEAL_PLAN_BUSY");
});

test("EmptyPlanError carries the stable name and message code", () => {
  const err = new EmptyPlanError();
  assert.equal(err.name, "EmptyPlanError");
  assert.equal(err.message, "EMPTY_PLAN");
});

test("both classes are proper Error subclasses (stack, Error prototype)", () => {
  for (const err of [new MealPlanBusyError(), new EmptyPlanError()]) {
    assert.ok(err instanceof Error);
    // Route handlers fall through to `err instanceof Error ? err.message : ...`
    // paths; a broken prototype chain (a classic TS Error-subclass pitfall
    // with ES5 targets) would silently reroute every busy/empty outcome.
    assert.equal(typeof err.stack, "string");
  }
});

test("the two error types are mutually exclusive under instanceof", () => {
  // API routes check MealPlanBusyError first, then EmptyPlanError — if one
  // ever became a subclass of the other, 409-busy responses would swallow
  // empty-plan outcomes (or vice versa).
  const busy = new MealPlanBusyError();
  const empty = new EmptyPlanError();
  assert.equal(busy instanceof EmptyPlanError, false);
  assert.equal(empty instanceof MealPlanBusyError, false);
});

test("instanceof survives a throw/catch boundary", () => {
  // Mirrors how every consumer actually receives these errors.
  try {
    throw new EmptyPlanError();
  } catch (err) {
    assert.ok(err instanceof EmptyPlanError);
    assert.ok(err instanceof Error);
    assert.equal((err as Error).message, "EMPTY_PLAN");
  }
});

// ─── regeneratePlan (via injected deps) ──────────────────────────────────────
//
// regeneratePlan takes an optional RunnerDeps whose default is the real
// prisma singleton + buildMealPlanMenus. The stub below records every prisma
// call in order and honors the args it receives (where-clauses, data payloads)
// instead of hardcoding outcomes, so a source regression that reorders the
// blue/green swap or drops a field makes these tests fail.

type LoggedCall = { op: string; args: any };

const ROWS: MenuRow[] = [
  { patientId: "p1", recipeId: "r1", mealTypeId: "mt-b", date: new Date("2026-07-20T00:00:00"), planVersion: 4 },
  { patientId: "p1", recipeId: "r2", mealTypeId: "mt-l", date: new Date("2026-07-20T00:00:00"), planVersion: 4 },
  { patientId: "p1", recipeId: "r3", mealTypeId: "mt-d", date: new Date("2026-07-21T00:00:00"), planVersion: 4 },
];

function makeDeps(opts: {
  claimCount?: number;
  activePlanVersion?: number;
  build?: BuildResult;
} = {}): { deps: RunnerDeps; calls: LoggedCall[] } {
  const calls: LoggedCall[] = [];
  const log = (op: string, args: any) => calls.push({ op, args });
  const deps: RunnerDeps = {
    prisma: {
      patient: {
        updateMany: async (args: any) => {
          log("patient.updateMany", args);
          return { count: opts.claimCount ?? 1 };
        },
        findUnique: async (args: any) => {
          log("patient.findUnique", args);
          return { activePlanVersion: opts.activePlanVersion ?? 0 };
        },
        update: async (args: any) => {
          log("patient.update", args);
          return {};
        },
      },
      menu: {
        deleteMany: async (args: any) => {
          log("menu.deleteMany", args);
          return { count: 0 };
        },
        createMany: async (args: any) => {
          log("menu.createMany", args);
          return { count: args?.data?.length ?? 0 };
        },
      },
    },
    buildMealPlanMenus: async (patientId, startDate, planVersion) => {
      log("buildMealPlanMenus", { patientId, startDate, planVersion });
      return opts.build ?? { rows: ROWS, builtForWeight: 82 };
    },
  };
  return { deps, calls };
}

const START = new Date("2026-07-20T14:37:22");

test("claim-lock: a live GENERATING run rejects with MealPlanBusyError and never touches menus", async () => {
  const { deps, calls } = makeDeps({ claimCount: 0 });
  await assert.rejects(regeneratePlan("p1", START, deps), MealPlanBusyError);
  assert.deepEqual(calls.map((c) => c.op), ["patient.updateMany"],
    "a failed claim must stop the run before any read, build, or menu write");
});

test("empty plan: rejects with EmptyPlanError and marks the patient FAILED without flipping", async () => {
  const { deps, calls } = makeDeps({
    activePlanVersion: 3,
    build: { rows: [], builtForWeight: 70 },
  });
  await assert.rejects(regeneratePlan("p1", START, deps), EmptyPlanError);

  assert.ok(!calls.some((c) => c.op === "menu.deleteMany" || c.op === "menu.createMany"),
    "an empty build must never purge or insert menu rows");

  const updates = calls.filter((c) => c.op === "patient.update");
  assert.equal(updates.length, 1, "exactly one patient.update — the FAILED status write");
  assert.equal(updates[0].args.where.id, "p1");
  assert.equal(updates[0].args.data.mealPlanStatus, "FAILED");
  assert.equal(typeof updates[0].args.data.mealPlanError, "string");
  assert.equal(updates[0].args.data.activePlanVersion, undefined,
    "the FAILED write must not flip the active version — the old plan stays live");
});

test("happy path: purge precedes insert, and the version flip lands only after insert", async () => {
  const { deps, calls } = makeDeps({ activePlanVersion: 3 });
  await regeneratePlan("p1", START, deps);

  const ops = calls.map((c) => c.op);
  assert.deepEqual(ops, [
    "patient.updateMany", // claim
    "patient.findUnique", // read activePlanVersion
    "buildMealPlanMenus", // build in memory
    "menu.deleteMany", // purge any half-written nextVersion rows
    "menu.createMany", // insert the new version
    "patient.update", // atomic flip
    "menu.deleteMany", // best-effort cleanup of old versions
  ]);

  // The builder gets the NEXT version and a midnight-normalized start.
  const build = calls.find((c) => c.op === "buildMealPlanMenus")!;
  assert.equal(build.args.planVersion, 4);
  assert.equal(build.args.startDate.getHours(), 0);
  assert.equal(build.args.startDate.toDateString(), START.toDateString());

  // Purge targets exactly the version about to be inserted.
  const purge = calls[3];
  assert.deepEqual(purge.args.where, { patientId: "p1", planVersion: 4 });
  const insert = calls[4];
  assert.deepEqual(insert.args.data, ROWS);

  // The flip carries the full READY payload, anchored to the builder's weight.
  const flip = calls[5];
  assert.equal(flip.args.where.id, "p1");
  assert.equal(flip.args.data.activePlanVersion, 4);
  assert.equal(flip.args.data.mealPlanStatus, "READY");
  assert.equal(flip.args.data.mealPlanStale, false);
  assert.equal(flip.args.data.mealPlanWeight, 82);

  // Cleanup only ever deletes OTHER versions.
  const cleanup = calls[6];
  assert.deepEqual(cleanup.args.where, { patientId: "p1", planVersion: { not: 4 } });
});

test("returns the number of menu rows created", async () => {
  const { deps } = makeDeps();
  assert.equal(await regeneratePlan("p1", START, deps), ROWS.length);
});

// ─── clampPlanStartToToday ───────────────────────────────────────────────────
// Regression guard for the stale-regenerate bug (2026-07-24, gg.bex.abdi):
// the client re-sent the OLD plan's mealPlanStartDate, so a "successful"
// regenerate built a plan entirely in the past and today's view came up empty.
// Routes that accept a client-supplied start date must clamp it to today.

test("clampPlanStartToToday: past start dates clamp to today's local midnight", () => {
  const now = new Date(2026, 6, 24, 14, 30); // Jul 24 2026, 2:30pm local
  const past = new Date(2026, 4, 26); // May 26 — the stale stored start date
  const clamped = clampPlanStartToToday(past, now);
  assert.equal(clamped.getTime(), new Date(2026, 6, 24).getTime());
});

test("clampPlanStartToToday: today and future start dates pass through unchanged", () => {
  const now = new Date(2026, 6, 24, 14, 30);
  const today = new Date(2026, 6, 24);
  assert.equal(clampPlanStartToToday(today, now).getTime(), today.getTime());
  const future = new Date(2026, 6, 30);
  assert.equal(clampPlanStartToToday(future, now).getTime(), future.getTime());
});

test("clampPlanStartToToday: does not mutate its input and returns a fresh Date", () => {
  const now = new Date(2026, 6, 24, 9, 0);
  const past = new Date(2026, 0, 1);
  const before = past.getTime();
  const clamped = clampPlanStartToToday(past, now);
  assert.equal(past.getTime(), before);
  assert.notEqual(clamped, past);
});
