import Link from "next/link";

// Dashboard-wide notice when the Stripe subscription is PAST_DUE. The member
// is already on the free allowance (hasActivePremium excludes PAST_DUE);
// what they have stays, and Stripe's Smart Retries keep trying. This gives
// them the one action that brings Plus back.
export default function PastDueBanner() {
  return (
    <div role="alert" className="px-5 py-2.5 text-sm text-center" style={{ background: "#FFF3E0", color: "#b45309" }}>
      Your last payment didn&apos;t go through, so you&apos;re on the free allowance for now —{" "}
      <Link href="/membership" className="underline font-semibold">update your card</Link> to get Plus back.
    </div>
  );
}
