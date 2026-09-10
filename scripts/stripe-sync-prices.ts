// Creates (once) the Wondish Premium product and the two catalog prices by
// lookup_key, then verifies every price matches lib/billing/plans.ts. Safe to
// rerun: existing prices are reused, mismatches are reported, nothing is
// deleted. Run per environment (test key locally, live key for production):
//   set -a; source .env.local; set +a; npx tsx scripts/stripe-sync-prices.ts
import Stripe from "stripe";
import { PLANS } from "../lib/billing/plans";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not loaded");
  const stripe = new Stripe(key, { apiVersion: "2024-04-10" });
  const mode = key.startsWith("sk_live") ? "LIVE" : "test";
  console.log(`Stripe ${mode} mode`);

  // products.list, not products.search: the search index is eventually
  // consistent, so a rerun seconds after creation would create a duplicate.
  const products = await stripe.products.list({ active: true, limit: 100 });
  const product =
    products.data.find((p) => p.name === "Wondish Premium") ??
    (await stripe.products.create({
      name: "Wondish Premium",
      description: "Full meal planner, weekly generation, and Clara without limits.",
    }));
  console.log(`product ${product.id}`);

  let mismatches = 0;
  for (const plan of PLANS) {
    const found = (await stripe.prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 })).data[0];
    if (found) {
      const ok =
        found.unit_amount === plan.amountCents &&
        found.currency === plan.currency &&
        found.recurring?.interval === plan.interval &&
        found.recurring?.interval_count === plan.intervalCount;
      if (!ok) mismatches++;
      console.log(
        `${ok ? "OK      " : "MISMATCH"} ${plan.lookupKey} → ${found.id} (${found.unit_amount} ${found.currency} / ${found.recurring?.interval_count} ${found.recurring?.interval})`
      );
      continue;
    }
    const created = await stripe.prices.create({
      product: product.id,
      lookup_key: plan.lookupKey,
      unit_amount: plan.amountCents,
      currency: plan.currency,
      recurring: { interval: plan.interval, interval_count: plan.intervalCount },
      nickname: plan.key === "monthly" ? "Premium monthly" : "Premium 6 months",
    });
    console.log(`CREATED  ${plan.lookupKey} → ${created.id}`);
  }
  if (mismatches > 0) {
    console.error(`${mismatches} price(s) differ from the catalog — checkout will refuse them (PriceDriftError). Fix in the Stripe dashboard or update lib/billing/plans.ts.`);
    process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
