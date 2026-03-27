import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import MealStreakGrid, { GridDay } from "@/components/MealStreakGrid";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true },
  });
  if (!account) redirect("/login");

  // Onboarding redirect
  if (!account.onboardingComplete) {
    redirect("/profile?onboarding=true");
  }

  const patient = await prisma.patient.findUnique({
    where: { accountId: account.id },
    include: {
      journalEntries: {
        orderBy: { date: "desc" },
        take: 7,
        include: { meals: true },
      },
      menus: {
        where: {
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
        include: { recipe: true, mealType: true },
      },
    },
  });

  const todayMenus = patient?.menus ?? [];
  const latestJournal = patient?.journalEntries?.[0];
  const currentWeight = latestJournal?.weight ?? null;

  // Streak: consecutive days with journal entry
  const streak = (() => {
    const entries = patient?.journalEntries ?? [];
    let count = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < entries.length; i++) {
      const entryDate = new Date(entries[i].date);
      entryDate.setHours(0, 0, 0, 0);
      const expected = new Date(today);
      expected.setDate(today.getDate() - i);
      if (entryDate.getTime() === expected.getTime()) {
        count++;
      } else {
        break;
      }
    }
    return count;
  })();

  const completedMeals = todayMenus.filter((m) => {
    const journalMeals = latestJournal?.meals ?? [];
    return journalMeals.some(
      (jm) => jm.recipeId === m.recipeId && !jm.skipped
    );
  }).length;

  // ── Streak grid: registration date → Dec 31 ────────────────────────────────
  const gridDays: GridDay[] = [];
  let totalCompleted = 0;
  let gridFirstDay = "";

  if (patient) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yearEnd = new Date(today.getFullYear(), 11, 31); // Dec 31

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // User's registration date — used to hide pre-join cells in the first column
    const rawRegistered = new Date((account as { createdAt?: Date }).createdAt ?? today);
    rawRegistered.setHours(0, 0, 0, 0);
    gridFirstDay = fmt(rawRegistered);

    // Cap grid display to Jan 1 of current year so old users don't get huge grids
    const yearStart = new Date(today.getFullYear(), 0, 1);
    const registeredAt = rawRegistered > yearStart ? rawRegistered : yearStart;

    // Grid starts on the Sunday of the (capped) registration week
    const gridStart = new Date(registeredAt);
    gridStart.setDate(registeredAt.getDate() - registeredAt.getDay());

    const [allMenusGrid, allJournalsGrid] = await Promise.all([
      prisma.menu.findMany({
        where: { patientId: patient.id, date: { gte: gridStart, lte: yearEnd } },
        select: { date: true, recipeId: true },
      }),
      prisma.journalEntry.findMany({
        where: { patientId: patient.id, date: { gte: gridStart, lte: yearEnd } },
        include: { meals: { select: { recipeId: true, skipped: true } } },
      }),
    ]);

    const menusByDate = new Map<string, Set<string>>();
    for (const m of allMenusGrid) {
      const key = fmt(new Date(m.date));
      if (!menusByDate.has(key)) menusByDate.set(key, new Set());
      menusByDate.get(key)!.add(m.recipeId);
    }

    const loggedByDate = new Map<string, Set<string>>();
    for (const j of allJournalsGrid) {
      const key = fmt(new Date(j.date));
      if (!loggedByDate.has(key)) loggedByDate.set(key, new Set());
      for (const m of j.meals) {
        if (!m.skipped && m.recipeId) loggedByDate.get(key)!.add(m.recipeId);
      }
    }

    // Build grid from gridStart to Dec 31
    const totalDays = Math.ceil((yearEnd.getTime() - gridStart.getTime()) / 86400000) + 1;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const key = fmt(d);

      if (d > today) {
        gridDays.push({ date: key, status: "future" });
        continue;
      }

      const planned = menusByDate.get(key);
      if (!planned || planned.size === 0) {
        gridDays.push({ date: key, status: "empty" });
        continue;
      }

      const logged = loggedByDate.get(key);
      const loggedCount = logged ? Array.from(planned).filter((id) => logged.has(id)).length : 0;

      if (loggedCount === planned.size) {
        gridDays.push({ date: key, status: "full" });
        totalCompleted++;
      } else if (loggedCount > 0) {
        gridDays.push({ date: key, status: "partial" });
      } else {
        gridDays.push({ date: key, status: "none" });
      }
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">
          Good to see you, {account.firstName} 👋
        </h1>
        <p className="text-[#8A8D93] mt-1 text-sm">Here&apos;s your health snapshot for today.</p>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-5 mb-8">
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
          <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-3">Today&apos;s Meals</p>
          <p className="text-3xl font-bold text-navy mb-1">
            {completedMeals}/{todayMenus.length || 4}
          </p>
          <p className="text-[#8A8D93] text-xs">meals completed</p>
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
          <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-3">Current Weight</p>
          <p className="text-3xl font-bold text-navy mb-1">
            {currentWeight ? `${currentWeight} kg` : "—"}
          </p>
          <p className="text-[#8A8D93] text-xs">from last journal entry</p>
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5">
          <p className="text-[#8A8D93] text-xs font-semibold uppercase tracking-wide mb-3">Streak</p>
          <p className="text-3xl font-bold text-navy mb-1">{streak} days</p>
          <p className="text-[#8A8D93] text-xs">consecutive journal entries</p>
        </div>
      </div>

      {/* Streak grid */}
      {gridDays.length > 0 && (
        <div className="mb-8">
          <MealStreakGrid days={gridDays} totalCompleted={totalCompleted} firstDay={gridFirstDay} />
        </div>
      )}

      {/* Today's meal plan preview */}
      {todayMenus.length > 0 ? (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-navy">Today&apos;s Meal Plan</h2>
            <Link href="/meal-plan" className="text-primary text-sm font-medium hover:underline">
              View all →
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {todayMenus.map((menu) => (
              <div key={menu.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface">
                <span className="text-2xl">{menu.recipe.emoji ?? "🍽"}</span>
                <div>
                  <p className="font-medium text-navy text-sm">{menu.recipe.name}</p>
                  <p className="text-[#8A8D93] text-xs">{menu.mealType?.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6 mb-6 text-center">
          <p className="text-[#8A8D93] mb-3">No meal plan for today.</p>
          <Link
            href="/meal-plan"
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            Set up meal plan
          </Link>
        </div>
      )}

      {/* Upgrade CTA */}
      {account.subscription?.plan !== "PREMIUM" && (
        <div className="relative bg-navy rounded-2xl p-8 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            <h2 className="text-white font-bold text-xl mb-2">Unlock the full experience</h2>
            <p className="text-white/50 text-sm mb-6 max-w-md">
              Upgrade to Premium for custom ingredients, full journey analytics, and priority support. First 14 days free.
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-primary/30"
            >
              Upgrade to Premium — $15/mo
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
