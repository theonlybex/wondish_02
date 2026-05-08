import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount, getOverviewPatient } from "@/lib/queries";
import Link from "next/link";
import MealStreakGrid, { GridDay } from "@/components/MealStreakGrid";
import CaloricProfileCard from "@/components/dashboard/CaloricProfileCard";
import QuickJournalLog from "@/components/dashboard/QuickJournalLog";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, patient] = await Promise.all([
    getAccount(userId),
    getOverviewPatient(userId),
  ]);

  if (!account) redirect("/login");

  if (!account.onboardingComplete) {
    redirect("/profile?onboarding=true");
  }

  const todayMenus = patient?.menus ?? [];
  const latestJournal = patient?.journalEntries?.[0];
  const currentWeight = latestJournal?.weight ?? null;

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

  // ── Streak grid ────────────────────────────────────────────────────────────
  const gridDays: GridDay[] = [];
  let totalCompleted = 0;
  let gridFirstDay = "";

  if (patient) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yearEnd = new Date(today.getFullYear(), 11, 31);

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const rawRegistered = new Date((account as { createdAt?: Date }).createdAt ?? today);
    rawRegistered.setHours(0, 0, 0, 0);
    gridFirstDay = fmt(rawRegistered);

    const yearStart = new Date(today.getFullYear(), 0, 1);
    const registeredAt = rawRegistered > yearStart ? rawRegistered : yearStart;

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

  const statsCards = [
    {
      label: t("todaysMeals"),
      value: String(completedMeals),
      suffix: `/${todayMenus.length || 4}`,
      sub: t("mealsCompleted"),
      accent: "#4ade80",
      delay: "70ms",
    },
    {
      label: t("currentWeight"),
      value: currentWeight ? String(currentWeight) : "—",
      suffix: currentWeight ? " kg" : "",
      sub: t("fromLastJournal"),
      accent: "#60a5fa",
      delay: "140ms",
    },
    {
      label: t("streakLabel"),
      value: String(streak),
      suffix: streak === 1 ? " day" : " days",
      sub: t("consecutiveEntries"),
      accent: "#fb923c",
      delay: "210ms",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto pb-8">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* ── Two-column grid ─────────────────────────────────────────── */}
      <div className="xl:grid xl:grid-cols-[1fr_320px] xl:gap-7 xl:items-start">

        {/* ── LEFT COLUMN ─────────────────────────────────────────── */}
        <div className="min-w-0">

          {/* Greeting */}
          <div className="ov mb-10" style={{ animationDelay: "0ms" }}>
            <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#7DB87D" }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 className="text-3xl font-bold text-[#0d1f10] leading-tight">
              Welcome back, {account.firstName}.
            </h1>
            <div className="flex items-center gap-3 mt-4">
              <div className="h-px w-12 bg-primary/40" />
              <p className="text-xs" style={{ color: "#9EA8A0" }}>{t("snapshot")}</p>
            </div>
          </div>

          {/* Caloric Profile */}
          <div className="ov mb-6" style={{ animationDelay: "120ms" }}>
            <CaloricProfileCard />
          </div>

          {/* Activity grid */}
          {gridDays.length > 0 && (
            <div className="ov mb-6" style={{ animationDelay: "200ms" }}>
              <MealStreakGrid days={gridDays} totalCompleted={totalCompleted} firstDay={gridFirstDay} />
            </div>
          )}

          {/* Upgrade CTA */}
          {account.subscription?.plan !== "PREMIUM" && (
            <div
              className="ov relative rounded-2xl p-9 overflow-hidden"
              style={{
                animationDelay: "280ms",
                background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
                boxShadow: "0 8px 32px rgba(13,31,16,0.25)",
              }}
            >
              <div
                className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(74,222,128,0.10) 0%, transparent 65%)", transform: "translate(35%, -35%)" }}
              />
              <div
                className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(74,222,128,0.06) 0%, transparent 70%)", transform: "translate(-30%, 30%)" }}
              />
              <div className="relative">
                <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-4" style={{ color: "rgba(74,222,128,0.45)" }}>
                  Premium
                </p>
                <h2 className="text-white text-2xl font-bold mb-2 leading-snug">
                  {t("upgradeTitle")}
                </h2>
                <p className="text-sm mb-7 max-w-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
                  {t("upgradeDesc")}
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-[#0a1509] px-6 py-3 rounded-xl font-bold text-sm transition-all"
                  style={{ boxShadow: "0 4px 20px rgba(74,222,128,0.25)" }}
                >
                  {t("upgradeCta")}
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 mt-8 xl:mt-0">

          {/* Meal Plan widget */}
          <div
            className="ov bg-white rounded-2xl overflow-hidden"
            style={{
              animationDelay: "60ms",
              boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
            }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F4F0]">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-5 rounded-full bg-primary" />
                <h2 className="text-[#0d1f10] text-sm font-bold">Today&apos;s Meals</h2>
              </div>
              <Link
                href="/meal-plan"
                className="text-[9px] tracking-[0.2em] uppercase font-bold transition-colors"
                style={{ color: "#4ade80" }}
              >
                Full Plan →
              </Link>
            </div>

            <div className="px-5 py-4">
              {todayMenus.length === 0 ? (
                <div className="flex flex-col items-center py-6 gap-2">
                  <span className="text-3xl">🍽️</span>
                  <p className="text-xs text-center" style={{ color: "#ADBDAD" }}>
                    No meals planned today
                  </p>
                  <Link
                    href="/meal-plan"
                    className="mt-1 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors"
                    style={{ background: "rgba(74,222,128,0.1)", color: "#3aad5a" }}
                  >
                    View meal plan
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayMenus.map((menu) => {
                    const isLogged = (latestJournal?.meals ?? []).some(
                      (jm) => jm.recipeId === menu.recipeId && !jm.skipped
                    );
                    return (
                      <div
                        key={menu.id}
                        className="flex items-center gap-3 p-2.5 rounded-xl transition-colors"
                        style={{ background: isLogged ? "rgba(74,222,128,0.06)" : "#FAFBFA" }}
                      >
                        <span className="text-xl flex-shrink-0">
                          {(menu.recipe as { emoji?: string }).emoji ?? "🍽️"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-xs font-bold leading-tight truncate"
                            style={{ color: "#0d1f10" }}
                          >
                            {menu.recipe.name}
                          </p>
                          <p className="text-[10px] mt-0.5" style={{ color: "#ADBDAD" }}>
                            {menu.mealType?.name ?? ""}{menu.recipe.calories ? ` · ${menu.recipe.calories} kcal` : ""}
                          </p>
                        </div>
                        {isLogged && (
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px]"
                            style={{ background: "#4ade80", color: "#0a1509" }}
                          >
                            ✓
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Progress bar */}
                  <div className="mt-3 flex items-center gap-2.5">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0F4F0" }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${todayMenus.length ? (completedMeals / todayMenus.length) * 100 : 0}%`,
                          background: "#4ade80",
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-bold tabular-nums flex-shrink-0" style={{ color: "#ADBDAD" }}>
                      {completedMeals}/{todayMenus.length}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Journal widget */}
          <div
            className="ov bg-white rounded-2xl overflow-hidden"
            style={{
              animationDelay: "130ms",
              boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
            }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F4F0]">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-5 rounded-full" style={{ background: "#a78bfa" }} />
                <h2 className="text-[#0d1f10] text-sm font-bold">Daily Journal</h2>
              </div>
              <Link
                href="/journal"
                className="text-[9px] tracking-[0.2em] uppercase font-bold transition-colors"
                style={{ color: "#a78bfa" }}
              >
                Full Journal →
              </Link>
            </div>
            <div className="px-5 py-5">
              <QuickJournalLog defaultWeightUnit={patient?.weightUnit ?? "lbs"} />
            </div>
          </div>

          {/* Stats cards — stacked column */}
          {statsCards.map(({ label, value, suffix, sub, accent, delay }) => (
            <div
              key={label}
              className="ov bg-white rounded-2xl p-5 relative overflow-hidden group cursor-default select-none"
              style={{
                animationDelay: delay,
                boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
              }}
            >
              <div
                className="absolute top-4 right-4 w-2 h-2 rounded-full"
                style={{ backgroundColor: accent }}
              />
              <p
                className="text-[9px] tracking-[0.22em] uppercase font-bold mb-3"
                style={{ color: "#ADBDAD" }}
              >
                {label}
              </p>
              <div className="flex items-baseline gap-1 mb-1.5">
                <span
                  className="font-black tabular-nums leading-none tracking-tight"
                  style={{ fontSize: "clamp(2.2rem, 4vw, 2.8rem)", color: "#0d1f10" }}
                >
                  {value}
                </span>
                {suffix && (
                  <span className="text-base font-medium" style={{ color: "#C8D4C8" }}>
                    {suffix}
                  </span>
                )}
              </div>
              <p className="text-xs" style={{ color: "#ADBDAD" }}>{sub}</p>
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                style={{ background: `radial-gradient(ellipse at 90% 110%, ${accent}18 0%, transparent 55%)` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
