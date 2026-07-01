"use client";

import { useEffect, useState } from "react";
import { CaloricProfileDTO } from "@/types";
import type { WeeklyTargetDTO } from "@/types";
import { kgToLbs } from "@/lib/prediction-data";

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
        <h3 className="font-semibold text-[#1E1A1A] mb-2">Caloric Profile</h3>
        <p className="text-sm text-[#848181]">
          {error || "Complete your profile to see your caloric analysis."}
        </p>
      </div>
    );
  }

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
    <div className="bg-white h-full flex flex-col">
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
        @keyframes mc-draw-kf {
          from { stroke-dashoffset: 1; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes mc-pulse-kf {
          0%, 100% { opacity: 1; transform: scale(1); transform-origin: center; }
          50%      { opacity: 0.5; transform: scale(1.45); transform-origin: center; }
        }
        .mc-draw { stroke-dasharray: 1; stroke-dashoffset: 0; animation: mc-draw-kf 0.6s ease-out both 0.2s; }
        .mc-pulse { animation: mc-pulse-kf 2.4s ease-in-out infinite; transform-box: fill-box; }
        @media (prefers-reduced-motion: reduce) {
          .mc-draw, .mc-pulse { animation: none; }
        }
      `}</style>

      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#F5F1DD] flex-shrink-0">
        <div className="w-1 h-4 rounded-full" style={{ background: "#B75E78" }} />
        <h3 className="text-[#1E1A1A] text-sm font-bold">Caloric Profile</h3>
      </div>

      <div className="p-5 flex-1 overflow-auto">

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
                stroke="#B75E78"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="cp-ring"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-[#1E1A1A]">
                {Math.round(profile.dailyCalories)}
              </span>
              <span className="text-[10px] text-[#848181] uppercase tracking-wider">kcal/day</span>
            </div>
          </div>
          <p className="text-xs text-[#848181] mt-1.5">Daily Target</p>
        </div>

        {/* This Week's Target */}
        <WeeklyTargetPanel weeklyTarget={profile.weeklyTarget} cbmiClass={profile.cbmiClass} />
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
          label="Body Fat"
          value={`${fmt(profile.bodyFatPct)}%`}
          delay="380ms"
        />
      </div>

      {/* Weight journey bar */}
      <div className="cp-a" style={{ animationDelay: "420ms" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[#848181]">Weight Journey</span>
          <span className="text-xs font-medium text-[#1E1A1A]">{journeyLabel}</span>
        </div>
        <div className="h-2 rounded-full bg-[#F0F0F2] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${isLosing || isGaining ? Math.max(5, 100 - (totalDelta / profile.cbwKg) * 100) : progressPct}%`,
              background: isLosing
                ? "linear-gradient(90deg, #B75E78, #812549)"
                : isGaining
                ? "linear-gradient(90deg, #60A5FA, #3B82F6)"
                : "linear-gradient(90deg, #00B9A6, #10B981)",
            }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-[#848181]">{fmt(profile.cbwKg)} kg</span>
          <span className="text-[10px] text-[#848181]">{fmt(profile.tbwKg)} kg</span>
        </div>
      </div>

      {/* Glossary */}
      <div className="cp-a mt-3 pt-3 border-t border-[#F0F0F2] flex flex-col gap-1" style={{ animationDelay: "460ms" }}>
        <p className="text-[10px] text-[#CCC6C6] leading-relaxed">
          <span className="font-semibold text-[#848181]">BMR</span> — Basal Metabolic Rate: calories your body burns at complete rest to sustain basic functions.
        </p>
        <p className="text-[10px] text-[#CCC6C6] leading-relaxed">
          <span className="font-semibold text-[#848181]">TDEE</span> — Total Daily Energy Expenditure: your BMR adjusted for activity level, representing total daily calorie burn.
        </p>
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
      <p className="text-[10px] uppercase tracking-wider text-[#848181] mb-0.5">{label}</p>
      <div className="flex items-baseline gap-1">
        <span
          className="text-lg font-bold"
          style={{ color: accent ? "#812549" : "#1E1A1A" }}
        >
          {value}
        </span>
        {sub && <span className="text-[10px] text-[#848181]">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Momentum Curve (rising progress %) ──────────────────────────────────────

function MomentumCurve({
  curve,
  weekIndex,
}: {
  curve: { week: number; progressPct: number }[];
  weekIndex: number;
}) {
  const W = 180;
  const H = 56;
  const PAD = 6;

  // Window to ~7 weeks centered on "now" so dots stay legible.
  let pts = curve;
  if (curve.length > 8) {
    const start = Math.max(0, Math.min(weekIndex - 4, curve.length - 7));
    pts = curve.slice(start, start + 7);
  }
  if (pts.length === 0) return null;

  const minWk = pts[0].week;
  const maxWk = pts[pts.length - 1].week;
  const xFor = (week: number) =>
    maxWk === minWk ? PAD : PAD + ((week - minWk) / (maxWk - minWk)) * (W - 2 * PAD);
  const yFor = (pct: number) => H - PAD - (pct / 100) * (H - 2 * PAD);

  const xy = pts.map((p) => ({ x: xFor(p.week), y: yFor(p.progressPct), week: p.week }));

  // Smooth path via Catmull-Rom → cubic bezier.
  const line = (() => {
    if (xy.length === 1) return `M ${xy[0].x} ${xy[0].y}`;
    let d = `M ${xy[0].x} ${xy[0].y}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[i - 1] ?? xy[i];
      const p1 = xy[i];
      const p2 = xy[i + 1];
      const p3 = xy[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  })();

  const area = `${line} L ${xy[xy.length - 1].x} ${H - PAD} L ${xy[0].x} ${H - PAD} Z`;
  const last = xy[xy.length - 1];
  const nowPt = xy.find((p) => p.week === weekIndex) ?? last;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} aria-hidden="true">
      <defs>
        <linearGradient id="momentumFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B75E78" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#B75E78" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill="url(#momentumFill)" />
      <path
        d={line}
        fill="none"
        stroke="#B75E78"
        strokeWidth="2"
        strokeLinecap="round"
        className="mc-draw"
        pathLength={1}
      />

      {/* Goal flag at the top-right terminus */}
      <g transform={`translate(${last.x}, ${last.y})`}>
        <line x1="0" y1="0" x2="0" y2="-9" stroke="#812549" strokeWidth="1.5" />
        <path d="M0 -9 L6 -7 L0 -5 Z" fill="#812549" />
      </g>

      {/* Pulsing "now" dot */}
      <circle cx={nowPt.x} cy={nowPt.y} r="3.5" fill="#812549" className="mc-pulse" />
    </svg>
  );
}

// ─── Weekly Target Panel ─────────────────────────────────────────────────────

function WeeklyTargetPanel({
  weeklyTarget,
  cbmiClass,
}: {
  weeklyTarget?: WeeklyTargetDTO;
  cbmiClass: string;
}) {
  const wrap = "cp-a flex-1 min-w-[180px]";
  const eyebrow = "text-xs text-[#848181] mb-1.5 uppercase tracking-wider";

  if (!weeklyTarget || !weeklyTarget.hasPlan) {
    return (
      <div className={wrap} style={{ animationDelay: "120ms" }}>
        <p className={eyebrow}>This Week&apos;s Target</p>
        <p className="text-sm text-[#848181] mt-2 leading-relaxed">
          Set your plan start date to see your weekly targets.
        </p>
      </div>
    );
  }

  const { direction, thisWeekTargetKg, weeklyDeltaKg, goalWeightKg, progressPct, weekIndex, totalWeeks } =
    weeklyTarget;

  if (direction === "maintain") {
    return (
      <div className={wrap} style={{ animationDelay: "120ms" }}>
        <p className={eyebrow}>This Week&apos;s Target</p>
        <p className="text-2xl font-bold text-[#00B9A6] mt-1">Maintain</p>
        <p className="text-sm text-[#848181] mt-1">You&apos;re at a healthy weight.</p>
        <p className="text-[10px] text-[#ABA6A6] mt-2 capitalize">{cbmiClass}</p>
      </div>
    );
  }

  const reached = progressPct >= 100;
  const targetLbs = kgToLbs(thisWeekTargetKg);
  const deltaLbs = Math.abs(kgToLbs(weeklyDeltaKg));
  const arrow = direction === "gain" ? "▲" : "▼";

  return (
    <div className={wrap} style={{ animationDelay: "120ms" }}>
      <p className={eyebrow}>This Week&apos;s Target</p>

      {reached ? (
        <>
          <p className="text-2xl font-bold text-[#812549] mt-1">Goal reached</p>
          <p className="text-sm text-[#848181] mt-1">
            Maintain {kgToLbs(goalWeightKg).toFixed(1)} lbs
          </p>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold text-[#812549]">{targetLbs.toFixed(1)}</span>
            <span className="text-xs font-medium text-[#CCC6C6]">lbs</span>
            <span className="text-[11px] font-semibold text-[#B75E78]">
              {arrow} {deltaLbs.toFixed(1)}/wk
            </span>
          </div>

          <div className="mt-2">
            <MomentumCurve curve={weeklyTarget.curve} weekIndex={weekIndex} />
          </div>

          <p className="text-[11px] text-[#848181] mt-1">
            <span className="font-semibold text-[#1E1A1A]">▲ {Math.round(progressPct)}% there</span>
            {" · "}week {weekIndex} of {totalWeeks}
            <span className="text-[#ABA6A6] capitalize"> · {cbmiClass}</span>
          </p>
        </>
      )}
    </div>
  );
}
