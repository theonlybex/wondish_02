"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

// 30-day mean symptom severity (0 none … 3 severe) from the daily journal.
// Rendered only for users whose conditions have tracking items (the page
// decides); shows an empty state until something is logged.
export default function SymptomTrendCard() {
  const [days, setDays] = useState<{ date: string; score: number; items: number }[] | null>(null);
  useEffect(() => {
    fetch("/api/journal/symptoms?days=30")
      .then((r) => (r.ok ? r.json() : { days: [] }))
      .then((d) => setDays(Array.isArray(d.days) ? d.days : []))
      .catch(() => setDays([]));
  }, []);

  const data = (days ?? []).map((d) => ({ ...d, label: format(new Date(d.date + "T12:00:00"), "MMM d") }));

  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#1E1A1A]">Symptoms</h3>
        <span className="text-[10px]" style={{ color: "#848181" }}>mean severity · 0 none – 3 severe</span>
      </div>
      {days === null ? (
        <div className="h-48 flex items-center justify-center text-sm" style={{ color: "#848181" }}>Loading…</div>
      ) : data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-center px-4" style={{ color: "#848181" }}>
          No symptoms logged yet — the daily journal has a Symptoms step for your conditions.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAE4CA" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#848181" }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} tick={{ fontSize: 11, fill: "#848181" }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v) => [Number(v ?? 0).toFixed(2), "severity"]} labelStyle={{ fontSize: 12 }} contentStyle={{ borderRadius: 12, borderColor: "#EAE4CA", fontSize: 12 }} />
            <Line type="monotone" dataKey="score" stroke="#812549" strokeWidth={2} dot={{ r: 3, fill: "#812549" }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
