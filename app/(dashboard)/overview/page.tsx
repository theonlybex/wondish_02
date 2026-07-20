import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccount, getOverviewPatient } from "@/lib/queries";
import Link from "next/link";
import MealStreakGrid, { GridDay } from "@/components/MealStreakGrid";
import CaloricProfileCard from "@/components/dashboard/CaloricProfileCard";
import QuickJournalLog from "@/components/dashboard/QuickJournalLog";
import DailyLogCard from "@/components/tracking/DailyLogCard";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const [account, patient] = await Promise.all([
    getAccount(userId),
    getOverviewPatient(userId),
  ]);

  if (!account) redirect("/login");

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
        where: { patientId: patient.id, planVersion: patient.activePlanVersion, date: { gte: gridStart, lte: yearEnd } },
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

  return (
    <div className="h-full overflow-hidden flex flex-col gap-4">
      <style>{`
        @keyframes ov-rise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* ── Bento grid ───────────────────────────────────────────── */}
      {/*
          With streak data:
            [ caloric ] [ caloric ] [   log   ]
            [ streak  ] [ streak  ] [ journal ]

          Without streak data:
            [ caloric ] [   log   ]
            [ caloric ] [ journal ]
      */}
      <div
        className="ov flex-1 min-h-0 grid gap-3"
        style={{
          animationDelay: "60ms",
          ...(gridDays.length > 0
            ? {
                gridTemplateColumns: "1fr 1fr 340px",
                gridTemplateRows: "3fr 2fr",
                gridTemplateAreas: `
                  "caloric caloric log"
                  "streak  streak  journal"
                `,
              }
            : {
                gridTemplateColumns: "1fr 340px",
                gridTemplateRows: "3fr 2fr",
                gridTemplateAreas: `
                  "caloric log"
                  "caloric journal"
                `,
              }),
        }}
      >
        {/* Meal Streak Grid — top, spans 2 cols (only if data exists) */}
        {gridDays.length > 0 && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ gridArea: "streak", boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
          >
            <MealStreakGrid days={gridDays} totalCompleted={totalCompleted} firstDay={gridFirstDay} />
          </div>
        )}

        {/* Daily Journal */}
        <div
          className="bg-white rounded-2xl overflow-hidden flex flex-col"
          style={{ gridArea: "journal", boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#F5F1DD] flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-1 h-4 rounded-full" style={{ background: "#a78bfa" }} />
              <h2 className="text-[#1E1A1A] text-sm font-bold">Daily Journal</h2>
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
            <QuickJournalLog />
          </div>
        </div>

        {/* Today's Log — intake tracking */}
        <div
          className="rounded-2xl overflow-hidden bg-white"
          style={{ gridArea: "log", boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
        >
          <DailyLogCard />
        </div>

        {/* Caloric Profile */}
        <div
          className="rounded-2xl overflow-hidden bg-white"
          style={{ gridArea: "caloric", boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
        >
          <CaloricProfileCard />
        </div>

      </div>
    </div>
  );
}
