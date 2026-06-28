import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import { computeAllMetrics, gradualDailyCals, type CaloricProfileInput } from "@/lib/caloric-engine";
import DailyMealPlanView from "@/components/meal-plan/DailyMealPlanView";
import Link from "next/link";

export const metadata = { title: "Meal Plan" };

export default async function MealPlanPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");

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
      select: {
        id: true, mealPlanStartDate: true, profileCompleted: true,
        activePlanVersion: true, mealPlanStatus: true, mealPlanStale: true,
        weight: true, weightUnit: true,
        goalWeight: true, goalWeightUnit: true,
        height: true, heightUnit: true,
        sexAtBirth: true, birthday: true,
        physicalActivity: { select: { level: true } },
      },
    }),
  ]);

  // Show only the active plan version. First-time generation is triggered
  // client-side by DailyMealPlanView (Strategy B) — the page never generates.
  const activeVersion = patient?.activePlanVersion ?? 0;
  const finalMenus = menus.filter((m) => m.planVersion === activeVersion);

  const activeMeals = (todayJournal?.meals ?? []).filter((m) => !m.skipped && m.recipeId);
  const loggedRecipeIds = activeMeals.map((m) => m.recipeId as string);
  const initialMealRatings: Record<string, number> = {};
  for (const m of activeMeals) {
    if (m.recipeId && m.rating != null) initialMealRatings[m.recipeId] = m.rating;
  }

  let initialDailyCalorieTarget: number | null = null;
  if (
    patient?.mealPlanStartDate && patient.weight && patient.height &&
    patient.birthday && patient.physicalActivity?.level
  ) {
    const s = (patient.sexAtBirth ?? "").toLowerCase();
    const sex = s === "male" ? "male" as const : s === "female" ? "female" as const : null;
    if (sex) {
      const pi: CaloricProfileInput = {
        sex,
        birthday:     new Date(patient.birthday),
        heightValue:  patient.height,
        heightUnit:   patient.heightUnit === "in" ? "in" : "cm",
        cbwValue:     patient.weight,
        cbwUnit:      (patient.weightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs",
        activityLevel: patient.physicalActivity.level,
        utbwValue:    patient.goalWeight,
        utbwUnit:     (patient.goalWeightUnit === "lbs" ? "lbs" : "kg") as "kg" | "lbs" | null,
      };
      const profile = computeAllMetrics(pi);
      const planStart = new Date(patient.mealPlanStartDate);
      planStart.setHours(0, 0, 0, 0);
      const dayNumber = Math.round((today.getTime() - planStart.getTime()) / 86400000) + 1;
      if (dayNumber >= 1) {
        initialDailyCalorieTarget = gradualDailyCals(
          Math.round(profile.tdeeCBW),
          dayNumber,
          profile.cbmiClass,
          profile.minCaloriesValue,
          Math.round(profile.targetCalories),
        );
      }
    }
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
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-2" style={{ color: "#B75E78" }}>
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-3xl font-bold text-[#1E1A1A]">Meal Plan</h1>
          <p className="text-xs mt-1.5" style={{ color: "#848181" }}>Your personalised daily menu</p>
        </div>
        <Link
          href="/meal-plan/weekly"
          className="mp text-xs font-semibold px-4 py-2 rounded-xl border transition-colors mt-1"
          style={{
            animationDelay: "80ms",
            color: "#812549",
            borderColor: "rgba(129,37,73,0.25)",
            background: "rgba(129,37,73,0.06)",
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
          initialDailyCalorieTarget={initialDailyCalorieTarget}
          initialStale={patient?.mealPlanStale ?? false}
        />
      </div>
    </div>
  );
}
