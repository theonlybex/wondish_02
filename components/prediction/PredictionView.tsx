"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface PredictionData {
  days: number;
  currentWeight: number;
  goalWeight: number;
  weightToLose: number;
  weeklyGoal: number;
  weightUnit: string;
}

function SpinningNumber({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = 0;
    const totalDuration = 2200;
    const steps = 60;
    const interval = totalDuration / steps;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    let step = 0;
    const tick = () => {
      step++;
      const progress = easeOut(step / steps);
      current = Math.round(progress * target);
      setDisplay(current);
      if (step < steps) {
        frameRef.current = setTimeout(tick, interval);
      } else {
        setDisplay(target);
      }
    };
    frameRef.current = setTimeout(tick, 300);
    return () => { if (frameRef.current) clearTimeout(frameRef.current); };
  }, [target]);

  return (
    <span className="tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
      {display.toLocaleString()}
    </span>
  );
}

const ANIM = `
  @keyframes ov-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
`;

export default function PredictionView({
  data,
  isPremium,
}: {
  data: PredictionData | null;
  isPremium: boolean;
}) {
  if (!data) {
    return (
      <div className="max-w-2xl mx-auto">
        <style>{ANIM}</style>

        <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#7DB87D" }}>
            Prediction
          </p>
          <h1 className="text-3xl font-bold text-[#0d1f10]">Prediction</h1>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px w-12 bg-primary/40" />
            <p className="text-xs" style={{ color: "#9EA8A0" }}>Based on your profile and weekly goal</p>
          </div>
        </div>

        <div
          className="ov flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl mb-6"
          style={{
            animationDelay: "80ms",
            boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
          }}
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#0d1f10] mb-2">Profile incomplete</h2>
          <p className="text-sm max-w-xs mb-6" style={{ color: "#ADBDAD" }}>
            Fill in your current weight, goal weight, and weekly goal in your profile to see your prediction.
          </p>
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-[#0a1509] px-6 py-3 rounded-xl text-sm font-bold transition-colors"
            style={{ boxShadow: "0 4px 16px rgba(74,222,128,0.2)" }}
          >
            Complete My Profile
          </Link>
        </div>

        {!isPremium && (
          <div
            className="ov relative rounded-2xl p-8 overflow-hidden"
            style={{
              animationDelay: "140ms",
              background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
              boxShadow: "0 8px 32px rgba(13,31,16,0.25)",
            }}
          >
            <div
              className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(74,222,128,0.10) 0%, transparent 65%)", transform: "translate(35%, -35%)" }}
            />
            <div className="relative flex flex-col sm:flex-row items-center gap-6">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M12 2l2.09 6.26L20 9.27l-4.91 4.78L16.18 20 12 17.27 7.82 20l1.09-5.95L4 9.27l5.91-.01L12 2z" />
                </svg>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <p className="text-white font-bold text-base mb-1">
                  Upgrade to <span className="text-primary">Premium</span>
                </p>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
                  Unlock your full meal plan, grocery list, weekly schedule, and more.
                </p>
              </div>
              <Link
                href="/pricing"
                className="flex-shrink-0 bg-primary hover:bg-primary-dark text-[#0a1509] px-6 py-3 rounded-xl text-sm font-bold transition-colors whitespace-nowrap"
                style={{ boxShadow: "0 4px 20px rgba(74,222,128,0.25)" }}
              >
                Get Premium
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  const { days, currentWeight, goalWeight, weightToLose, weeklyGoal, weightUnit } = data;

  const statCards = [
    { label: "Current", value: String(currentWeight), suffix: weightUnit },
    { label: "Goal", value: String(goalWeight), suffix: weightUnit, accent: true },
    { label: "To Lose", value: weightToLose.toFixed(1), suffix: weightUnit },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <style>{ANIM}</style>

      <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#7DB87D" }}>
          Prediction
        </p>
        <h1 className="text-3xl font-bold text-[#0d1f10]">Prediction</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-12 bg-primary/40" />
          <p className="text-xs" style={{ color: "#9EA8A0" }}>Based on your profile and weekly goal</p>
        </div>
      </div>

      {/* Hero countdown */}
      <div
        className="ov relative rounded-2xl overflow-hidden mb-4 text-center"
        style={{
          animationDelay: "80ms",
          background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
          boxShadow: "0 8px 32px rgba(13,31,16,0.25)",
        }}
      >
        <div
          className="absolute top-0 right-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.12) 0%, transparent 65%)", transform: "translate(35%, -35%)" }}
        />
        <div
          className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.06) 0%, transparent 70%)", transform: "translate(-30%, 30%)" }}
        />
        <div className="relative px-8 py-12">
          <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-6" style={{ color: "rgba(74,222,128,0.5)" }}>
            Your goal is within reach
          </p>
          <div className="flex items-end justify-center gap-3 mb-1">
            <span
              className="font-black text-white leading-none tracking-tight"
              style={{ fontSize: "clamp(4rem, 12vw, 6.5rem)" }}
            >
              <SpinningNumber target={days} />
            </span>
          </div>
          <p className="text-2xl font-bold mb-5" style={{ color: "rgba(255,255,255,0.35)" }}>days</p>
          <p className="text-sm max-w-sm mx-auto leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
            Stick to your meal plan and you could reach your goal weight in{" "}
            <span className="text-white font-semibold">{days} days</span>.
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div
        className="ov bg-white rounded-2xl overflow-hidden mb-3"
        style={{
          animationDelay: "140ms",
          boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
        }}
      >
        <div className="grid grid-cols-3">
          {statCards.map((s, i) => (
            <div key={s.label} className={`px-5 py-5 ${i > 0 ? "border-l border-[#E8E7EA]" : ""}`}>
              <p
                className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2"
                style={{ color: "#ADBDAD" }}
              >
                {s.label}
              </p>
              <div className="flex items-baseline gap-1">
                <span
                  className="font-black tabular-nums leading-none"
                  style={{ fontSize: "1.75rem", color: s.accent ? "#4ade80" : "#0d1f10" }}
                >
                  {s.value}
                </span>
                <span className="text-sm font-medium" style={{ color: "#C8D4C8" }}>
                  {s.suffix}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Pace row */}
        <div className="border-t border-[#E8E7EA] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ADBDAD" }}>
              Weekly pace
            </p>
            <p className="text-sm font-bold text-[#0d1f10]">
              {weeklyGoal} {weightUnit}/week
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ADBDAD" }}>
              That&apos;s roughly
            </p>
            <p className="text-sm font-bold text-[#0d1f10]">{Math.ceil(days / 7)} weeks</p>
          </div>
        </div>
      </div>

      <p className="text-center text-xs leading-relaxed mb-6" style={{ color: "#BDBDBD" }}>
        Estimate only. Results vary with adherence, metabolism, and individual factors.
      </p>

      {!isPremium && (
        <div
          className="ov relative rounded-2xl p-8 overflow-hidden"
          style={{
            animationDelay: "200ms",
            background: "linear-gradient(140deg, #0a1509 0%, #162a18 60%, #0d1f10 100%)",
            boxShadow: "0 8px 32px rgba(13,31,16,0.25)",
          }}
        >
          <div
            className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(74,222,128,0.10) 0%, transparent 65%)", transform: "translate(35%, -35%)" }}
          />
          <div className="relative flex flex-col sm:flex-row items-center gap-6">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M12 2l2.09 6.26L20 9.27l-4.91 4.78L16.18 20 12 17.27 7.82 20l1.09-5.95L4 9.27l5.91-.01L12 2z" />
              </svg>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-white font-bold text-base mb-1">
                Upgrade to <span className="text-primary">Premium</span>
              </p>
              <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
                Unlock your full meal plan, grocery list, and weekly schedule — everything you need to hit that {days}-day goal.
              </p>
            </div>
            <Link
              href="/pricing"
              className="flex-shrink-0 bg-primary hover:bg-primary-dark text-[#0a1509] px-6 py-3 rounded-xl text-sm font-bold transition-colors whitespace-nowrap"
              style={{ boxShadow: "0 4px 20px rgba(74,222,128,0.25)" }}
            >
              Get Premium
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
