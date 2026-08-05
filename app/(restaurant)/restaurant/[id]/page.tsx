import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import Badge from "@/components/ui/Badge";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Portal` : "Restaurant" };
}

// Phase 6a M2 — restaurant dashboard (design §5.1): publish state, nutrition
// coverage, review status, and the door into the menu manager. Server-gated
// by staff membership (SUPER bypasses).
export default async function RestaurantDashboardPage({ params }: { params: { id: string } }) {
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
  const membership = account?.restaurantStaff[0] ?? null;
  if (!account || (!membership && !isSuper)) redirect("/restaurant");

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id },
    include: { ethnic: { select: { name: true } } },
  });
  if (!restaurant) notFound();

  const dishes = await prisma.restaurantDish.findMany({
    where: { restaurantId: params.id, deletedAt: null },
    select: { status: true, available: true, calories: true },
  });
  const published = dishes.filter((d) => d.status === "PUBLISHED").length;
  const inReview = dishes.filter((d) => d.status === "PENDING_REVIEW").length;
  const missingNutrition = dishes.filter((d) => d.calories == null).length;
  const unavailable = dishes.filter((d) => !d.available).length;

  const cards = [
    { label: "Dishes live", value: `${published} / ${dishes.length}` },
    { label: "Awaiting review", value: String(inReview) },
    { label: "Missing nutrition", value: String(missingNutrition) },
    { label: "Marked unavailable", value: String(unavailable) },
  ];

  return (
    <div>
      <div className="mb-8">
        <Link href="/restaurant" className="text-xs font-semibold text-primary hover:underline">
          ← Your restaurants
        </Link>
        <div className="flex items-start justify-between mt-3">
          <div>
            <h1 className="text-3xl font-bold text-[#1E1A1A]">{restaurant.name}</h1>
            <p className="text-xs mt-1.5" style={{ color: "#848181" }}>
              {restaurant.neighborhood}
              {restaurant.ethnic?.name ? ` · ${restaurant.ethnic.name}` : ""}
              {membership ? ` · you are ${membership.role === "OWNER" ? "an owner" : "a manager"}` : " · Wondish ops"}
            </p>
          </div>
          <Badge variant={restaurant.status === "PUBLISHED" ? "success" : "neutral"}>
            {restaurant.status === "PUBLISHED" ? "Listed on Wondish" : restaurant.status}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-[#EAE4CA] rounded-2xl p-4">
            <p className="text-2xl font-bold text-[#1E1A1A] tabular-nums">{c.value}</p>
            <p className="text-xs mt-1" style={{ color: "#848181" }}>{c.label}</p>
          </div>
        ))}
      </div>

      {missingNutrition > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6 text-sm text-amber-800">
          {missingNutrition} {missingNutrition === 1 ? "dish is" : "dishes are"} missing calories —
          diners use them to fit your dishes into their day, so filling them in makes your menu
          easier to choose.
        </div>
      )}

      <Link
        href={`/restaurant/${restaurant.id}/menu`}
        className="inline-flex items-center gap-2 bg-primary text-white text-sm font-semibold px-5 py-3 rounded-xl hover:bg-primary-dark transition-colors"
      >
        Manage menu →
      </Link>
    </div>
  );
}
