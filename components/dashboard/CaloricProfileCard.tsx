"use client";

import { useEffect, useState } from "react";
import { CaloricProfileDTO } from "@/types";

const BMI_ZONES = [
  { label: "Underweight", max: 18.5, color: "#60A5FA" },
  { label: "Healthy", max: 25, color: "#34D399" },
  { label: "Overweight", max: 30, color: "#FBBF24" },
  { label: "Obese", max: 50, color: "#F87171" },
];

function bmiColor(bmi: number): string {
  for (const z of BMI_ZONES) {
    if (bmi < z.max) return z.color;
  }
  return BMI_ZONES[BMI_ZONES.length - 1].color;
}

function bmiPercent(bmi: number): number {
  // Map BMI 10–45 → 0%–100%
  return Math.min(100, Math.max(0, ((bmi - 10) / 35) * 100));
}

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

export default function CaloricProfileCard() {
  const [profile, setProfile] = useState<CaloricProfileDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patient/caloric-profile");
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Could not load caloric profile");
          return;
        }
        const data = await res.json();
        setProfile(data.profile);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="bg-white h-full p-5 animate-pulse">
        <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="bg-white h-full p-5">
        <h3 className="font-semibold text-[#25293C] mb-2">Caloric Profile</h3>
        <p className="text-sm text-[#9EA8A0]">
          {error || "Complete your profile to see your caloric analysis."}
        </p>
      </div>
    );
  }

  const bmiPct = bmiPercent(profile.cbmi);
  const bmiCol = bmiColor(profile.cbmi);

  // Calorie ring: ratio of daily target vs TDEE for current weight
  const calRatio = profile.tdeeCBW > 0
    ? Math.min(1, profile.dailyCalories / profile.tdeeCBW)
    : 1;
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - calRatio);

  // Weight journey progress
  const totalDelta = Math.abs(profile.cbwKg - profile.tbwKg);
  const progressPct = totalDelta > 0 ? 100 : 100;
  const isLosing = (profile.wtl ?? 0) > 0;
  const isGaining = (profile.wtg ?? 0) > 0;
  const journeyLabel = isLosing
    ? `${fmt(profile.wtl, 1)} kg to lose`
    : isGaining
    ? `${fmt(profile.wtg, 1)} kg to gain`
    : "At target weight";

  return (
    <div className="bg-white h-full p-5">
      <style>{`
        @keyframes cp-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cp-ring {
          from { stroke-dashoffset: ${circumference}; }
          to   { stroke-dashoffset: ${dashOffset}; }
        }
        .cp-a { animation: cp-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .cp-ring { animation: cp-ring 1.2s cubic-bezier(0.22, 1, 0.36, 1) both 0.3s; }
      `}</style>

      <h3 className="font-semibold text-[#25293C] mb-3 cp-a">Caloric Profile</h3>

      {/* Top row: Calorie ring + BMI gauge */}
      <div className="flex flex-wrap gap-4 mb-4">
        {/* Calorie ring */}
        <div className="cp-a flex flex-col items-center" style={{ animationDelay: "60ms" }}>
          <div className="relative w-[110px] h-[110px]">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="#F0F0F2"
                strokeWidth="8"
              />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke="#7DB87D"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="cp-ring"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-[#25293C]">
                {Math.round(profile.dailyCalories)}
              </span>
              <span className="text-[10px] text-[#9EA8A0] uppercase tracking-wider">kcal/day</span>
            </div>
          </div>
          <p className="text-xs text-[#9EA8A0] mt-1.5">Daily Target</p>
        </div>

        {/* BMI gauge */}
        <div className="cp-a flex-1 min-w-[180px]" style={{ animationDelay: "120ms" }}>
          <p className="text-xs text-[#9EA8A0] mb-1.5 uppercase tracking-wider">Body Mass Index</p>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-bold" style={{ color: bmiCol }}>
              {fmt(profile.cbmi)}
            </span>
            <span className="text-xs font-medium capitalize" style={{ color: bmiCol }}>
              {profile.cbmiClass}
            </span>
          </div>
          {/* Gauge bar */}
          <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-[#60A5FA] via-[#34D399] via-[60%] to-[#F87171]">
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-md transition-all duration-700"
              style={{ left: `${bmiPct}%`, backgroundColor: bmiCol }}
            />
          </div>
          <div className="flex justify-between mt-1">
            {BMI_ZONES.map((z) => (
              <span key={z.label} className="text-[9px]" style={{ color: z.color }}>{z.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <MetricTile
          label="Current Weight"
          value={`${fmt(profile.cbwKg)} kg`}
          sub={`${fmt(profile.cbwLb)} lb`}
          delay="180ms"
        />
        <MetricTile
          label="Target Weight"
          value={`${fmt(profile.tbwKg)} kg`}
          accent
          delay="220ms"
        />
        <MetricTile
          label="Ideal Weight"
          value={`${fmt(profile.ibwKg)} kg`}
          delay="260ms"
        />
        <MetricTile
          label="BMR (Current)"
          value={`${Math.round(profile.bmrCBW)}`}
          sub="kcal"
          delay="300ms"
        />
        <MetricTile
          label="TDEE (Current)"
          value={`${Math.round(profile.tdeeCBW)}`}
          sub="kcal"
          delay="340ms"
        />
        <MetricTile
          label="Activity Level"
          value={`×${profile.activityMultiplier}`}
          delay="380ms"
        />
      </div>

      {/* Weight journey bar */}
      <div className="cp-a" style={{ animationDelay: "420ms" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#9EA8A0]">Weight Journey</span>
          <span className="text-xs font-medium text-[#25293C]">{journeyLabel}</span>
        </div>
        <div className="h-2 rounded-full bg-[#F0F0F2] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${isLosing || isGaining ? Math.max(5, 100 - (totalDelta / profile.cbwKg) * 100) : progressPct}%`,
              background: isLosing
                ? "linear-gradient(90deg, #7DB87D, #5CA05C)"
                : isGaining
                ? "linear-gradient(90deg, #60A5FA, #3B82F6)"
                : "linear-gradient(90deg, #34D399, #10B981)",
            }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-[#9EA8A0]">{fmt(profile.cbwKg)} kg</span>
          <span className="text-[10px] text-[#9EA8A0]">{fmt(profile.tbwKg)} kg</span>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component ───────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  sub,
  accent,
  delay = "0ms",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  delay?: string;
}) {
  return (
    <div
      className="cp-a rounded-xl px-3 py-2.5 border"
      style={{
        animationDelay: delay,
        borderColor: accent ? "rgba(125,184,125,0.25)" : "#F0F0F2",
        background: accent ? "rgba(125,184,125,0.06)" : "#FAFAFA",
      }}
    >
      <p className="text-[10px] uppercase tracking-wider text-[#9EA8A0] mb-0.5">{label}</p>
      <div className="flex items-baseline gap-1">
        <span
          className="text-lg font-bold"
          style={{ color: accent ? "#5CA05C" : "#25293C" }}
        >
          {value}
        </span>
        {sub && <span className="text-[10px] text-[#9EA8A0]">{sub}</span>}
      </div>
    </div>
  );
}
