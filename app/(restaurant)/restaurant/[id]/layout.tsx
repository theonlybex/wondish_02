import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
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

  return (
    <div>
      <Link href="/restaurant" className="text-xs font-semibold text-primary hover:underline">
        ← Your restaurants
      </Link>
      <div className="mt-4">
        <PortalNav restaurantId={params.id} showStaff={showStaff} />
      </div>
      {children}
    </div>
  );
}
