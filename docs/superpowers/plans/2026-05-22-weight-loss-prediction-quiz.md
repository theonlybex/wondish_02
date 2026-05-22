# Weight Loss Prediction Quiz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static demo card in the "See Your Future" landing section with a 7-question interactive weight-loss prediction quiz that swaps to a result card on completion.

**Architecture:** A new `PredictionQuiz` client component manages a step-based state machine (steps 0–6), renders one question at a time with slide animations, and on completion calculates days using the existing product formula `round((weightToLose / weeklyPace) × 7)`. A thin `lib/prediction-calc.ts` module wraps existing `lib/caloric-engine.ts` for BMR/TDEE/conversion helpers.

**Tech Stack:** React hooks, Next.js App Router, next-intl, Tailwind CSS, TypeScript, existing `lib/caloric-engine.ts`.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `messages/en.json` | Add quiz + result string keys |
| Modify | `messages/es.json` | Spanish translations |
| Modify | `messages/ru.json` | Russian translations |
| Create | `lib/prediction-calc.ts` | `suggestWeeklyPaceLbs` + `calculatePrediction` using caloric-engine |
| Create | `components/PredictionQuiz.tsx` | Full quiz + result client component |
| Modify | `components/PredictionTeaser.tsx` | Remove static card, render `<PredictionQuiz />` |

---

### Task 1: Add i18n strings

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ru.json`

- [ ] **Step 1.1: Add keys to `messages/en.json`**

Inside the existing `"predictionTeaser"` object, after the `"sampleText"` line, add:

```json
"q1": "What's your biological sex?",
"q2": "How old are you?",
"q3": "How tall are you?",
"q4": "What's your current weight?",
"q5": "What's your goal weight?",
"q6": "How active are you?",
"q7": "Weekly weight loss pace?",
"male": "Male",
"female": "Female",
"activitySedentary": "Sedentary",
"activitySedentaryHint": "Desk job, little exercise",
"activityLight": "Lightly active",
"activityLightHint": "1–3 days/week",
"activityModerate": "Moderately active",
"activityModerateHint": "3–5 days/week",
"activityVery": "Very active",
"activityVeryHint": "6–7 days/week",
"pressEnter": "Press Enter ↵ to continue",
"resultTagline": "It's easier to get to your ideal form with our formulas",
"getHealthy": "Get Healthy",
"recalculate": "Recalculate",
"resultEyebrow": "Your Prediction",
"pace": "Pace",
"paceHint": "Suggested based on your profile",
"questionOf": "Question {current} of {total}",
"enterValidAge": "Enter a valid age (10–120)",
"enterValidHeight": "Enter a valid height",
"enterWeight": "Enter your weight",
"goalLessThanCurrent": "Goal weight must be less than current weight",
"enterPace": "Enter a weekly pace"
```

- [ ] **Step 1.2: Add keys to `messages/es.json`** (same location in `"predictionTeaser"`):

```json
"q1": "¿Cuál es tu sexo biológico?",
"q2": "¿Cuántos años tienes?",
"q3": "¿Cuánto mides?",
"q4": "¿Cuál es tu peso actual?",
"q5": "¿Cuál es tu peso objetivo?",
"q6": "¿Qué tan activo eres?",
"q7": "¿Tu ritmo semanal de pérdida de peso?",
"male": "Hombre",
"female": "Mujer",
"activitySedentary": "Sedentario",
"activitySedentaryHint": "Trabajo de escritorio, poco ejercicio",
"activityLight": "Levemente activo",
"activityLightHint": "1–3 días/semana",
"activityModerate": "Moderadamente activo",
"activityModerateHint": "3–5 días/semana",
"activityVery": "Muy activo",
"activityVeryHint": "6–7 días/semana",
"pressEnter": "Presiona Enter ↵ para continuar",
"resultTagline": "Es más fácil llegar a tu forma ideal con nuestras fórmulas",
"getHealthy": "Ponerse Sano",
"recalculate": "Recalcular",
"resultEyebrow": "Tu Predicción",
"pace": "Ritmo",
"paceHint": "Sugerido según tu perfil",
"questionOf": "Pregunta {current} de {total}",
"enterValidAge": "Ingresa una edad válida (10–120)",
"enterValidHeight": "Ingresa una altura válida",
"enterWeight": "Ingresa tu peso",
"goalLessThanCurrent": "El peso objetivo debe ser menor que el actual",
"enterPace": "Ingresa un ritmo semanal"
```

- [ ] **Step 1.3: Add keys to `messages/ru.json`** (same location):

```json
"q1": "Ваш биологический пол?",
"q2": "Сколько вам лет?",
"q3": "Какой у вас рост?",
"q4": "Каков ваш текущий вес?",
"q5": "Каков ваш целевой вес?",
"q6": "Насколько вы активны?",
"q7": "Еженедельный темп снижения веса?",
"male": "Мужской",
"female": "Женский",
"activitySedentary": "Сидячий",
"activitySedentaryHint": "Сидячая работа, мало упражнений",
"activityLight": "Слабо активный",
"activityLightHint": "1–3 дня в неделю",
"activityModerate": "Умеренно активный",
"activityModerateHint": "3–5 дней в неделю",
"activityVery": "Очень активный",
"activityVeryHint": "6–7 дней в неделю",
"pressEnter": "Нажмите Enter ↵ для продолжения",
"resultTagline": "С нашими формулами достичь идеальной формы проще",
"getHealthy": "К здоровью",
"recalculate": "Пересчитать",
"resultEyebrow": "Ваш прогноз",
"pace": "Темп",
"paceHint": "Рекомендовано на основе вашего профиля",
"questionOf": "Вопрос {current} из {total}",
"enterValidAge": "Введите корректный возраст (10–120)",
"enterValidHeight": "Введите корректный рост",
"enterWeight": "Введите ваш вес",
"goalLessThanCurrent": "Целевой вес должен быть меньше текущего",
"enterPace": "Введите еженедельный темп"
```

- [ ] **Step 1.4: Commit**

```bash
git add messages/en.json messages/es.json messages/ru.json
git commit -m "feat: add prediction quiz i18n keys"
```

---

### Task 2: Create `lib/prediction-calc.ts`

**Files:**
- Create: `lib/prediction-calc.ts`

Note: `lib/caloric-engine.ts` already has `calcBMR` (Harris-Benedict), `calcTDEE`, `getActivityMultiplier`, `convertWeight`, `feetInchesToCm`, and `Sex`. Use them — do not reimplement.

- [ ] **Step 2.1: Create the file**

```typescript
import {
  calcBMR,
  calcTDEE,
  getActivityMultiplier,
  convertWeight,
  feetInchesToCm,
} from "./caloric-engine";
import type { Sex } from "./caloric-engine";

export type { Sex };
export type ActivityLevel = 1 | 2 | 3 | 4;
export type WeightUnit = "lbs" | "kg";
export type HeightUnit = "ft" | "cm";

export interface QuizAnswers {
  sex: Sex;
  age: number;
  heightCm: number;
  currentWeightLbs: number;
  goalWeightLbs: number;
  activityLevel: ActivityLevel;
  weeklyPaceLbs: number;
}

export interface PredictionResult {
  days: number;
  currentWeightLbs: number;
  goalWeightLbs: number;
  weeklyPaceLbs: number;
}

export function suggestWeeklyPaceLbs(
  sex: Sex,
  age: number,
  heightCm: number,
  currentWeightLbs: number,
  activityLevel: ActivityLevel
): number {
  const { kg: weightKg } = convertWeight(currentWeightLbs, "lbs");
  const bmr = calcBMR(weightKg, heightCm, age, sex);
  const tdee = calcTDEE(bmr, getActivityMultiplier(activityLevel));
  const dailyDeficit = Math.min(tdee * 0.2, 1000);
  const weeklyLossLbs = (dailyDeficit * 7) / 3500;
  return Math.min(Math.max(Math.round(weeklyLossLbs * 10) / 10, 0.5), 2.0);
}

export function calculatePrediction(answers: QuizAnswers): PredictionResult {
  const weightToLoseLbs = answers.currentWeightLbs - answers.goalWeightLbs;
  const days = Math.round((weightToLoseLbs / answers.weeklyPaceLbs) * 7);
  return {
    days,
    currentWeightLbs: answers.currentWeightLbs,
    goalWeightLbs: answers.goalWeightLbs,
    weeklyPaceLbs: answers.weeklyPaceLbs,
  };
}

export { feetInchesToCm, convertWeight };
```

- [ ] **Step 2.2: Verify build compiles**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add lib/prediction-calc.ts
git commit -m "feat: add prediction calc helpers wrapping caloric-engine"
```

---

### Task 3: Create `components/PredictionQuiz.tsx`

**Files:**
- Create: `components/PredictionQuiz.tsx`

- [ ] **Step 3.1: Create the file**

```tsx
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
```

- [ ] **Step 3.2: Verify build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3.3: Commit**

```bash
git add components/PredictionQuiz.tsx
git commit -m "feat: add PredictionQuiz component"
```

---

### Task 4: Update `components/PredictionTeaser.tsx`

**Files:**
- Modify: `components/PredictionTeaser.tsx`

- [ ] **Step 4.1: Replace file content**

Replace the entire file with:

```tsx
"use client";

import { useTranslations } from "next-intl";
import PredictionQuiz from "./PredictionQuiz";

export default function PredictionTeaser() {
  const t = useTranslations("predictionTeaser");
  return (
    <section className="bg-[#0d1a10] py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 items-center">

        <div>
          <p className="text-[#4ade80] text-sm font-semibold uppercase tracking-widest mb-4">
            {t("eyebrow")}
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] mb-6">
            {t("headline")}
          </h2>
          <p className="text-white/40 text-lg leading-relaxed max-w-md">
            {t("subheadline")}
          </p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <div className="relative w-full max-w-sm">
            <div className="absolute inset-0 rounded-3xl bg-[#4ade80]/10 blur-[60px] pointer-events-none" />
            <PredictionQuiz />
          </div>
        </div>

      </div>
    </section>
  );
}
```

- [ ] **Step 4.2: Build and smoke-test**

```bash
npm run build
```

Expected: clean build.

Then start dev server:

```bash
npm run dev
```

Open the landing page and scroll to "See Your Future". Verify:
1. Right column shows Q1 of 7 (Male / Female chips)
2. Selecting Male or Female slides to Q2 (age input)
3. Filling age + Enter slides to Q3 (height)
4. Height with ft/in toggle, Enter → Q4 (current weight with lbs/kg)
5. Q5 goal weight rejects values ≥ current weight with error message
6. Q6 shows 4 activity chips, selecting one slides to Q7
7. Q7 shows a pre-filled suggested pace
8. Entering pace + Enter swaps to result card with animated days, stats row, white tagline, and green "Get Healthy" button
9. "Recalculate" resets to Q1

- [ ] **Step 4.3: Commit**

```bash
git add components/PredictionTeaser.tsx
git commit -m "feat: wire PredictionQuiz into PredictionTeaser section"
```
