import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { addDays, format } from "date-fns";
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

  const patient = await prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    select: { activePlanVersion: true },
  });

  // The current rolling window is the upcoming days of the active plan. Load
  // from today forward (capped generously past a 7-day week).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeEnd = addDays(today, 13);
  rangeEnd.setHours(23, 59, 59, 999);

  const menus = await prisma.menu.findMany({
    where: {
      patient: { account: { clerkId: userId } },
      planVersion: patient?.activePlanVersion ?? 0,
      date: { gte: today, lte: rangeEnd },
    },
    include: {
      recipe: {
        include: {
          mealType: true,
          ethnic: true,
          ingredients: { include: { ingredient: true } },
        },
      },
      mealType: true,
    },
    orderBy: [{ date: "asc" }, { mealType: { name: "asc" } }],
  });

  const label = (() => {
    if (menus.length === 0) return "";
    const dates = menus.map((m) => new Date(m.date)).sort((a, b) => a.getTime() - b.getTime());
    const s = dates[0];
    const e = dates[dates.length - 1];
    const sMonth = s.toLocaleDateString("en-US", { month: "short" });
    const eMonth = e.toLocaleDateString("en-US", { month: "short" });
    return sMonth === eMonth
      ? `${sMonth} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`
      : `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`;
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

      <div className="wp mb-8" style={{ animationDelay: "0ms" }}>
        <Link
          href="/meal-plan"
          className="inline-flex items-center gap-1.5 text-xs font-semibold mb-5 hover:text-[#1E1A1A] transition-colors"
          style={{ color: "#ABA6A6" }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M13 8H3M7 4l-4 4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Meal Plan
        </Link>

        <p className="text-3xl font-bold text-[#1E1A1A]">Your week</p>
        {label && <p className="text-sm font-medium mt-2" style={{ color: "#848181" }}>{label}</p>}
      </div>

      <div
        className="wp rounded-2xl overflow-hidden"
        style={{
          animationDelay: "120ms",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
        }}
      >
        <WeeklyMealPlanGrid menus={menus as never} />
      </div>
    </div>
  );
}
