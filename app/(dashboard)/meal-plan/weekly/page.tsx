import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { startOfWeek, addDays, format } from "date-fns";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import Link from "next/link";
import WeeklyMealPlanGrid from "@/components/meal-plan/WeeklyMealPlanGrid";

export const metadata = { title: "Weekly Plan" };

export default async function WeeklyPlanPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await getAccount(userId);
  if (!account) redirect("/login");
  if (!account.onboardingComplete) redirect("/profile?onboarding=true");

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);
  weekEnd.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: {
      patient: { account: { clerkId: userId } },
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
  });

  const weekLabel = (() => {
    const s = weekStart;
    const e = weekEnd;
    const sMonth = s.toLocaleDateString("en-US", { month: "short" });
    const eMonth = e.toLocaleDateString("en-US", { month: "short" });
    const sDay   = s.getDate();
    const eDay   = e.getDate();
    const year   = e.getFullYear();
    return sMonth === eMonth
      ? `${sMonth} ${sDay} – ${eDay}, ${year}`
      : `${sMonth} ${sDay} – ${eMonth} ${eDay}, ${year}`;
  })();

  const weekNumber = (() => {
    const d = new Date(weekStart);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  })();

  return (
    <div className="max-w-5xl mx-auto pb-8">
      <style>{`
        @keyframes wp-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wp { animation: wp-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="wp mb-8" style={{ animationDelay: "0ms" }}>
        <Link
          href="/meal-plan"
          className="inline-flex items-center gap-1.5 text-xs font-semibold mb-5 hover:text-[#0d1f10] transition-colors"
          style={{ color: "#ADBDAD" }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Meal Plan
        </Link>

        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-3xl font-bold text-[#0d1f10]">Weekly Plan</p>
              <span
                className="text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full"
                style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80" }}
              >
                Week {weekNumber}
              </span>
            </div>
            <p className="text-sm font-medium" style={{ color: "#9EA8A0" }}>{weekLabel}</p>
          </div>

          <div className="flex gap-1 mb-0.5">
            {["M","T","W","T","F","S","S"].map((d, i) => {
              const dayDate = addDays(weekStart, i);
              const isToday = dayDate.toDateString() === new Date().toDateString();
              return (
                <div
                  key={i}
                  className="w-8 h-8 rounded-lg flex flex-col items-center justify-center"
                  style={{
                    background: isToday ? "rgba(74,222,128,0.15)" : "transparent",
                    border: isToday ? "1px solid rgba(74,222,128,0.3)" : "1px solid transparent",
                  }}
                >
                  <span
                    className="text-[8px] font-bold uppercase leading-none"
                    style={{ color: isToday ? "#4ade80" : "#ADBDAD" }}
                  >
                    {d}
                  </span>
                  <span
                    className="text-[10px] font-bold leading-none mt-0.5"
                    style={{ color: isToday ? "#4ade80" : "#C8D4C8" }}
                  >
                    {dayDate.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Grid ───────────────────────────────────────────────── */}
      <div
        className="wp rounded-2xl overflow-hidden"
        style={{
          animationDelay: "120ms",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
        }}
      >
        <WeeklyMealPlanGrid
          initialMenus={menus as never}
          initialWeekStart={weekStart}
        />
      </div>
    </div>
  );
}
