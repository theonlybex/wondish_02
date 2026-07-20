"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import DatePicker from "@/components/ui/DatePicker";
import Button from "@/components/ui/Button";
import StatCard from "@/components/journey/StatCard";
import MealSourceDonut from "@/components/journey/MealSourceDonut";
import MoodTrendLine from "@/components/journey/MoodTrendLine";
import CalorieTrendLine from "@/components/journey/CalorieTrendLine";
import MacroSplitDonut from "@/components/journey/MacroSplitDonut";
import { JourneyStats, MacroStats } from "@/types";

interface JourneyDashboardProps {
  initialStats: JourneyStats;
  initialMacroStats: MacroStats;
}

export default function JourneyDashboard({ initialStats, initialMacroStats }: JourneyDashboardProps) {
  const [stats, setStats] = useState(initialStats);
  const [macroStats, setMacroStats] = useState(initialMacroStats);
  const [from, setFrom] = useState(subDays(new Date(), 29));
  const [to, setTo] = useState(new Date());
  const [loading, setLoading] = useState(false);

  const load = async (f: Date, t: Date) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/journey?from=${format(f, "yyyy-MM-dd")}&to=${format(t, "yyyy-MM-dd")}`
      );
      const data = await res.json();
      setStats(data.stats);
      if (data.macroStats) setMacroStats(data.macroStats);
    } finally {
      setLoading(false);
    }
  };

  const { daysComplete, daysIncomplete, daysOnTarget, target } = macroStats;
  const hasMacroData = daysComplete > 0;

  return (
    <div className="space-y-8">
      {/* Date range controls */}
      <div className="flex flex-wrap items-end gap-3">
        <DatePicker label="From" value={from} onChange={setFrom} />
        <DatePicker label="To" value={to} onChange={setTo} />
        <Button onClick={() => load(from, to)} loading={loading}>
          Update
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Avg Mood"
          value={stats.avgMood > 0 ? stats.avgMood.toFixed(1) : "—"}
          icon="😊"
          subtitle="out of 4"
        />
        <StatCard
          label="Avg Energy"
          value={stats.avgEnergy > 0 ? stats.avgEnergy.toFixed(1) : "—"}
          icon="⚡"
          subtitle="out of 4"
        />
        <StatCard
          label="Avg Weight"
          value={stats.avgWeight ? `${stats.avgWeight} lbs` : "—"}
          icon="⚖️"
        />
        <StatCard
          label="Engagement"
          value={`${stats.engagementPercent}%`}
          icon="📅"
          subtitle="days with logged meals"
        />
      </div>

      {/* Macro tiles — all values come from stored MealLog snapshots (server-
          computed macroStats); all-incomplete days are excluded from averages
          and surfaced via the daysIncomplete counter. */}
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard
          label="Avg Calories"
          value={hasMacroData ? Math.round(macroStats.avgCalories).toLocaleString() : "—"}
          icon="🔥"
          subtitle="kcal per logged day"
        />
        <StatCard
          label="Avg Protein"
          value={hasMacroData ? `${Math.round(macroStats.avgProtein)} g` : "—"}
          icon="💪"
          subtitle="per logged day"
        />
        <StatCard
          label="Days On Target"
          value={hasMacroData && target ? `${daysOnTarget}/${daysComplete}` : "—"}
          icon="🎯"
          subtitle={
            !target
              ? "complete your profile to set a target"
              : daysIncomplete > 0
                ? `±10% of target · ${daysIncomplete} day${daysIncomplete === 1 ? "" : "s"} not counted`
                : "within ±10% of calorie target"
          }
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-6">
          <h3 className="font-semibold text-navy mb-4">Mood Trend</h3>
          <MoodTrendLine data={stats.dailyMoods} />
        </div>

        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-6">
          <h3 className="font-semibold text-navy mb-4">Meal Sources</h3>
          <MealSourceDonut breakdown={stats.mealSourceBreakdown} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-6">
          <h3 className="font-semibold text-navy mb-4">Calorie Trend</h3>
          <CalorieTrendLine data={macroStats.dailyMacros} target={target} />
          {daysIncomplete > 0 && (
            <p className="text-xs text-[#848181] mt-3">
              {daysIncomplete} day{daysIncomplete === 1 ? "" : "s"} with incomplete nutrition data
              {" "}shown in yellow — excluded from averages and the on-target count.
            </p>
          )}
        </div>

        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-6">
          <h3 className="font-semibold text-navy mb-4">Macro Split</h3>
          <MacroSplitDonut macroStats={macroStats} />
        </div>
      </div>
    </div>
  );
}
