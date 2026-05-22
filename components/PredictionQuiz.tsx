"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  suggestWeeklyPaceLbs,
  calculatePrediction,
  feetInchesToCm,
  convertWeight,
} from "@/lib/prediction-calc";
import type {
  PredictionResult,
  ActivityLevel,
  WeightUnit,
  HeightUnit,
  Sex,
} from "@/lib/prediction-calc";

interface AnswerState {
  sex: Sex | null;
  age: string;
  heightFt: string;
  heightIn: string;
  heightCm: string;
  heightUnit: HeightUnit;
  currentWeight: string;
  goalWeight: string;
  weightUnit: WeightUnit;
  activityLevel: ActivityLevel | null;
  weeklyPace: string;
}

const INITIAL: AnswerState = {
  sex: null, age: "", heightFt: "", heightIn: "0", heightCm: "",
  heightUnit: "ft", currentWeight: "", goalWeight: "",
  weightUnit: "lbs", activityLevel: null, weeklyPace: "",
};

const ANIM = `
  @keyframes quiz-slide-in {
    from { opacity: 0; transform: translateX(36px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes result-swap {
    from { opacity: 0; transform: scale(0.97); }
    to   { opacity: 1; transform: scale(1); }
  }
  .quiz-q { animation: quiz-slide-in 0.28s cubic-bezier(0.22,1,0.36,1) both; }
  .res-in { animation: result-swap 0.35s cubic-bezier(0.22,1,0.36,1) both; }
`;

function DaysCounter({ target }: { target: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let s = 0;
    const steps = 55;
    const interval = 2000 / steps;
    const tick = () => {
      s++;
      setCount(Math.round((1 - Math.pow(1 - s / steps, 3)) * target));
      if (s < steps) setTimeout(tick, interval);
      else setCount(target);
    };
    const id = setTimeout(tick, 300);
    return () => clearTimeout(id);
  }, [target]);
  return <span className="tabular-nums">{count}</span>;
}

function UnitToggle({ units, active, onToggle }: {
  units: [string, string];
  active: string;
  onToggle: (u: string) => void;
}) {
  return (
    <div className="flex bg-white/[0.06] border border-white/10 rounded-lg overflow-hidden flex-shrink-0">
      {units.map(u => (
        <button
          key={u}
          type="button"
          onClick={() => onToggle(u)}
          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
            active === u ? "bg-[#4ade80] text-[#0d1a10]" : "text-white/40 hover:text-white/60"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

const ACTIVITIES: { level: ActivityLevel; key: string; hintKey: string }[] = [
  { level: 1, key: "activitySedentary",  hintKey: "activitySedentaryHint" },
  { level: 2, key: "activityLight",      hintKey: "activityLightHint" },
  { level: 3, key: "activityModerate",   hintKey: "activityModerateHint" },
  { level: 4, key: "activityVery",       hintKey: "activityVeryHint" },
];

export default function PredictionQuiz() {
  const t = useTranslations("predictionTeaser");
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep]       = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>(INITIAL);
  const [result, setResult]   = useState<PredictionResult | null>(null);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [step, result]);

  function getHeightCm(s: AnswerState): number {
    return s.heightUnit === "ft"
      ? feetInchesToCm(Number(s.heightFt) || 0, Number(s.heightIn) || 0)
      : Number(s.heightCm);
  }

  function toLbs(value: string, unit: WeightUnit): number {
    const n = Number(value);
    return unit === "lbs" ? n : convertWeight(n, "kg").lb;
  }

  function advance(override?: Partial<AnswerState>) {
    const s = override ? { ...answers, ...override } : answers;
    setError("");

    if (step === 1) {
      const age = Number(s.age);
      if (!s.age || age < 10 || age > 120) { setError(t("enterValidAge")); return; }
    }
    if (step === 2) {
      const cm = getHeightCm(s);
      if (cm < 100 || cm > 250) { setError(t("enterValidHeight")); return; }
    }
    if (step === 3 && (!s.currentWeight || Number(s.currentWeight) <= 0)) {
      setError(t("enterWeight")); return;
    }
    if (step === 4) {
      if (!s.goalWeight || Number(s.goalWeight) <= 0) { setError(t("enterWeight")); return; }
      if (Number(s.goalWeight) >= Number(s.currentWeight)) { setError(t("goalLessThanCurrent")); return; }
    }
    if (step === 6 && (!s.weeklyPace || Number(s.weeklyPace) <= 0)) {
      setError(t("enterPace")); return;
    }

    if (step === 6) {
      setResult(calculatePrediction({
        sex: s.sex!, age: Number(s.age), heightCm: getHeightCm(s),
        currentWeightLbs: toLbs(s.currentWeight, s.weightUnit),
        goalWeightLbs:    toLbs(s.goalWeight, s.weightUnit),
        activityLevel:    s.activityLevel!,
        weeklyPaceLbs:    toLbs(s.weeklyPace, s.weightUnit),
      }));
      setAnswers(s);
      return;
    }

    let next = { ...s };
    if (step === 5 && s.sex && s.activityLevel) {
      const currentLbs = toLbs(s.currentWeight, s.weightUnit);
      const suggested  = suggestWeeklyPaceLbs(s.sex, Number(s.age), getHeightCm(s), currentLbs, s.activityLevel);
      next.weeklyPace  = s.weightUnit === "lbs"
        ? String(suggested)
        : String(Math.round(convertWeight(suggested, "lbs").kg * 10) / 10);
    }

    setAnswers(next);
    setAnimKey(k => k + 1);
    setStep(prev => prev + 1);
  }

  function reset() {
    setAnswers(INITIAL); setResult(null); setError("");
    setAnimKey(k => k + 1); setStep(0);
  }

  const inputCls = "flex-1 bg-white/[0.07] border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder-white/25 outline-none focus:border-[#4ade80]/50 transition-colors";
  const chipCls  = (on: boolean) =>
    `flex flex-col items-start px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
      on ? "bg-[#4ade80]/15 border-[#4ade80]/50 text-[#4ade80]"
         : "bg-white/[0.04] border-white/10 text-white/60 hover:text-white/80 hover:border-white/20"
    }`;

  /* ── Result view ─────────────────────────────────────────────────────────── */
  if (result) {
    const wgt  = (lbs: number) => answers.weightUnit === "lbs"
      ? `${Math.round(lbs)} lbs`
      : `${convertWeight(lbs, "lbs").kg.toFixed(1)} kg`;
    const pace = (lbs: number) => answers.weightUnit === "lbs"
      ? `−${lbs.toFixed(1)}/wk`
      : `−${convertWeight(lbs, "lbs").kg.toFixed(1)}/wk`;

    return (
      <div className="relative bg-white/[0.04] border border-white/10 rounded-3xl p-8 text-center backdrop-blur-sm res-in">
        <style>{ANIM}</style>
        <p className="text-[#4ade80] text-xs font-semibold uppercase tracking-widest mb-4">
          {t("resultEyebrow")}
        </p>
        <div className="mb-1">
          <span className="text-[64px] font-black text-white leading-none">
            <DaysCounter target={result.days} />
          </span>
        </div>
        <p className="text-xl font-bold text-white/40 mb-5">{t("days")}</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { label: t("current"), value: wgt(result.currentWeightLbs) },
            { label: t("goal"),    value: wgt(result.goalWeightLbs) },
            { label: t("pace"),    value: pace(result.weeklyPaceLbs) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/[0.04] rounded-xl p-2.5">
              <p className="text-white/25 text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-white text-sm font-bold">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-white text-sm leading-relaxed mb-5">{t("resultTagline")}</p>
        <Link
          href="/register"
          className="flex items-center justify-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0d1a10] px-6 py-3.5 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-[#4ade80]/20 mb-3"
        >
          {t("getHealthy")}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <button onClick={reset} className="text-white/30 hover:text-white/60 text-xs transition-colors">
          {t("recalculate")}
        </button>
      </div>
    );
  }

  /* ── Quiz view ───────────────────────────────────────────────────────────── */
  return (
    <div className="relative bg-white/[0.04] border border-white/10 rounded-3xl p-8 backdrop-blur-sm">
      <style>{ANIM}</style>

      <div className="h-0.5 bg-white/[0.08] rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-[#4ade80] rounded-full transition-all duration-500"
          style={{ width: `${((step + 1) / 7) * 100}%` }}
        />
      </div>

      <p className="text-white/25 text-xs uppercase tracking-widest mb-3">
        {t("questionOf", { current: step + 1, total: 7 })}
      </p>

      <div key={animKey} className="quiz-q">

        {step === 0 && (
          <div>
            <p className="text-white font-bold text-base mb-5">{t("q1")}</p>
            <div className="flex gap-3">
              {(["male", "female"] as Sex[]).map(s => (
                <button key={s} type="button" onClick={() => advance({ sex: s })}
                  className="flex-1 bg-white/[0.06] hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl py-3.5 text-white/70 hover:text-white font-semibold text-sm transition-all">
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="text-white font-bold text-base mb-5">{t("q2")}</p>
            <input ref={inputRef} type="number" value={answers.age} placeholder="e.g. 28"
              min={10} max={120}
              onChange={e => setAnswers(a => ({ ...a, age: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && advance()}
              className={inputCls} />
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="text-white font-bold text-base mb-5">{t("q3")}</p>
            <div className="flex gap-2 items-center">
              {answers.heightUnit === "ft" ? (
                <>
                  <input ref={inputRef} type="number" value={answers.heightFt} placeholder="ft"
                    min={3} max={8}
                    onChange={e => setAnswers(a => ({ ...a, heightFt: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && advance()}
                    className={`${inputCls} max-w-[90px]`} />
                  <input type="number" value={answers.heightIn} placeholder="in"
                    min={0} max={11}
                    onChange={e => setAnswers(a => ({ ...a, heightIn: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && advance()}
                    className={`${inputCls} max-w-[90px]`} />
                </>
              ) : (
                <input ref={inputRef} type="number" value={answers.heightCm} placeholder="cm"
                  min={100} max={250}
                  onChange={e => setAnswers(a => ({ ...a, heightCm: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && advance()}
                  className={inputCls} />
              )}
              <UnitToggle units={["ft", "cm"]} active={answers.heightUnit}
                onToggle={u => setAnswers(a => ({ ...a, heightUnit: u as HeightUnit }))} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="text-white font-bold text-base mb-5">{t("q4")}</p>
            <div className="flex gap-2">
              <input ref={inputRef} type="number" value={answers.currentWeight}
                placeholder={answers.weightUnit === "lbs" ? "e.g. 185" : "e.g. 84"}
                min={50} max={700}
                onChange={e => setAnswers(a => ({ ...a, currentWeight: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && advance()}
                className={inputCls} />
              <UnitToggle units={["lbs", "kg"]} active={answers.weightUnit}
                onToggle={u => setAnswers(a => ({ ...a, weightUnit: u as WeightUnit }))} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <p className="text-white font-bold text-base mb-5">{t("q5")}</p>
            <div className="flex gap-2">
              <input ref={inputRef} type="number" value={answers.goalWeight}
                placeholder={answers.weightUnit === "lbs" ? "e.g. 160" : "e.g. 73"}
                min={50} max={700}
                onChange={e => setAnswers(a => ({ ...a, goalWeight: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && advance()}
                className={inputCls} />
              <UnitToggle units={["lbs", "kg"]} active={answers.weightUnit}
                onToggle={u => setAnswers(a => ({ ...a, weightUnit: u as WeightUnit }))} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <p className="text-white font-bold text-base mb-4">{t("q6")}</p>
            <div className="grid grid-cols-2 gap-2">
              {ACTIVITIES.map(({ level, key, hintKey }) => (
                <button key={level} type="button"
                  onClick={() => advance({ activityLevel: level })}
                  className={chipCls(answers.activityLevel === level)}>
                  <span>{t(key)}</span>
                  <span className="text-[11px] font-normal opacity-60 mt-0.5">{t(hintKey)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 6 && (
          <div>
            <p className="text-white font-bold text-base mb-1">{t("q7")}</p>
            <p className="text-white/30 text-xs mb-4">{t("paceHint")}</p>
            <div className="flex gap-2">
              <input ref={inputRef} type="number" value={answers.weeklyPace}
                placeholder={answers.weightUnit === "lbs" ? "e.g. 1.5" : "e.g. 0.7"}
                step="0.1" min={0.1} max={5}
                onChange={e => setAnswers(a => ({ ...a, weeklyPace: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && advance()}
                className={inputCls} />
              <UnitToggle units={["lbs", "kg"]} active={answers.weightUnit}
                onToggle={u => setAnswers(a => ({ ...a, weightUnit: u as WeightUnit }))} />
            </div>
          </div>
        )}

      </div>

      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

      {step !== 0 && step !== 5 && (
        <div className="flex items-center gap-2 mt-4">
          <kbd className="bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 text-white/30 text-[10px]">Enter ↵</kbd>
          <span className="text-white/20 text-xs">{t("pressEnter")}</span>
        </div>
      )}
    </div>
  );
}
