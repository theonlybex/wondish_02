import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { acquireInFlight } from "./in-flight-lock";

// ── The bug this file exists for ─────────────────────────────────────────────
//
// cook-my-day held its in-flight lock with `rateLimit(..., 1, 90)`. That call
// has no release, so the lock outlived the work: a run that finished in eight
// seconds left the user refused for eighty-two more with "Clara is already
// cooking your day", about a day that was already on their screen. QA reported
// it in cycle 14, cycle 15 fixed the ORDER of the quota check around it and not
// the lock, and it survived into cycle 16.
//
// Two halves, because that is the lesson cycle 15 paid for: the primitive must
// release (below), and the route must actually call the release (further down).
// Testing only the first would pass while the feature stayed broken.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a released lock is immediately free again", async () => {
  const user = `u-${Math.random()}`;

  const first = await acquireInFlight("test-release", user, 90);
  assert.equal(first.acquired, true, "an unheld lock must be acquirable");

  const second = await acquireInFlight("test-release", user, 90);
  assert.equal(second.acquired, false, "a held lock must refuse the second caller");

  await first.release();

  // The 90-second TTL has not passed. Under the old rate-limit shape this is
  // exactly where the user waited; under a lock it is free the moment the work
  // is done.
  const third = await acquireInFlight("test-release", user, 90);
  assert.equal(third.acquired, true, "after release the lock must be free WITHOUT waiting out the TTL");
  await third.release();
});

test("locks are per-user and per-name — one user's run never blocks another's", async () => {
  const a = await acquireInFlight("test-scope", "user-a", 90);
  const b = await acquireInFlight("test-scope", "user-b", 90);
  const c = await acquireInFlight("test-other", "user-a", 90);
  assert.deepEqual(
    [a.acquired, b.acquired, c.acquired],
    [true, true, true],
    "a lock must be keyed by both name and identifier"
  );
  await Promise.all([a.release(), b.release(), c.release()]);
});

test("release is safe to call twice", async () => {
  const user = `u-${Math.random()}`;
  const lock = await acquireInFlight("test-double", user, 90);
  await lock.release();
  await lock.release(); // must not throw, and must not free someone else's lock
  const next = await acquireInFlight("test-double", user, 90);
  assert.equal(next.acquired, true);
  await next.release();
});

// ── The half that watches the caller ─────────────────────────────────────────
//
// A route can hold a perfectly releasable lock and never release it. The
// release has to be in a `finally`, not on the success path: an early return
// (no meal types, Clara busy, no safe day) or a thrown error would otherwise
// leave it held for the full TTL — which is the original bug wearing a
// different hat.
const LOCKING_ROUTES = ["app/api/pantry/cook-day/route.ts"];

test("every route that takes an in-flight lock releases it in a finally", () => {
  const offenders: string[] = [];
  for (const file of LOCKING_ROUTES) {
    const src = readFileSync(join(REPO_ROOT, file), "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    let takesLock = false;
    let releasesInFinally = false;

    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText() === "acquireInFlight") takesLock = true;
      if (ts.isTryStatement(n) && n.finallyBlock) {
        const text = n.finallyBlock.getText();
        if (/\.release\(\)/.test(text)) releasesInFinally = true;
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);

    if (takesLock && !releasesInFinally) {
      offenders.push(`  ${file} — takes a lock and never releases it in a finally`);
    }
    if (!takesLock) {
      offenders.push(`  ${file} — no longer takes a lock; update LOCKING_ROUTES in this test`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `In-flight locks held past the work:\n${offenders.join("\n")}\n\n` +
      "The release belongs in a `finally`. Every early return in this route — no meal types, " +
      "Clara busy, no safe day from the pantry — is a path where a success-path release would " +
      "leave the user refused for the full TTL about work that already stopped."
  );
});
