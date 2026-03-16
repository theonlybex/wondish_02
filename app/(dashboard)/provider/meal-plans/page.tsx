import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/db";

export const metadata = { title: "User Meal Plans" };

export default async function ProviderMealPlansPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: { date: { gte: today, lte: todayEnd } },
    include: {
      recipe: true,
      mealType: true,
      patient: {
        include: {
          account: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
    orderBy: [{ mealType: { name: "asc" } }],
  });

  // Group by patient
  const byPatient: Record<string, { name: string; email: string; menus: typeof menus }> = {};
  for (const menu of menus) {
    const key = menu.patientId;
    if (!byPatient[key]) {
      byPatient[key] = {
        name: `${menu.patient.account.firstName} ${menu.patient.account.lastName}`,
        email: menu.patient.account.email,
        menus: [],
      };
    }
    byPatient[key].menus.push(menu);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">User Meal Plans</h1>
        <p className="text-[#8A8D93] text-sm mt-1">
          {format(today, "EEEE, MMMM d")} — all users
        </p>
      </div>

      {Object.entries(byPatient).length === 0 ? (
        <div className="text-center py-12 text-[#8A8D93]">
          No meal plans generated for today.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byPatient).map(([id, data]) => (
            <div key={id} className="bg-white border border-[#E8E7EA] rounded-2xl p-6">
              <p className="font-semibold text-navy mb-1">{data.name}</p>
              <p className="text-[#8A8D93] text-xs mb-4">{data.email}</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.menus.map((menu) => (
                  <div key={menu.id} className="flex items-center gap-2 p-3 bg-surface rounded-xl">
                    <span className="text-xl">{menu.recipe.emoji ?? "🍽"}</span>
                    <div>
                      <p className="text-navy text-xs font-medium">{menu.recipe.name}</p>
                      <p className="text-[#8A8D93] text-xs">{menu.mealType?.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
