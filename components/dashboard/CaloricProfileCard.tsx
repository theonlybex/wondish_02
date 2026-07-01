"use client";

import { useEffect, useRef, useState } from "react";
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
        .mc-draw { stroke-dasharray: 1; animation: mc-draw-kf 0.3s ease-out both 0.1s; }
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

      {/* Top row: Calorie ring + This Week's Target hero */}
      <div className="flex flex-wrap items-center gap-5 mb-4">
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

        {/* This Week's Target — hero text */}
        <WeeklyTargetHero weeklyTarget={profile.weeklyTarget} cbmiClass={profile.cbmiClass} />
      </div>

      {/* Full-width momentum band — the whole journey rising to goal */}
      <WeeklyTargetBand weeklyTarget={profile.weeklyTarget} />

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <MetricTile
          label="Current Weight"
          value={`${fmt(profile.cbwLb)} lbs`}
          delay="180ms"
        />
        <MetricTile
          label="Target Weight"
          value={`${fmt(kgToLbs(profile.tbwKg))} lbs`}
          accent
          delay="220ms"
        />
        <MetricTile
          label="Ideal Weight"
          value={`${fmt(kgToLbs(profile.ibwKg))} lbs`}
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

// ─── This Week's Target — hero text ──────────────────────────────────────────

function WeeklyTargetHero({
  weeklyTarget,
  cbmiClass,
}: {
  weeklyTarget?: WeeklyTargetDTO;
  cbmiClass: string;
}) {
  const wrap = "cp-a flex-1 min-w-[200px]";
  const eyebrow = "text-[10px] tracking-[0.2em] uppercase font-bold text-[#ABA6A6] mb-2";

  if (!weeklyTarget || !weeklyTarget.hasPlan) {
    return (
      <div className={wrap} style={{ animationDelay: "120ms" }}>
        <p className={eyebrow}>This Week&apos;s Target</p>
        <p className="text-sm text-[#848181] mt-1 leading-relaxed max-w-sm">
          Set your plan start date to see your weekly targets and journey.
        </p>
      </div>
    );
  }

  const {
    direction, thisWeekTargetKg, weeklyDeltaKg, goalWeightKg,
    progressPct, weekIndex, totalWeeks, curve,
  } = weeklyTarget;

  if (direction === "maintain") {
    return (
      <div className={wrap} style={{ animationDelay: "120ms" }}>
        <p className={eyebrow}>This Week&apos;s Target</p>
        <p className="text-4xl font-black text-[#00B9A6] leading-none">Maintain</p>
        <p className="text-sm text-[#848181] mt-2">You&apos;re at a healthy weight — keep it steady.</p>
      </div>
    );
  }

  const reached = progressPct >= 100;
  const targetLbs = kgToLbs(thisWeekTargetKg);
  const deltaLbs = Math.abs(kgToLbs(weeklyDeltaKg));
  const goalLbs = kgToLbs(goalWeightKg);
  const arrow = direction === "gain" ? "▲" : "▼";
  // Plan-only v1: "there" reflects the planned position at the current week
  // (matches the band's "now" marker), not an actual-weight measurement.
  const nowProgress = curve.find((c) => c.week === weekIndex)?.progressPct ?? progressPct;

  return (
    <div
      className={wrap}
      style={{ animationDelay: "120ms" }}
      role="group"
      aria-label={
        reached
          ? `Goal reached. Maintain ${goalLbs.toFixed(1)} pounds.`
          : `This week's target ${targetLbs.toFixed(1)} pounds, ${Math.round(nowProgress)} percent through your plan, week ${weekIndex} of ${totalWeeks}.`
      }
    >
      <p className={eyebrow}>This Week&apos;s Target</p>

      {reached ? (
        <>
          <p className="text-4xl font-black text-[#812549] leading-none">Goal reached 🎉</p>
          <p className="text-sm text-[#848181] mt-2">Maintain {goalLbs.toFixed(1)} lbs</p>
        </>
      ) : (
        <>
          <div className="flex items-end gap-2.5">
            <span className="text-5xl font-black text-[#812549] leading-none tabular-nums">
              {targetLbs.toFixed(1)}
            </span>
            <span className="text-base font-bold text-[#ABA6A6] mb-0.5">lbs</span>
            <span className="inline-flex items-center text-xs font-bold text-[#B75E78] bg-[#B75E78]/10 rounded-full px-2 py-0.5 mb-1">
              {arrow} {deltaLbs.toFixed(1)}/wk
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span className="font-bold text-[#812549]">▲ {Math.round(nowProgress)}% there</span>
            <span className="text-[#D8D2D2]">•</span>
            <span className="text-[#848181]">week {weekIndex} of {totalWeeks}</span>
            <span className="text-[#D8D2D2]">•</span>
            <span className="text-[#848181] capitalize">{cbmiClass}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Full-width Momentum Band (whole-journey rising curve) ────────────────────

function WeeklyTargetBand({ weeklyTarget }: { weeklyTarget?: WeeklyTargetDTO }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth || 760);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!weeklyTarget || !weeklyTarget.hasPlan || weeklyTarget.direction === "maintain") return null;
  const { curve, weekIndex, anchorStartKg, goalWeightKg } = weeklyTarget;
  if (!curve || curve.length < 2) return null;

  const H = 94;
  const PADX = 8;
  const TOP = 12;
  const BOT = 16;

  const minWk = curve[0].week;
  const maxWk = curve[curve.length - 1].week;
  const xFor = (week: number) =>
    maxWk === minWk ? PADX : PADX + ((week - minWk) / (maxWk - minWk)) * (w - 2 * PADX);
  const yFor = (pct: number) => H - BOT - (pct / 100) * (H - TOP - BOT);

  const xy = curve.map((p) => ({ x: xFor(p.week), y: yFor(p.progressPct), week: p.week }));

  // Smooth path via Catmull-Rom → cubic bezier.
  const line = (() => {
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

  const baseline = H - BOT;
  const area = `${line} L ${xy[xy.length - 1].x} ${baseline} L ${xy[0].x} ${baseline} Z`;
  const startPt = xy[0];
  const last = xy[xy.length - 1];
  const nowPt = xy.find((p) => p.week === weekIndex) ?? last;

  const startLbs = kgToLbs(anchorStartKg);
  const goalLbs = kgToLbs(goalWeightKg);

  return (
    <div className="cp-a mb-4" style={{ animationDelay: "180ms" }}>
      <div ref={ref} className="w-full">
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" className="block">
          <defs>
            <linearGradient id="momentumFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B75E78" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#B75E78" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* baseline */}
          <line x1={startPt.x} y1={baseline} x2={last.x} y2={baseline} stroke="#F0EDE0" strokeWidth="1" />

          {/* now vertical guide */}
          <line
            x1={nowPt.x} y1={nowPt.y} x2={nowPt.x} y2={baseline}
            stroke="#B75E78" strokeWidth="1" strokeDasharray="2 3" opacity="0.5"
          />

          {/* area + rising line */}
          <path d={area} fill="url(#momentumFill)" />
          <path
            d={line} fill="none" stroke="#B75E78" strokeWidth="2.5"
            strokeLinecap="round" className="mc-draw" pathLength={1}
          />

          {/* start marker */}
          <circle cx={startPt.x} cy={startPt.y} r="3" fill="#fff" stroke="#B75E78" strokeWidth="1.5" />

          {/* goal flag at the top-right terminus */}
          <g transform={`translate(${last.x}, ${last.y})`}>
            <line x1="0" y1="0" x2="0" y2="-13" stroke="#812549" strokeWidth="1.75" />
            <path d="M0 -13 L8 -10 L0 -7 Z" fill="#812549" />
          </g>

          {/* pulsing "now" marker */}
          <circle cx={nowPt.x} cy={nowPt.y} r="5" fill="#812549" className="mc-pulse" />
          <circle cx={nowPt.x} cy={nowPt.y} r="5" fill="none" stroke="#fff" strokeWidth="1.5" />
        </svg>
      </div>

      {/* start / goal end labels */}
      <div className="flex items-center justify-between mt-1 px-0.5">
        <span className="text-[10px] font-semibold text-[#848181]">
          {startLbs.toFixed(0)} lbs · start
        </span>
        <span className="text-[10px] font-semibold text-[#812549]">
          goal · {goalLbs.toFixed(0)} lbs
        </span>
      </div>
    </div>
  );
}
