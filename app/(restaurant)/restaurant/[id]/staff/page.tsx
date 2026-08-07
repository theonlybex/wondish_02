import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
import PortalStaffPanel from "@/components/restaurant/PortalStaffPanel";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Staff` : "Staff" };
}

// Phase 6a M4 — staff management screen (design §5.7). OWNER only —
// managers land back on the dashboard.
export default async function RestaurantStaffPage({ params }: { params: { id: string } }) {
  const gate = await getPortalPageContext(params.id);
  if (!gate.allowed) redirect(gate.redirectTo);
  if (!gate.ctx.isSuper && gate.ctx.membership && gate.ctx.membership.role !== "OWNER") {
    redirect(`/restaurant/${params.id}`);
  }

  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  if (!restaurant) notFound();

  const [staff, invites] = await Promise.all([
    prisma.restaurantStaff.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "asc" },
      include: { account: { select: { email: true, firstName: true, lastName: true } } },
    }),
    prisma.restaurantInvite.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Staff</h1>
        <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
          Who can manage {restaurant.name} on Wondish.
        </p>
      </div>

      <div className="max-w-2xl">
        <PortalStaffPanel
          restaurantId={restaurant.id}
          initialStaff={staff.map((s) => ({
            id: s.id,
            role: s.role,
            email: s.account.email,
            name: `${s.account.firstName} ${s.account.lastName}`.trim(),
            createdAt: s.createdAt.toISOString(),
            isSelf: gate.ctx.membership?.id === s.id,
          }))}
          initialInvites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            status: i.status,
            createdAt: i.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
