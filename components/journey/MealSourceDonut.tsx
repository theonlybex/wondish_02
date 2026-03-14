"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { JourneyStats } from "@/types";

interface MealSourceDonutProps {
  breakdown: JourneyStats["mealSourceBreakdown"];
}

const COLORS = {
  Cooked: "#28C76F",
  Skipped: "#EA5455",
  "Ready-to-eat": "#FF9F43",
  Restaurant: "#7367F0",
};

export default function MealSourceDonut({ breakdown }: MealSourceDonutProps) {
  const data = [
    { name: "Cooked", value: breakdown.cooked },
    { name: "Skipped", value: breakdown.skipped },
    { name: "Ready-to-eat", value: breakdown.readyToEat },
    { name: "Restaurant", value: breakdown.restaurant },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#8A8D93] text-sm">
        No meal data yet
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
              fill={COLORS[entry.name as keyof typeof COLORS] ?? "#E8E7EA"}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [`${value} meals`, ""]}
          contentStyle={{ borderRadius: "12px", border: "1px solid #E8E7EA" }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span className="text-xs text-[#8A8D93]">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
