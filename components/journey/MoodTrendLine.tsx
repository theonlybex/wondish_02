"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";

interface MoodTrendLineProps {
  data: { date: string; mood: number }[];
}

export default function MoodTrendLine({ data }: MoodTrendLineProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#8A8D93] text-sm">
        No mood data yet
      </div>
    );
  }

  const formatted = data.map((d) => ({
    ...d,
    label: format(new Date(d.date), "MMM d"),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8E7EA" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#8A8D93" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[1, 4]}
          ticks={[1, 2, 3, 4]}
          tick={{ fontSize: 11, fill: "#8A8D93" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => ["", "😞", "😐", "🙂", "😄"][v] ?? v}
        />
        <Tooltip
          contentStyle={{ borderRadius: "12px", border: "1px solid #E8E7EA", fontSize: 12 }}
          formatter={(v) => [["😞", "😞", "😐", "🙂", "😄"][Number(v)] ?? String(v), "Mood"]}
          labelStyle={{ color: "#25293C", fontWeight: 600 }}
        />
        <Line
          type="monotone"
          dataKey="mood"
          stroke="#7367F0"
          strokeWidth={2}
          dot={{ r: 4, fill: "#7367F0", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
