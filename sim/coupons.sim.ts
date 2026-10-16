// Coupon codes, end to end (2026-10-16): the real route handlers — pricing
// promo preview, coupon redeem, /r/code (park a code before sign-up) and
// /r/claim (redeem it after) — run against an in-memory database seeded with
// the real 4XHANF8X row. One named check per fix shipped that day:
//   A. the landing-page promo field redeems admin coupons (it only asked Stripe)
//   B. a signed-out visitor's code is carried through sign-up and redeemed
// The PlanPicker click sequence is replayed by `applyOnPricingField`, which
// calls the same endpoints in the same order and maps the result with the
// component's own helper.
//
//   node --experimental-test-module-mocks --import tsx --test sim/coupons.sim.ts
import { mock, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Prisma } from "@prisma/client";

// ── mocks, before any service module loads ──────────────────────────────────
const req = createRequire(__filename);
const who: { userId: string | null } = { userId: null };
mock.module(pathToFileURL(req.resolve("server-only")).href, { namedExports: {} });
mock.module(pathToFileURL(req.resolve("@clerk/nextjs/server")).href, {
  namedExports: {
    auth: async () => ({ userId: who.userId }),
    clerkClient: async () => {
      throw new Error("sim: every account is pre-seeded; nothing should reach Clerk");
    },
    currentUser: async () => null,
  },
});
// Stripe knows exactly one promotion code.
const STRIPE_CODE = "STRIPE10";
class FakeStripe {
  promotionCodes = {
    list: async ({ code }: { code: string }) => ({
      data:
        code.toUpperCase() === STRIPE_CODE
          ? [{ id: "promo_sim", coupon: { valid: true, percent_off: 10, amount_off: null, duration: "once", duration_in_months: null, name: "10%" } }]
          : [],
    }),
  };
}
mock.module(pathToFileURL(req.resolve("stripe")).href, { defaultExport: FakeStripe });
process.env.STRIPE_SECRET_KEY = "sk_test_sim";
delete process.env.UPSTASH_REDIS_REST_URL; // in-memory rate limiter
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RATE_LIMIT_ENFORCE_BACKEND;

// ── in-memory database ──────────────────────────────────────────────────────
type Sub = { accountId: string; source: string; plan: string; status: string; stripeCurrentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; canceledAt?: Date | null };
type Coupon = { id: string; code: string; type: "PREMIUM" | "ADMIN"; maxUses: number; usedCount: number; expiresAt: Date | null; accessUntil: Date | null; isActive: boolean; note: string | null; createdAt: Date };
type Db = {
  accounts: { id: string; clerkId: string; email: string }[];
  subs: Sub[];
  coupons: Coupon[];
  redemptions: { couponId: string; accountId: string; redeemedAt: Date }[];
  roles: { accountId: string; role: string }[];
};
let db: Db;
const calls = { couponLookups: 0 };
let failNextCouponLookup = false;

const pick = <T extends object>(row: T, select?: Record<string, unknown>) =>
  select ? (Object.fromEntries(Object.keys(select).map((k) => [k, (row as any)[k]])) as T) : row;
const subKey = (w: any) => w.accountId_source;

function client(): any {
  return {
    account: {
      findUnique: async ({ where, include, select }: any) => {
        const a = db.accounts.find((x) => x.clerkId === where.clerkId);
        if (!a) return null;
        return include?.subscriptions ? { ...a, subscriptions: db.subs.filter((s) => s.accountId === a.id) } : pick(a, select);
      },
    },
    subscription: {
      findMany: async ({ where, select }: any) => db.subs.filter((s) => s.accountId === where.accountId).map((s) => pick(s, select)),
      findUnique: async ({ where, select }: any) => {
        const k = subKey(where);
        const s = db.subs.find((x) => x.accountId === k.accountId && x.source === k.source);
        return s ? pick(s, select) : null;
      },
      upsert: async ({ where, update, create }: any) => {
        const k = subKey(where);
        const s = db.subs.find((x) => x.accountId === k.accountId && x.source === k.source);
        if (s) return Object.assign(s, update);
        const row = { cancelAtPeriodEnd: false, ...create };
        db.subs.push(row);
        return row;
      },
    },
    coupon: {
      findUnique: async ({ where, include }: any) => {
        calls.couponLookups++;
        if (failNextCouponLookup) {
          failNextCouponLookup = false;
          throw new Error("sim: database unavailable");
        }
        const c = db.coupons.find((x) => x.code === where.code);
        if (!c) return null;
        const accountId = include?.redemptions?.where?.accountId;
        return { ...c, redemptions: db.redemptions.filter((r) => r.couponId === c.id && r.accountId === accountId) };
      },
      updateMany: async ({ where, data }: any) => {
        const known = new Set(["id", "isActive", "usedCount"]);
        for (const k of Object.keys(where)) if (!known.has(k)) throw new Error(`sim: unsupported where key ${k}`);
        const rows = db.coupons.filter(
          (c) => c.id === where.id && c.isActive === where.isActive && (!where.usedCount || c.usedCount < where.usedCount.lt)
        );
        for (const c of rows) c.usedCount += data.usedCount.increment;
        return { count: rows.length };
      },
    },
    couponRedemption: {
      create: async ({ data }: any) => {
        if (db.redemptions.some((r) => r.couponId === data.couponId && r.accountId === data.accountId)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "sim" });
        }
        const row = { ...data, redeemedAt: new Date() };
        db.redemptions.push(row);
        return row;
      },
    },
    role: { upsert: async ({ where }: any) => ({ id: `role-${where.name}`, name: where.name }) },
    accountRole: {
      upsert: async ({ where }: any) => {
        const { accountId, roleId } = where.accountId_roleId;
        const role = roleId.replace(/^role-/, "");
        if (!db.roles.some((r) => r.accountId === accountId && r.role === role)) db.roles.push({ accountId, role });
        return {};
      },
    },
    // All-or-nothing like Postgres: a throw restores the state from before.
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const before = structuredClone(db);
      try {
        return await fn(client());
      } catch (err) {
        db = before;
        throw err;
      }
    },
  };
}
(globalThis as any).prisma = client();

// ── fixtures ────────────────────────────────────────────────────────────────
const NOV_30 = new Date("2026-11-30T23:59:59.999Z"); // 4XHANF8X's real accessUntil
const REAL = "4XHANF8X";
const ADMIN_CODE = "QA-ADMINSIM";
const FULL_CODE = "QA-FULL";

beforeEach(() => {
  db = {
    accounts: [
      { id: "acc-friend", clerkId: "user_friend", email: "friend@sim" },
      { id: "acc-new", clerkId: "user_new", email: "new@sim" },
      { id: "acc-new2", clerkId: "user_new2", email: "new2@sim" },
      { id: "acc-plus", clerkId: "user_plus", email: "plus@sim" },
    ],
    subs: [
      // A free user's leftover canceled Stripe row (the QA free fixture's shape).
      { accountId: "acc-friend", source: "STRIPE", plan: "FREE", status: "CANCELED", stripeCurrentPeriodEnd: null, cancelAtPeriodEnd: false },
      { accountId: "acc-plus", source: "STRIPE", plan: "PREMIUM", status: "ACTIVE", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * 864e5), cancelAtPeriodEnd: false },
    ],
    coupons: [
      { id: "c-real", code: REAL, type: "PREMIUM", maxUses: 20, usedCount: 0, expiresAt: null, accessUntil: NOV_30, isActive: true, note: "For friends", createdAt: new Date() },
      { id: "c-admin", code: ADMIN_CODE, type: "ADMIN", maxUses: 5, usedCount: 0, expiresAt: null, accessUntil: null, isActive: true, note: null, createdAt: new Date() },
      { id: "c-full", code: FULL_CODE, type: "PREMIUM", maxUses: 1, usedCount: 1, expiresAt: null, accessUntil: NOV_30, isActive: true, note: null, createdAt: new Date() },
    ],
    redemptions: [],
    roles: [],
  };
  calls.couponLookups = 0;
  failNextCouponLookup = false;
});

// ── drivers ─────────────────────────────────────────────────────────────────
const routes = async () => ({
  promo: await import("@/app/api/billing/promo/route"),
  redeem: await import("@/app/api/coupon/redeem/route"),
  park: await import("@/app/r/code/[code]/route"),
  claim: await import("@/app/r/claim/route"),
  entry: await import("@/lib/billing/promo-entry"),
  pending: await import("@/lib/pending-coupon"),
});
const quietly = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const { error, warn, log } = console;
  console.error = console.warn = console.log = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, warn, log });
  }
};
const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const coupon = (code: string) => db.coupons.find((c) => c.code === code)!;
const grant = (accountId: string) => db.subs.find((s) => s.accountId === accountId && s.source === "COUPON");

// What PlanPicker does on Apply: Stripe preview first; 401 → park the code
// and go to sign-up; unknown to Stripe → redeem as an admin coupon.
async function applyOnPricingField(code: string) {
  const r = await routes();
  const preview = await r.promo.POST(json("http://localhost/api/billing/promo", { code, plan: "sixmonth" }) as any);
  if (preview.status === 401) {
    const park = await r.park.GET(new Request(`http://localhost/r/code/${encodeURIComponent(code)}`) as any, { params: { code: encodeURIComponent(code) } });
    return { kind: "toSignUp" as const, park };
  }
  const p = await preview.json();
  if (p.valid) return { kind: "stripePreview" as const, preview: p };
  const res = await quietly(() => r.redeem.POST(json("http://localhost/api/coupon/redeem", { code }) as any));
  return { kind: "redeemed" as const, result: r.entry.couponRedeemResult(res.status, await res.json().catch(() => null)) };
}

// Clerk's landing after a sign-up, with whatever cookies the browser holds.
async function claim(cookies: Record<string, string>) {
  const { NextRequest } = await import("next/server");
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await quietly(async () => (await routes()).claim.GET(new NextRequest("http://localhost/r/claim", { headers: cookie ? { cookie } : {} })));
  return { location: res.headers.get("location") ?? "", setCookie: res.headers.get("set-cookie") ?? "" };
}
const parkedCookie = (setCookie: string) => /wondish_coupon=([^;]*)/.exec(setCookie)?.[1] ?? null;

// ── A. the promo field redeems admin coupons ────────────────────────────────
test("A1 · the original bug: Stripe alone calls 4XHANF8X invalid", async () => {
  who.userId = "user_friend";
  const res = await (await routes()).promo.POST(json("http://localhost/api/billing/promo", { code: REAL, plan: "sixmonth" }) as any);
  assert.deepEqual(await res.json(), { valid: false });
});

test("A2 · signed in, Apply on 4XHANF8X grants beta until Nov 30 and uses one slot", async () => {
  who.userId = "user_friend";
  const out = await applyOnPricingField(REAL);
  assert.equal(out.kind, "redeemed");
  assert.deepEqual(out.kind === "redeemed" && out.result, { kind: "activated", admin: false, until: NOV_30.toISOString() });
  assert.equal(coupon(REAL).usedCount, 1);
  assert.equal(db.redemptions.length, 1);
  assert.deepEqual(
    { plan: grant("acc-friend")?.plan, status: grant("acc-friend")?.status, end: grant("acc-friend")?.stripeCurrentPeriodEnd?.toISOString() },
    { plan: "PREMIUM", status: "ACTIVE", end: NOV_30.toISOString() }
  );
  // The old canceled Stripe row is untouched (coupon writes its own row).
  assert.equal(db.subs.find((s) => s.accountId === "acc-friend" && s.source === "STRIPE")?.status, "CANCELED");
});

test("A3 · the same person again: 'already redeemed', no second slot", async () => {
  who.userId = "user_friend";
  await applyOnPricingField(REAL);
  const again = await applyOnPricingField(REAL);
  assert.deepEqual(again.kind === "redeemed" && again.result, { kind: "error", message: "You have already redeemed this coupon" });
  assert.equal(coupon(REAL).usedCount, 1);
});

test("A4 · a Stripe discount code still previews and is NOT redeemed", async () => {
  who.userId = "user_friend";
  const out = await applyOnPricingField(STRIPE_CODE);
  assert.equal(out.kind, "stripePreview");
  assert.equal(calls.couponLookups, 0);
});

test("A5 · a renewing Plus subscriber is told so, and no slot is burned", async () => {
  who.userId = "user_plus";
  const out = await applyOnPricingField(REAL);
  assert.deepEqual(out.kind === "redeemed" && out.result, { kind: "error", message: "You already have Plus — no code needed." });
  assert.equal(coupon(REAL).usedCount, 0);
});

test("A6 · a used-up code reads as invalid", async () => {
  who.userId = "user_friend";
  const out = await applyOnPricingField(FULL_CODE);
  assert.deepEqual(out.kind === "redeemed" && out.result, { kind: "invalid" });
  assert.equal(coupon(FULL_CODE).usedCount, 1);
});

test("A7 · the 21st redeemer of a 20-use code is refused; the count stops at 20", async () => {
  coupon(REAL).usedCount = 19;
  who.userId = "user_new";
  const last = await applyOnPricingField(REAL);
  who.userId = "user_new2";
  const over = await applyOnPricingField(REAL);
  assert.equal(last.kind === "redeemed" && last.result.kind, "activated");
  assert.deepEqual(over.kind === "redeemed" && over.result, { kind: "invalid" });
  assert.equal(coupon(REAL).usedCount, 20);
  assert.equal(grant("acc-new2"), undefined);
});

// ── B. signed-out code carried through sign-up ──────────────────────────────
test("B1 · signed out, Apply parks the code and goes to sign-up — without looking it up", async () => {
  who.userId = null;
  const out = await applyOnPricingField(REAL.toLowerCase());
  assert.equal(out.kind, "toSignUp");
  if (out.kind !== "toSignUp") return;
  assert.equal(out.park.headers.get("location"), "http://localhost/register");
  assert.equal(parkedCookie(out.park.headers.get("set-cookie") ?? ""), REAL);
  assert.match(out.park.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(out.park.headers.get("set-cookie") ?? "", /Max-Age=3600/);
  assert.equal(calls.couponLookups, 0, "parking must not be an enumeration oracle");
});

test("B2 · after sign-up, /r/claim redeems it and onboarding is told 'until Nov 30'", async () => {
  who.userId = null;
  const out = await applyOnPricingField(REAL);
  const cookie = out.kind === "toSignUp" ? parkedCookie(out.park.headers.get("set-cookie") ?? "") : null;
  assert.ok(cookie);
  who.userId = "user_new"; // the account Clerk just created
  const c = await claim({ wondish_coupon: cookie! });
  assert.equal(c.location, "http://localhost/profile?onboarding=true&coupon=activated:2026-11-30");
  assert.match(c.setCookie, /wondish_coupon=;/, "the parked code is cleared");
  assert.equal(coupon(REAL).usedCount, 1);
  assert.equal(grant("acc-new")?.stripeCurrentPeriodEnd?.toISOString(), NOV_30.toISOString());
});

test("B3 · the onboarding banner reads the outcome back", async () => {
  const { parseClaimNotice } = (await routes()).pending;
  assert.deepEqual(parseClaimNotice("activated:2026-11-30"), { kind: "activated", until: "2026-11-30" });
});

test("B4 · a sign-up with nothing parked goes straight to onboarding, no lookup", async () => {
  who.userId = "user_new";
  const c = await claim({});
  assert.equal(c.location, "http://localhost/profile?onboarding=true");
  assert.equal(calls.couponLookups, 0);
});

test("B5 · an ADMIN code is never redeemed from a cookie", async () => {
  who.userId = "user_new";
  const c = await claim({ wondish_coupon: ADMIN_CODE });
  assert.equal(c.location, "http://localhost/profile?onboarding=true&coupon=invalid");
  assert.equal(coupon(ADMIN_CODE).usedCount, 0);
  assert.equal(db.roles.length, 0);
  assert.ok(calls.couponLookups > 0, "it was actually looked up, then refused");
});

test("B6 · a Stripe code carried through sign-up says 'use it at checkout'", async () => {
  who.userId = "user_new";
  const c = await claim({ wondish_coupon: STRIPE_CODE });
  assert.equal(c.location, "http://localhost/profile?onboarding=true&coupon=stripe");
});

test("B7 · a junk cookie is refused before any lookup", async () => {
  who.userId = "user_new";
  const c = await claim({ wondish_coupon: "%3Cscript%3E" });
  assert.equal(c.location, "http://localhost/profile?onboarding=true&coupon=invalid");
  assert.equal(calls.couponLookups, 0);
});

test("B8 · a database failure never costs the sign-up", async () => {
  who.userId = "user_new";
  failNextCouponLookup = true;
  const c = await claim({ wondish_coupon: REAL });
  assert.equal(c.location, "http://localhost/profile?onboarding=true&coupon=error");
  assert.match(c.setCookie, /wondish_coupon=;/);
  assert.equal(coupon(REAL).usedCount, 0);
});

test("B9 · a returning user (Google sign-up on an existing account) who already redeemed: 'already'", async () => {
  who.userId = "user_friend";
  await applyOnPricingField(REAL);
  const c = await claim({ wondish_coupon: REAL });
  assert.equal(c.location, "http://localhost/profile?onboarding=true&coupon=already");
  assert.equal(coupon(REAL).usedCount, 1);
});

test("B10 · a signed-in visitor hitting /r/code is sent to pricing, nothing parked", async () => {
  who.userId = "user_friend";
  const res = await (await routes()).park.GET(new Request(`http://localhost/r/code/${REAL}`) as any, { params: { code: REAL } });
  assert.equal(res.headers.get("location"), "http://localhost/pricing");
  assert.equal(res.headers.get("set-cookie"), null);
});
