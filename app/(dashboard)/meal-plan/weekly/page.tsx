import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { startOfWeek, addDays, format } from "date-fns";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import WeeklyMealPlanGrid from "@/components/meal-plan/WeeklyMealPlanGrid";

export const metadata = { title: "Weekly Plan" };

export default async function WeeklyPlanPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!session.user.onboardingComplete) redirect("/profile?onboarding=true");

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  weekEnd.setHours(23, 59, 59, 999);

  const patient = await prisma.patient.findUnique({
    where: { accountId: session.user.id },
  });

  const menus = patient
    ? await prisma.menu.findMany({
        where: {
          patientId: patient.id,
          date: { gte: weekStart, lte: weekEnd },
        },
        include: {
          recipe: {
            include: {
              mealType: true,
              ingredients: { include: { ingredient: true } },
            },
          },
          mealType: true,
        },
        orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
      })
    : [];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Weekly Plan</h1>
        <p className="text-[#8A8D93] text-sm mt-1">All meals for this week at a glance</p>
      </div>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6">
        <WeeklyMealPlanGrid
          initialMenus={menus as never}
          initialWeekStart={weekStart}
        />
      </div>
    </div>
  );
}
