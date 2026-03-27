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
    const totalDuration = 2200; // ms
    const steps = 60;
    const interval = totalDuration / steps;

    // Ease-out: fast at start, slow at end
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

    // Small delay before starting
    frameRef.current = setTimeout(tick, 300);
    return () => {
      if (frameRef.current) clearTimeout(frameRef.current);
    };
  }, [target]);

  return (
    <span className="tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
      {display.toLocaleString()}
    </span>
  );
}

export default function PredictionView({ data, isPremium }: { data: PredictionData | null; isPremium: boolean }) {
  if (!data) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-navy mb-1">Your Prediction</h1>
          <p className="text-[#8A8D93] text-sm">Based on your profile and weekly goal.</p>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-[#E8E7EA] rounded-2xl mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">Profile incomplete</h2>
          <p className="text-[#8A8D93] text-sm max-w-xs mb-6">
            Fill in your current weight, goal weight, and weekly goal in your profile to see your prediction.
          </p>
          <Link
            href="/profile"
            className="bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-primary-dark transition-colors"
          >
            Complete My Profile
          </Link>
        </div>
        {!isPremium && (
          <div className="mb-8 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 px-6 py-6 sm:px-8 sm:py-7 flex flex-col sm:flex-row items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M12 2l2.09 6.26L20 9.27l-4.91 4.78L16.18 20 12 17.27 7.82 20l1.09-5.95L4 9.27l5.91-.01L12 2z" />
              </svg>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-navy font-bold text-base mb-0.5">
                Start your <span className="text-primary">14-day free trial</span>
              </p>
              <p className="text-[#8A8D93] text-sm">
                Unlock your full meal plan, grocery list, weekly schedule, and more. Cancel anytime.
              </p>
            </div>
            <Link
              href="/pricing"
              className="flex-shrink-0 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 transition-colors whitespace-nowrap"
            >
              Start Free Trial
            </Link>
          </div>
        )}
      </div>
    );
  }

  const { days, currentWeight, goalWeight, weightToLose, weeklyGoal, weightUnit } = data;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-navy mb-1">Your Prediction</h1>
        <p className="text-[#8A8D93] text-sm">Based on your profile and weekly goal.</p>
      </div>

      {/* Hero card */}
      <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-5 sm:p-6 mb-4 text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/8 pointer-events-none" />

        <p className="text-primary text-xs font-semibold uppercase tracking-widest mb-2">
          🎯 Your goal is within reach
        </p>

        <div className="flex items-end justify-center gap-2 mb-0">
          <span className="text-[64px] sm:text-[80px] font-black text-navy leading-none tracking-tight">
            <SpinningNumber target={days} />
          </span>
        </div>
        <p className="text-2xl font-bold text-navy/70 mb-3">days</p>

        <p className="text-[#8A8D93] text-sm max-w-sm mx-auto">
          Stick to your meal plan and you could hit your goal weight in{" "}
          <strong className="text-navy">{days} days</strong>.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div className="bg-white border border-[#E8E7EA] rounded-xl p-3.5">
          <p className="text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-0.5">Current</p>
          <p className="text-xl font-bold text-navy">{currentWeight}<span className="text-xs font-medium text-[#8A8D93] ml-1">{weightUnit}</span></p>
        </div>
        <div className="bg-white border border-[#E8E7EA] rounded-xl p-3.5">
          <p className="text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-0.5">Goal</p>
          <p className="text-xl font-bold text-primary">{goalWeight}<span className="text-xs font-medium text-[#8A8D93] ml-1">{weightUnit}</span></p>
        </div>
        <div className="bg-white border border-[#E8E7EA] rounded-xl p-3.5 col-span-2 sm:col-span-1">
          <p className="text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-0.5">To Lose</p>
          <p className="text-xl font-bold text-navy">{weightToLose.toFixed(1)}<span className="text-xs font-medium text-[#8A8D93] ml-1">{weightUnit}</span></p>
        </div>
      </div>

      {/* Weekly pace */}
      <div className="bg-white border border-[#E8E7EA] rounded-xl p-3.5 flex items-center justify-between mb-3">
        <div>
          <p className="text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-0.5">Weekly pace</p>
          <p className="text-navy font-semibold text-sm">{weeklyGoal} {weightUnit}/week</p>
        </div>
        <div className="text-right">
          <p className="text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-0.5">That&apos;s roughly</p>
          <p className="text-navy font-semibold text-sm">{Math.ceil(days / 7)} weeks</p>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[#BDBDBD] text-xs text-center mb-4 leading-relaxed">
        Estimate only. Results vary with adherence, metabolism, and other individual factors.
      </p>

      {/* 14-day free trial banner */}
      {!isPremium && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5">
          <div className="px-6 py-5 sm:px-8 flex flex-col sm:flex-row items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M12 2l2.09 6.26L20 9.27l-4.91 4.78L16.18 20 12 17.27 7.82 20l1.09-5.95L4 9.27l5.91-.01L12 2z" />
              </svg>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-navy font-bold text-base mb-0.5">
                Start your <span className="text-primary">14-day free trial</span>
              </p>
              <p className="text-[#8A8D93] text-sm">
                Unlock your full meal plan, grocery list, and weekly schedule — everything you need to hit that {days}-day goal.
              </p>
            </div>
            <Link
              href="/pricing"
              className="flex-shrink-0 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 transition-colors whitespace-nowrap"
            >
              Start Free Trial
            </Link>
          </div>
          <div className="bg-primary/10 px-6 sm:px-8 py-2.5 flex items-center gap-2 border-t border-primary/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary flex-shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p className="text-[#8A8D93] text-xs">Cancel anytime · Full access for 14 days</p>
          </div>
        </div>
      )}
    </div>
  );
}
