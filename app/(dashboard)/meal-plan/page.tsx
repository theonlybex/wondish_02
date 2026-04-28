import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
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
      select: { mealPlanStartDate: true },
    }),
  ]);

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

  // Macro bar widths — calories anchors at 2000 kcal, macros at sensible daily targets
  const calPct  = Math.min(100, (totalCalories / 2000) * 100);
  const protPct = Math.min(100, (totalProtein  / 150)  * 100);
  const carbPct = Math.min(100, (totalCarbs    / 250)  * 100);
  const fatPct  = Math.min(100, (totalFat      / 70)   * 100);

  return (
    <div className="max-w-5xl mx-auto pb-8">
      <style>{`
        @keyframes mp-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .mp { animation: mp-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes mp-bar {
          from { width: 0%; }
        }
        .mp-bar { animation: mp-bar 0.9s cubic-bezier(0.22, 1, 0.36, 1) both; }
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

      {/* ── Nutrition summary card ──────────────────────────────── */}
      {menus.length > 0 && (
        <div
          className="mp rounded-2xl p-6 mb-6"
          style={{
            animationDelay: "100ms",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
          }}
        >
          {/* Top row: calories prominent, macros right */}
          <div className="flex items-end justify-between mb-5">
            <div>
              <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1.5" style={{ color: "#ADBDAD" }}>
                Today&apos;s calories
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-black tracking-tight text-[#0d1f10] tabular-nums leading-none">
                  {Math.round(totalCalories)}
                </span>
                <span className="text-sm font-medium" style={{ color: "#C8D4C8" }}>kcal</span>
              </div>
            </div>
            <div className="flex gap-5 text-right">
              {[
                { label: "Protein", value: Math.round(totalProtein),  color: "#60a5fa" },
                { label: "Carbs",   value: Math.round(totalCarbs),    color: "#fb923c" },
                { label: "Fat",     value: Math.round(totalFat),      color: "#a78bfa" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <p className="text-[9px] tracking-[0.18em] uppercase font-bold mb-1" style={{ color: "#ADBDAD" }}>{label}</p>
                  <p className="text-xl font-black tabular-nums leading-none" style={{ color: "#0d1f10" }}>
                    {value}<span className="text-xs font-medium ml-0.5" style={{ color: "#C8D4C8" }}>g</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Macro progress bars */}
          <div className="space-y-2.5">
            {[
              { label: "Calories", pct: calPct,  color: "#4ade80" },
              { label: "Protein",  pct: protPct, color: "#60a5fa" },
              { label: "Carbs",    pct: carbPct, color: "#fb923c" },
              { label: "Fat",      pct: fatPct,  color: "#a78bfa" },
            ].map(({ label, pct, color }, i) => (
              <div key={label} className="flex items-center gap-3">
                <p className="text-[9px] w-12 font-bold uppercase tracking-wide flex-shrink-0" style={{ color: "#ADBDAD" }}>{label}</p>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0F4F0" }}>
                  <div
                    className="mp-bar h-full rounded-full"
                    style={{ width: `${pct}%`, background: color, animationDelay: `${200 + i * 60}ms` }}
                  />
                </div>
                <p className="text-[9px] font-bold w-8 text-right tabular-nums flex-shrink-0" style={{ color: "#ADBDAD" }}>
                  {Math.round(pct)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Daily plan view ────────────────────────────────────── */}
      <div className="mp" style={{ animationDelay: "260ms" }}>
        <DailyMealPlanView
          initialMenus={menus as never}
          initialDate={format(today, "yyyy-MM-dd")}
          mealPlanStartDate={patient?.mealPlanStartDate?.toISOString() ?? null}
          initialLoggedRecipeIds={loggedRecipeIds}
          initialMealRatings={initialMealRatings}
        />
      </div>
    </div>
  );
}
