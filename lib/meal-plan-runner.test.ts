import { test } from "node:test";
import assert from "node:assert/strict";
import { MealPlanBusyError, EmptyPlanError } from "./meal-plan-runner";

// regeneratePlan() is intentionally NOT tested here: it is bound to Prisma
// (claim-lock updateMany, menu insert/delete, version flip) and Sentry.
// The pure surface of this module is its two error classes, whose identity
// is a real contract: app/api/meal-plan/route.ts, .../regenerate/route.ts and
// .../start-date/route.ts all discriminate errors via `instanceof`, and the
// runner itself skips Sentry capture for EmptyPlanError via `instanceof`.

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
