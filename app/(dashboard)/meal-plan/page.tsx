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

  const [menus, todayJournal] = patient
    ? await Promise.all([
        prisma.menu.findMany({
          where: { patientId: patient.id, date: { gte: today, lte: todayEnd } },
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
        }),
        prisma.journalEntry.findFirst({
          where: { patientId: patient.id, date: { gte: today, lte: todayEnd } },
          include: { meals: { select: { recipeId: true, skipped: true, rating: true } } },
        }),
      ])
    : [[], null];

  const activeMeals = (todayJournal?.meals ?? []).filter((m) => !m.skipped && m.recipeId);
  const loggedRecipeIds = activeMeals.map((m) => m.recipeId as string);
  const initialMealRatings: Record<string, number> = {};
  for (const m of activeMeals) {
    if (m.recipeId && m.rating != null) initialMealRatings[m.recipeId] = m.rating;
  }

  const totalCalories = menus.reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);
  const totalProtein = menus.reduce((sum, m) => sum + (m.recipe.protein ?? 0), 0);
  const totalCarbs = menus.reduce((sum, m) => sum + (m.recipe.carbs ?? 0), 0);
  const totalFat = menus.reduce((sum, m) => sum + (m.recipe.fat ?? 0), 0);

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

      {menus.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-[#E8E7EA] rounded-2xl p-4 text-center">
            <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-1">Calories</p>
            <p className="text-xl font-bold text-navy">{Math.round(totalCalories)}</p>
          </div>
          <div className="bg-white border border-[#E8E7EA] rounded-2xl p-4 text-center">
            <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-1">Protein</p>
            <p className="text-xl font-bold text-navy">{Math.round(totalProtein)}g</p>
          </div>
          <div className="bg-white border border-[#E8E7EA] rounded-2xl p-4 text-center">
            <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-1">Carbs</p>
            <p className="text-xl font-bold text-navy">{Math.round(totalCarbs)}g</p>
          </div>
          <div className="bg-white border border-[#E8E7EA] rounded-2xl p-4 text-center">
            <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-1">Fat</p>
            <p className="text-xl font-bold text-navy">{Math.round(totalFat)}g</p>
          </div>
        </div>
      )}

      <DailyMealPlanView
        initialMenus={menus as never}
        initialDate={format(today, "yyyy-MM-dd")}
        mealPlanStartDate={patient?.mealPlanStartDate?.toISOString() ?? null}
        initialLoggedRecipeIds={loggedRecipeIds}
        initialMealRatings={initialMealRatings}
      />
    </div>
  );
}
