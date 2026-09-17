import Link from "next/link";

// Dashboard-wide notice in the last days of a coupon grant. A coupon grants
// beta access (half of Plus's allowances), so losing it drops the tester to
// free limits — the banner shows whenever the grant is ending.
export default function CouponEndingBanner({ endsAt }: { endsAt: Date }) {
  const date = endsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div role="status" className="px-5 py-2.5 text-sm text-center" style={{ background: "#F5F1DD", color: "#5F1C35" }}>
      Your beta access ends on {date} —{" "}
      <Link href="/pricing" className="underline font-semibold">get Plus to keep going</Link>.
    </div>
  );
}
