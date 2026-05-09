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
  // Weight: prefer latest journal weight, fallback to profile weight
  const journalWeight = latestJournal?.weight ?? null;
  const profileWeight = patient?.weight ?? null;
  const currentWeight = journalWeight ?? profileWeight;
  const weightUnit = patient?.weightUnit === "lbs" ? "lbs" : "kg";
  const weightSource = journalWeight ? "from journal" : profileWeight ? "from profile" : "";

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
      value: currentWeight ? String(Math.round(currentWeight * 10) / 10) : "—",
      suffix: currentWeight ? ` ${weightUnit}` : "",
      sub: weightSource || t("fromLastJournal"),
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
    <div className="h-full overflow-hidden flex flex-col gap-4">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* ── Greeting row ────────────────────────────────────────────── */}
      <div className="ov flex-shrink-0 flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <div>
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-1" style={{ color: "#7DB87D" }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-2xl font-bold text-[#0d1f10] leading-tight">
            Welcome back, {account.firstName}.
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-px w-8 bg-primary/40" />
          <p className="text-xs" style={{ color: "#9EA8A0" }}>{t("snapshot")}</p>
        </div>
      </div>

      {/* ── Bento grid ───────────────────────────────────────────── */}
      {/*
          With streak data:
            [ streak  ] [ streak  ] [ stats ]
            [ journal ] [ caloric ] [ stats ]

          Without streak data:
            [ journal ] [ caloric ] [ stats ]
      */}
      <div
        className="ov flex-1 min-h-0 grid gap-3"
        style={{
          animationDelay: "60ms",
          gridTemplateColumns: "1fr 1fr 280px",
          ...(gridDays.length > 0
            ? {
                gridTemplateRows: "2fr 3fr",
                gridTemplateAreas: `
                  "streak  streak  stats"
                  "journal caloric stats"
                `,
              }
            : {
                gridTemplateRows: "1fr",
                gridTemplateAreas: `"journal caloric stats"`,
              }),
        }}
      >
        {/* Meal Streak Grid — top, spans 2 cols (only if data exists) */}
        {gridDays.length > 0 && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ gridArea: "streak", boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)" }}
          >
            <MealStreakGrid days={gridDays} totalCompleted={totalCompleted} firstDay={gridFirstDay} />
          </div>
        )}

        {/* Daily Journal */}
        <div
          className="bg-white rounded-2xl overflow-hidden flex flex-col"
          style={{ gridArea: "journal", boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)" }}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#F0F4F0] flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-1 h-4 rounded-full" style={{ background: "#a78bfa" }} />
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
          <div className="px-5 py-3 flex-1 overflow-auto">
            <QuickJournalLog defaultWeightUnit="lbs" />
          </div>
        </div>

        {/* Caloric Profile */}
        <div
          className="rounded-2xl overflow-hidden bg-white"
          style={{ gridArea: "caloric", boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)" }}
        >
          <CaloricProfileCard />
        </div>

        {/* Stats — right column, spans both rows */}
        <div
          className="flex flex-col gap-3"
          style={{ gridArea: "stats" }}
        >
          {statsCards.map(({ label, value, suffix, sub, accent, delay }) => (
            <div
              key={label}
              className="ov bg-white rounded-2xl p-5 relative overflow-hidden group cursor-default select-none flex-1"
              style={{
                animationDelay: delay,
                boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
              }}
            >
              <div className="absolute top-4 right-4 w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
              <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-3" style={{ color: "#ADBDAD" }}>
                {label}
              </p>
              <div className="flex items-baseline gap-1 mb-1.5">
                <span
                  className="font-black tabular-nums leading-none tracking-tight"
                  style={{ fontSize: "clamp(2rem, 3.5vw, 2.6rem)", color: "#0d1f10" }}
                >
                  {value}
                </span>
                {suffix && (
                  <span className="text-sm font-medium" style={{ color: "#C8D4C8" }}>{suffix}</span>
                )}
              </div>
              <p className="text-xs" style={{ color: "#ADBDAD" }}>{sub}</p>
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                style={{ background: `radial-gradient(ellipse at 90% 110%, ${accent}18 0%, transparent 55%)` }}
              />
            </div>
          ))}

          {/* Upgrade CTA — fills remaining space at bottom */}
          {account.subscription?.plan !== "PREMIUM" && (
            <div
              className="ov relative rounded-2xl p-5 overflow-hidden flex-1"
              style={{
                animationDelay: "280ms",
                background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
                boxShadow: "0 4px 16px rgba(13,31,16,0.2)",
              }}
            >
              <div
                className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 65%)", transform: "translate(30%, -30%)" }}
              />
              <div className="relative">
                <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-2" style={{ color: "rgba(74,222,128,0.5)" }}>
                  Premium
                </p>
                <p className="text-white text-sm font-bold mb-3 leading-snug">{t("upgradeTitle")}</p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-1.5 bg-primary text-[#0a1509] px-4 py-2 rounded-lg font-bold text-xs transition-all hover:bg-primary-dark"
                  style={{ boxShadow: "0 2px 12px rgba(74,222,128,0.25)" }}
                >
                  {t("upgradeCta")}
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
