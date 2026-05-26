import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { format, addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import { generateMealPlan } from "@/lib/meal-plan";
import DailyMealPlanView from "@/components/meal-plan/DailyMealPlanView";
import Link from "next/link";

export const metadata = { title: "Meal Plan" };

export default async function MealPlanPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const [menus, todayJournal, patient] = await Promise.all([
    prisma.menu.findMany({
      where: { patient: { account: { clerkId: userId } }, date: { gte: today, lte: todayEnd } },
      include: {
        recipe: {
          include: {
            mealType: true,
            dishType: true,
            ingredients: { include: { ingredient: true } },
          },
        },
        mealType: true,
      },
      orderBy: { mealType: { name: "asc" } },
    }),
    prisma.journalEntry.findFirst({
      where: { patient: { account: { clerkId: userId } }, date: { gte: today, lte: todayEnd } },
      include: { meals: { select: { recipeId: true, skipped: true, rating: true } } },
    }),
    prisma.patient.findFirst({
      where: { account: { clerkId: userId } },
      select: { id: true, mealPlanStartDate: true, profileCompleted: true },
    }),
  ]);

  // Auto-generate a fresh 7-day plan when no meals exist for today
  let finalMenus = menus;
  if (menus.length === 0 && patient?.id && patient.profileCompleted) {
    try {
      if (!patient.mealPlanStartDate) {
        await prisma.patient.update({ where: { id: patient.id }, data: { mealPlanStartDate: today } });
      }
      await generateMealPlan(patient.id, today, addDays(today, 6));
      finalMenus = await prisma.menu.findMany({
        where: { patient: { account: { clerkId: userId } }, date: { gte: today, lte: todayEnd } },
        include: {
          recipe: {
            include: {
              mealType: true,
              dishType: true,
              ingredients: { include: { ingredient: true } },
            },
          },
          mealType: true,
        },
        orderBy: { mealType: { name: "asc" } },
      });
    } catch {
      // Profile incomplete or generation error — show empty state
    }
  }

  const activeMeals = (todayJournal?.meals ?? []).filter((m) => !m.skipped && m.recipeId);
  const loggedRecipeIds = activeMeals.map((m) => m.recipeId as string);
  const initialMealRatings: Record<string, number> = {};
  for (const m of activeMeals) {
    if (m.recipeId && m.rating != null) initialMealRatings[m.recipeId] = m.rating;
  }

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <style>{`
        @keyframes mp-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .mp { animation: mp-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mp flex items-start justify-between mb-8" style={{ animationDelay: "0ms" }}>
        <div>
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#7DB87D" }}>
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-3xl font-bold text-[#0d1f10]">Meal Plan</h1>
          <p className="text-xs mt-1.5" style={{ color: "#9EA8A0" }}>Your personalised daily menu</p>
        </div>
        <Link
          href="/meal-plan/weekly"
          className="mp text-xs font-semibold px-4 py-2 rounded-xl border transition-colors mt-1"
          style={{
            animationDelay: "80ms",
            color: "#4ade80",
            borderColor: "rgba(74,222,128,0.25)",
            background: "rgba(74,222,128,0.06)",
          }}
        >
          Weekly view →
        </Link>
      </div>

      <div className="mp" style={{ animationDelay: "160ms" }}>
        <DailyMealPlanView
          initialMenus={finalMenus as never}
          initialDate={format(today, "yyyy-MM-dd")}
          mealPlanStartDate={patient?.mealPlanStartDate?.toISOString() ?? null}
          initialLoggedRecipeIds={loggedRecipeIds}
          initialMealRatings={initialMealRatings}
        />
      </div>
    </div>
  );
}
