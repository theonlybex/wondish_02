// Admin promo code → Stripe Checkout, against the REAL Stripe sandbox
// (STRIPE_SECRET_KEY must be sk_test_; the script refuses anything else).
// Runs the real Wondish route handlers — admin "Promo codes" create/list,
// the pricing-field preview, and Continue-to-payment checkout — with a fake
// in-memory database standing in for the shared prod DB (nothing is written
// there) and a fake signed-in SUPER admin.
//
//   npm run sim:stripe-promo            create a QASIM code, check everything,
//                                       print a Checkout URL to type it into
//   npm run sim:stripe-promo -- cleanup deactivate every QASIM code, delete
//                                       its Stripe coupon, expire the sessions,
//                                       delete the sim customer
import { mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const req = createRequire(__filename);
const STATE_FILE = join(__dirname, ".stripe-promo-sim.json");

// ── env + mocks before any service module loads ─────────────────────────────
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*(STRIPE_SECRET_KEY)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("refusing: STRIPE_SECRET_KEY is not a test key");
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RATE_LIMIT_ENFORCE_BACKEND;

const ADMIN = { id: "acc-sim-admin", clerkId: "user_sim_admin", email: "qa.sim.admin@wondish.io", firstName: "QA", lastName: "Sim" };
let customerId: string | null = null;
mock.module(pathToFileURL(req.resolve("server-only")).href, { namedExports: {} });
mock.module(pathToFileURL(req.resolve("@clerk/nextjs/server")).href, {
  namedExports: {
    auth: async () => ({ userId: ADMIN.clerkId }),
    clerkClient: async () => {
      throw new Error("sim: account is pre-seeded");
    },
    currentUser: async () => null,
  },
});
// Just enough Prisma for: the SUPER check, getOrCreateAccount, and the
// checkout route's STRIPE-row upsert.
(globalThis as any).prisma = {
  account: {
    findUnique: async ({ where, include }: any) => {
      if (where.clerkId !== ADMIN.clerkId) return null;
      return {
        ...ADMIN,
        ...(include?.roles ? { roles: [{ role: { name: "SUPER" } }] } : {}),
        ...(include?.subscriptions
          ? { subscriptions: customerId ? [{ source: "STRIPE", plan: "FREE", status: "CANCELED", stripeCustomerId: customerId, stripeSubscriptionId: null, stripeCurrentPeriodEnd: null }] : [] }
          : {}),
      };
    },
  },
  subscription: { upsert: async ({ create }: any) => create },
};

const json = (url: string, body: unknown, method = "POST") =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as any;
const step = (n: string, ok: string) => console.log(`✔ ${n} — ${ok}`);

async function main() {
  const { stripe } = await import("@/lib/stripe");
  const s = stripe();

  if (process.argv.includes("cleanup")) {
    const st = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
    const promos = await s.promotionCodes.list({ limit: 100 });
    for (const pc of promos.data.filter((p) => p.code.startsWith("QASIM"))) {
      if (pc.active) await s.promotionCodes.update(pc.id, { active: false });
      await s.coupons.del(pc.coupon.id).catch(() => {});
      console.log(`cleaned ${pc.code} (${pc.id})`);
    }
    for (const id of st.sessions ?? []) await s.checkout.sessions.expire(id).catch(() => {});
    if (st.customerId) await s.customers.del(st.customerId).catch(() => {});
    console.log("cleanup done");
    return;
  }

  const code = `QASIM${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const admin = await import("@/app/api/admin/promo-codes/route");
  const preview = await import("@/app/api/billing/promo/route");
  const checkout = await import("@/app/api/billing/checkout/route");

  // 1. Admin creates the code in the Wondish dashboard (Admin → Coupons → Promo codes).
  const created = await admin.POST(
    json("http://localhost/api/admin/promo-codes", { code, percentOff: 25, duration: "once", maxRedemptions: 5, firstTimeOnly: false })
  );
  const createdBody = await created.json();
  assert.equal(created.status, 201, JSON.stringify(createdBody));
  step("1 admin create", `${code} → Stripe promotion code ${createdBody.id}`);

  // 2. It is really in Stripe, active, 25% off once.
  const pc = await s.promotionCodes.retrieve(createdBody.id);
  assert.equal(pc.code, code);
  assert.equal(pc.active, true);
  assert.equal(pc.coupon.percent_off, 25);
  assert.equal(pc.coupon.duration, "once");
  assert.equal(pc.max_redemptions, 5);
  step("2 in Stripe", `active, ${pc.coupon.percent_off}% off ${pc.coupon.duration}, max ${pc.max_redemptions}`);

  // 3. The admin list shows it.
  const list = await (await admin.GET()).json();
  assert.ok(list.codes.some((c: { code: string }) => c.code === code));
  step("3 admin list", "shows the new code");

  // 4. The /pricing field previews the discount.
  const pv = await (await preview.POST(json("http://localhost/api/billing/promo", { code: code.toLowerCase(), plan: "monthly" }))).json();
  assert.equal(pv.valid, true, JSON.stringify(pv));
  step("4 pricing field", `${pv.label} — ${pv.firstCharge} today, then ${pv.recurring}`);

  // A sandbox customer for the sim account (deleted on cleanup).
  customerId = (await s.customers.create({ email: ADMIN.email, name: "QA Sim (delete me)", metadata: { sim: "stripe-promo" } })).id;

  // 5. Code applied in the pricing field → Checkout opens with it applied.
  const withCode = await (await checkout.POST(json("http://localhost/api/billing/checkout", { plan: "monthly", promoCode: code }))).json();
  assert.ok(withCode.url, JSON.stringify(withCode));
  const sid1 = new URL(withCode.url).pathname.split("/").pop()!.split("#")[0];
  const sess1 = await s.checkout.sessions.retrieve(sid1, { expand: ["discounts.promotion_code"] });
  assert.equal(sess1.amount_subtotal, 2000);
  assert.equal(sess1.amount_total, 1500);
  step("5 checkout with in-app code", `$${sess1.amount_subtotal! / 100} → $${sess1.amount_total! / 100} (discount pre-applied)`);

  // 6. No code in-app → Checkout's own "Add promotion code" box is on.
  const plain = await (await checkout.POST(json("http://localhost/api/billing/checkout", { plan: "monthly" }))).json();
  const sid2 = new URL(plain.url).pathname.split("/").pop()!.split("#")[0];
  const sess2 = await s.checkout.sessions.retrieve(sid2);
  assert.equal(sess2.allow_promotion_codes, true);
  assert.equal(sess2.amount_total, 2000);
  step("6 checkout without code", "Stripe's promotion-code box is enabled, $20 before a code");

  writeFileSync(STATE_FILE, JSON.stringify({ code, promoId: createdBody.id, customerId, sessions: [sid1, sid2] }, null, 2));
  console.log(`\nCODE=${code}\nCHECKOUT_URL=${plain.url}`);
}

main().catch((err) => {
  console.error("✖", err?.message ?? err);
  process.exit(1);
});
