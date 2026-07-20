"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { MacroDay, MacroStats } from "@/types";

interface CalorieTrendLineProps {
  data: MacroDay[]; // stored-snapshot day totals only — never recomputed client-side
  target: MacroStats["target"];
}

// "2026-07-05" is already a local calendar date — parse it with local ctor
// parts so the axis label never shifts a day west of UTC (new Date("YYYY-MM-DD")
// is midnight UTC; same guard as lib/journey.ts fmt).
function labelFor(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return format(new Date(y, m - 1, d), "MMM d");
}

export default function CalorieTrendLine({ data, target }: CalorieTrendLineProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#848181] text-sm">
        No meals logged yet — log a meal to see your calorie trend
      </div>
    );
  }

  const formatted = data.map((d) => ({ ...d, label: labelFor(d.date) }));

  // Y-domain [0, ceil(target × 1.3)], widened to the data max so an
  // over-budget day is never clipped out of the plot.
  const upperBound = (dataMax: number) =>
    Math.max(target ? Math.ceil(target.calories * 1.3) : 0, Math.ceil(dataMax * 1.05));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EAE4CA" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#848181" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, upperBound]}
          tick={{ fontSize: 11, fill: "#848181" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${v}`)}
        />
        <Tooltip
          contentStyle={{ borderRadius: "12px", border: "1px solid #EAE4CA", fontSize: 12 }}
          labelStyle={{ color: "#1E1A1A", fontWeight: 600 }}
          formatter={(value, _name, item) => {
            const incomplete = (item as { payload?: MacroDay })?.payload?.incomplete;
            return [
              `${Math.round(Number(value)).toLocaleString()} kcal${incomplete ? " · incomplete data" : ""}`,
              "Calories",
            ];
          }}
        />
        {target && (
          <ReferenceLine
            y={target.calories}
            stroke="#B75E78"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: `Target ${target.calories.toLocaleString()}`,
              position: "insideTopRight",
              fill: "#B75E78",
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="calories"
          stroke="#812549"
          strokeWidth={2}
          // Incomplete days render as warning-yellow rings (plus the tooltip's
          // "incomplete data" text — never color alone).
          dot={(props) => {
            const { key, cx, cy, payload } = props as {
              key?: string;
              cx?: number;
              cy?: number;
              payload?: MacroDay;
            };
            const incomplete = payload?.incomplete;
            return (
              <circle
                key={key}
                cx={cx}
                cy={cy}
                r={4}
                fill={incomplete ? "#FDC221" : "#812549"}
                stroke={incomplete ? "#DEA402" : "none"}
                strokeWidth={incomplete ? 1.5 : 0}
              />
            );
          }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
