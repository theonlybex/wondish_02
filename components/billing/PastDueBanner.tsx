import Link from "next/link";

// Dashboard-wide notice when the Stripe subscription is PAST_DUE. Stripe's
// Smart Retries keep trying; this gives the user the one action that fixes it.
export default function PastDueBanner() {
  return (
    <div role="alert" className="px-5 py-2.5 text-sm text-center" style={{ background: "#FFF3E0", color: "#b45309" }}>
      Your last payment failed —{" "}
      <Link href="/membership" className="underline font-semibold">update your payment method</Link> to keep Premium.
    </div>
  );
}
