"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import DatePicker from "@/components/ui/DatePicker";
import Button from "@/components/ui/Button";
import StatCard from "@/components/journey/StatCard";
import MealSourceDonut from "@/components/journey/MealSourceDonut";
import MoodTrendLine from "@/components/journey/MoodTrendLine";
import { JourneyStats } from "@/types";

interface JourneyDashboardProps {
  initialStats: JourneyStats;
}

export default function JourneyDashboard({ initialStats }: JourneyDashboardProps) {
  const [stats, setStats] = useState(initialStats);
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
    } finally {
      setLoading(false);
    }
  };

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
          value={stats.avgWeight ? `${stats.avgWeight} kg` : "—"}
          icon="⚖️"
        />
        <StatCard
          label="Engagement"
          value={`${stats.engagementPercent}%`}
          icon="📅"
          subtitle="days with logged meals"
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6">
          <h3 className="font-semibold text-navy mb-4">Mood Trend</h3>
          <MoodTrendLine data={stats.dailyMoods} />
        </div>

        <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6">
          <h3 className="font-semibold text-navy mb-4">Meal Sources</h3>
          <MealSourceDonut breakdown={stats.mealSourceBreakdown} />
        </div>
      </div>
    </div>
  );
}
