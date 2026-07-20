"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { MacroStats } from "@/types";

interface MacroSplitDonutProps {
  macroStats: Pick<MacroStats, "avgProtein" | "avgCarbs" | "avgFat" | "daysComplete">;
}

// Pinned palette (plan §Stats rewiring): lightness-separated brand steps, with
// paddingAngle white gaps + legend/direct values as the secondary encoding.
const COLORS = {
  Protein: "#812549",
  Carbs: "#B75E78",
  Fat: "#FDC221",
};

export default function MacroSplitDonut({ macroStats }: MacroSplitDonutProps) {
  const data = [
    { name: "Protein", value: macroStats.avgProtein },
    { name: "Carbs", value: macroStats.avgCarbs },
    { name: "Fat", value: macroStats.avgFat },
  ].filter((d) => d.value > 0);

  if (macroStats.daysComplete === 0 || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#848181] text-sm">
        No meals logged yet — log a meal to see your macro split
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name as keyof typeof COLORS] ?? "#EAE4CA"}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [`${Math.round(Number(value))} g avg/day`, ""]}
          contentStyle={{ borderRadius: "12px", border: "1px solid #EAE4CA" }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value, entry) => {
            const grams = (entry as { payload?: { value?: number } })?.payload?.value;
            return (
              <span className="text-xs text-[#848181]">
                {value}
                {grams != null ? ` · ${Math.round(grams)} g` : ""}
              </span>
            );
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
