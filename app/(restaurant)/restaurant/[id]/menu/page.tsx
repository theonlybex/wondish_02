import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import PortalMenuManager from "@/components/restaurant/PortalMenuManager";
import { serializePortalDish, serializeDishRevision } from "@/lib/restaurant-portal-server";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Menu` : "Menu" };
}

// Phase 6a M2 — the menu manager screen (design §5.2). Server-gated by
// staff membership; dish data is server-rendered, mutations go through the
// portal API.
export default async function RestaurantMenuPage({ params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: {
      roles: { include: { role: true } },
      restaurantStaff: { where: { restaurantId: params.id } },
    },
  });
  const isSuper = account?.roles.some((r) => r.role.name === "SUPER") ?? false;
  if (!account || (account.restaurantStaff.length === 0 && !isSuper)) redirect("/restaurant");

  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  if (!restaurant) notFound();

  const dishes = await prisma.restaurantDish.findMany({
    where: { restaurantId: params.id, deletedAt: null },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: {
      ingredients: { select: { name: true, quantity: true, unit: true, ingredientId: true } },
      revisions: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <div>
      <div className="mb-8">
        <Link href={`/restaurant/${restaurant.id}`} className="text-xs font-semibold text-primary hover:underline">
          ← {restaurant.name}
        </Link>
        <h1 className="text-3xl font-bold text-[#1E1A1A] mt-3">Menu</h1>
        <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
          List what&apos;s in each dish — you never share how it&apos;s made. Ingredients power
          allergy safety for diners; nutrition helps them fit your dishes into their day.
        </p>
      </div>

      <PortalMenuManager
        restaurantId={restaurant.id}
        initialDishes={dishes.map((d) => ({
          ...serializePortalDish(d),
          pendingRevision: d.revisions[0] ? serializeDishRevision(d.revisions[0]) : null,
        }))}
      />
    </div>
  );
}
