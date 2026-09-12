import Link from "next/link";

// Dashboard-wide notice in the last days of a coupon grant. Only rendered
// when premium gates are on (in free mode losing the grant changes nothing).
export default function CouponEndingBanner({ endsAt }: { endsAt: Date }) {
  const date = endsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div role="status" className="px-5 py-2.5 text-sm text-center" style={{ background: "#F5F1DD", color: "#5F1C35" }}>
      Your Premium access ends on {date} —{" "}
      <Link href="/pricing" className="underline font-semibold">subscribe to keep it</Link>.
    </div>
  );
}
