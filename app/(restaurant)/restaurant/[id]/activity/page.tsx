import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getPortalPageContext } from "@/lib/restaurant-portal-page";
import { getActivityPage } from "@/lib/restaurant-portal-server";
import PortalActivityFeed from "@/components/restaurant/PortalActivityFeed";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Activity` : "Activity" };
}

// Phase 6a M4 — activity screen (design §5.7).
export default async function RestaurantActivityPage({ params }: { params: { id: string } }) {
  const gate = await getPortalPageContext(params.id);
  if (!gate.allowed) redirect(gate.redirectTo);

  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  if (!restaurant) notFound();

  const { entries, nextCursor } = await getActivityPage(restaurant.id, null);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Activity</h1>
        <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
          Every change to {restaurant.name}&rsquo;s menu, profile, and team — newest first.
        </p>
      </div>

      <div className="max-w-2xl">
        <PortalActivityFeed
          restaurantId={restaurant.id}
          initialEntries={entries}
          initialCursor={nextCursor}
        />
      </div>
    </div>
  );
}
