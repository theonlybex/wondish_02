import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import DailyMealPlanView from "@/components/meal-plan/DailyMealPlanView";

export const metadata = { title: "Meal Plan" };

export default async function MealPlanPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const menus = patient
    ? await prisma.menu.findMany({
        where: {
          patientId: patient.id,
          date: { gte: today, lte: todayEnd },
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
        orderBy: { mealType: { name: "asc" } },
      })
    : [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy">Meal Plan</h1>
          <p className="text-[#8A8D93] text-sm mt-1">Your personalized daily meal plan</p>
        </div>
        <a
          href="/meal-plan/weekly"
          className="text-primary text-sm font-medium hover:underline"
        >
          Weekly view →
        </a>
      </div>

      <DailyMealPlanView
        initialMenus={menus as never}
        initialDate={today}
        mealPlanStartDate={patient?.mealPlanStartDate?.toISOString() ?? null}
      />
    </div>
  );
}
