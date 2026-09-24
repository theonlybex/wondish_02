import { test } from "node:test";
import assert from "node:assert/strict";
import { planBadgeFor } from "./plan-badge";

// The header pill must never claim more than the spend guard grants. The
// 2026-09-17 QA run: a coupon holder read "Premium ✦" top-right, expected
// 5 new weeks, and got a 429 at 3 — because the layout only asked "is any
// row premium?" and a COUPON row says yes. The badge now follows tierFor.

const FUTURE = new Date("2100-01-01T00:00:00.000Z");
const couponLive = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const stripeLive = { source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: FUTURE };
const appleLive = { source: "APPLE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const adminGrant = { source: "ADMIN", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const stripeFree = { source: "STRIPE", plan: "FREE", status: "ACTIVE", stripeCurrentPeriodEnd: null };
const stripeCanceled = { source: "STRIPE", plan: "PREMIUM", status: "CANCELED", stripeCurrentPeriodEnd: FUTURE };
const couponExpired = { source: "COUPON", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date("2020-01-01") };

test("a coupon-only account is BETA, not PREMIUM", () => {
  assert.equal(planBadgeFor([couponLive], false), "BETA");
  assert.equal(planBadgeFor([stripeFree, couponLive], false), "BETA");
});

test("any live paid row outranks a coupon: the precedence case (COUPON + STRIPE) is PREMIUM", () => {
  assert.equal(planBadgeFor([couponLive, stripeLive], false), "PREMIUM");
  assert.equal(planBadgeFor([stripeLive, couponLive], false), "PREMIUM");
  assert.equal(planBadgeFor([stripeLive], false), "PREMIUM");
  assert.equal(planBadgeFor([appleLive], false), "PREMIUM");
  assert.equal(planBadgeFor([adminGrant], false), "PREMIUM");
});

test("nothing live is FREE — a canceled paid row or an expired coupon does not count", () => {
  assert.equal(planBadgeFor([], false), "FREE");
  assert.equal(planBadgeFor([stripeFree], false), "FREE");
  assert.equal(planBadgeFor([stripeCanceled], false), "FREE");
  assert.equal(planBadgeFor([couponExpired], false), "FREE");
  assert.equal(planBadgeFor([null, undefined], false), "FREE");
});

test("SUPER admins are ADMIN whatever their rows say", () => {
  assert.equal(planBadgeFor([], true), "ADMIN");
  assert.equal(planBadgeFor([couponLive], true), "ADMIN");
  assert.equal(planBadgeFor([stripeLive], true), "ADMIN");
});

// A source-level guard, not a unit test. The badge bug was never in this
// function — it was a SECOND place computing the pill its own way:
// /restaurants/layout.tsx asked accountHasActivePremium and collapsed the
// answer to PREMIUM/FREE, so a coupon holder read "✦ Plus ✦" there while
// every other page said "Beta". Any new layout rendering DashboardHeader
// must take the string from planBadgeFor.
test("every DashboardHeader render site derives its plan from planBadgeFor", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".tsx")) files.push(p);
    }
  };
  await walk("app");

  const offenders: string[] = [];
  for (const f of files) {
    const src = await readFile(f, "utf8");
    if (!/<DashboardHeader/.test(src)) continue;
    if (!/planBadgeFor/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `these render the plan pill without planBadgeFor: ${offenders.join(", ")}`);
});
