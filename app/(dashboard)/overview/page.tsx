import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount, getOverviewPatient } from "@/lib/queries";
import Link from "next/link";
import MealStreakGrid, { GridDay } from "@/components/MealStreakGrid";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  // Run account + patient in parallel; getAccount is deduped with layout.tsx
  const [account, patient] = await Promise.all([
    getAccount(userId),
    getOverviewPatient(userId),
  ]);

  if (!account) redirect("/login");

  // Onboarding redirect
  if (!account.onboardingComplete) {
    redirect("/profile?onboarding=true");
  }

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

  const t = await getTranslations("overview");

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
          {t("greeting", { name: account.firstName })}
        </h1>
        <p className="text-[#B0B3BB] mt-1 text-sm">{t("snapshot")}</p>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 relative overflow-hidden group hover:border-primary/20 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-primary/0 rounded-t-2xl" />
          <p className="text-[#B0B3BB] text-[10px] font-bold uppercase tracking-[0.15em] mb-3">{t("todaysMeals")}</p>
          <p className="text-3xl font-bold text-navy mb-1 tabular-nums">
            {completedMeals}<span className="text-[#D0D3DA] font-medium">/{todayMenus.length || 4}</span>
          </p>
          <p className="text-[#B0B3BB] text-xs">{t("mealsCompleted")}</p>
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 relative overflow-hidden group hover:border-blue-200 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-400/60 to-blue-400/0 rounded-t-2xl" />
          <p className="text-[#B0B3BB] text-[10px] font-bold uppercase tracking-[0.15em] mb-3">{t("currentWeight")}</p>
          <p className="text-3xl font-bold text-navy mb-1 tabular-nums">
            {currentWeight ? currentWeight : "—"}<span className="text-[#B0B3BA] text-base font-medium ml-0.5">{currentWeight ? " kg" : ""}</span>
          </p>
          <p className="text-[#B0B3BB] text-xs">{t("fromLastJournal")}</p>
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-5 relative overflow-hidden group hover:border-amber-200 transition-colors">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400/60 to-amber-400/0 rounded-t-2xl" />
          <p className="text-[#B0B3BB] text-[10px] font-bold uppercase tracking-[0.15em] mb-3">{t("streakLabel")}</p>
          <p className="text-3xl font-bold text-navy mb-1 tabular-nums">{t("streakDays", { count: streak })}</p>
          <p className="text-[#B0B3BB] text-xs">{t("consecutiveEntries")}</p>
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
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-navy text-sm">{t("todaysMealPlan")}</h2>
            <Link href="/meal-plan" className="text-primary text-xs font-semibold hover:text-primary-dark transition-colors">
              {t("viewAll")} →
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {todayMenus.map((menu) => (
              <div key={menu.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#F8FAF8] border border-[#EEF0EE] hover:border-primary/20 transition-colors">
                <span className="text-2xl w-9 h-9 flex items-center justify-center bg-white rounded-lg border border-[#E8E7EA] shadow-sm flex-shrink-0">{menu.recipe.emoji ?? "🍽"}</span>
                <div className="min-w-0">
                  <p className="font-medium text-[#25293C] text-sm leading-tight truncate">{menu.recipe.name}</p>
                  <p className="text-[#B0B3BB] text-xs mt-0.5">{menu.mealType?.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-8 mb-5 text-center">
          <p className="text-4xl mb-3">🍽</p>
          <p className="text-[#25293C] font-semibold text-sm mb-1">{t("noMealPlan")}</p>
          <p className="text-[#B0B3BB] text-xs mb-5">Your personalised daily menu will appear here.</p>
          <Link
            href="/meal-plan"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-[#0a1509] px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-primary/20"
          >
            {t("setUpMealPlan")}
          </Link>
        </div>
      )}

      {/* Upgrade CTA */}
      {account.subscription?.plan !== "PREMIUM" && (
        <div className="relative rounded-2xl p-8 overflow-hidden" style={{ background: "linear-gradient(135deg, #0d1f10 0%, #152718 100%)" }}>
          <div className="absolute top-0 right-0 w-80 h-80 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 70%)", transform: "translate(30%, -30%)" }} />
          <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(74,222,128,0.06) 0%, transparent 70%)", transform: "translate(-30%, 30%)" }} />
          <div className="relative">
            <p className="text-primary/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-3">Premium</p>
            <h2 className="text-white font-bold text-xl mb-2 leading-snug">{t("upgradeTitle")}</h2>
            <p className="text-white/40 text-sm mb-6 max-w-md leading-relaxed">
              {t("upgradeDesc")}
            </p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-[#0a1509] px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg shadow-primary/25"
            >
              {t("upgradeCta")}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
