import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
import { portalBackLink } from "@/lib/restaurant-portal-nav";
import PortalNav from "@/components/restaurant/PortalNav";

// Phase 6a M4 — per-restaurant chrome (design §5): back to the switcher +
// section nav. Membership is gated here once; pages and APIs keep their own
// guards for defense in depth.
export default async function RestaurantScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const gate = await getPortalPageContext(params.id);
  if (!gate.allowed) redirect(gate.redirectTo);

  const showStaff = gate.ctx.isSuper || gate.ctx.membership?.role === "OWNER";

  // Never a bare link to /restaurant: it redirects single-membership staff
  // right back here, which reads as a broken control and stacks up history
  // entries the user then has to unwind with repeated Back presses.
  const back = portalBackLink({
    membershipCount: gate.ctx.membershipCount,
    isSuper: gate.ctx.isSuper,
    onboardedPatient: gate.ctx.onboardedPatient,
  });

  return (
    <div>
      {back && (
        // Negative margin keeps the padded hit area (>=44px tall) from
        // shifting the text off the layout's left edge.
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 -ml-2 px-2 py-2.5 rounded-lg text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span aria-hidden="true">←</span>
          {back.label}
        </Link>
      )}
      <div className={back ? "mt-4" : ""}>
        <PortalNav restaurantId={params.id} showStaff={showStaff} />
      </div>
      {children}
    </div>
  );
}
