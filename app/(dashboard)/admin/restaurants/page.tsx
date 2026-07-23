import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import RestaurantListTable from "@/components/admin/RestaurantListTable";

export const metadata = { title: "Manage Restaurants" };

export default async function AdminRestaurantsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!account?.roles.some((r) => r.role.name === "SUPER")) redirect("/overview");

  const [restaurants, ethnics] = await Promise.all([
    prisma.restaurant.findMany({
      orderBy: { createdAt: "desc" },
      include: { ethnic: true, _count: { select: { dishes: true } } },
    }),
    prisma.ethnic.findMany({ orderBy: { name: "asc" } }),
  ]);

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
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
          Admin
        </p>
        <h1 className="text-3xl font-bold text-[#1E1A1A]">Restaurants</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#848181" }}>
            {restaurants.length} {restaurants.length === 1 ? "restaurant" : "restaurants"} onboarded
          </p>
        </div>
      </div>

      <div className="ov" style={{ animationDelay: "80ms" }}>
        <RestaurantListTable restaurants={restaurants as never} ethnics={ethnics} />
      </div>
    </div>
  );
}
