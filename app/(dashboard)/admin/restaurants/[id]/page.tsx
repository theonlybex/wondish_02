import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import RestaurantDishManager, { DishRow } from "@/components/admin/RestaurantDishManager";
import RestaurantStaffPanel from "@/components/admin/RestaurantStaffPanel";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: params.id } });
  return { title: restaurant ? `${restaurant.name} · Dishes` : "Restaurant" };
}

export default async function AdminRestaurantDishesPage({ params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account?.roles.some((r) => r.role.name === "SUPER")) redirect("/overview");

  const [restaurant, dishes, dishTypes, mealTypes] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: params.id }, include: { ethnic: true } }),
    prisma.restaurantDish.findMany({
      where: { restaurantId: params.id },
      orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
      include: { ingredients: true },
    }),
    prisma.dishType.findMany({ orderBy: { name: "asc" } }),
    prisma.mealType.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!restaurant) notFound();

  // Plain-object mapping (price Decimal -> string) so props crossing the
  // server/client boundary are guaranteed JSON-serializable.
  const dishRows: DishRow[] = dishes.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    price: d.price ? d.price.toFixed(2) : null,
    currency: d.currency,
    section: d.section,
    sortOrder: d.sortOrder,
    dishTypeId: d.dishTypeId,
    mealTypeId: d.mealTypeId,
    calories: d.calories,
    protein: d.protein,
    carbs: d.carbs,
    fat: d.fat,
    fiber: d.fiber,
    isRecommended: d.isRecommended,
    available: d.available,
    status: d.status,
    ingredients: d.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
  }));

  return (
    <div className="max-w-5xl mx-auto">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
        <Link href="/admin/restaurants" className="text-xs font-semibold text-primary hover:underline">
          ← All Restaurants
        </Link>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3 mt-3" style={{ color: "#B75E78" }}>
          Admin · {restaurant.neighborhood}
        </p>
        <h1 className="text-3xl font-bold text-[#1E1A1A]">{restaurant.name}</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#848181" }}>
            {dishRows.length} {dishRows.length === 1 ? "dish" : "dishes"} · {restaurant.ethnic?.name ?? "No cuisine set"}
          </p>
        </div>
      </div>

      <div className="ov" style={{ animationDelay: "80ms" }}>
        <RestaurantDishManager
          restaurantId={restaurant.id}
          dishes={dishRows}
          dishTypes={dishTypes}
          mealTypes={mealTypes}
        />
      </div>

      <div className="ov mt-8" style={{ animationDelay: "160ms" }}>
        <RestaurantStaffPanel restaurantId={restaurant.id} />
      </div>
    </div>
  );
}
