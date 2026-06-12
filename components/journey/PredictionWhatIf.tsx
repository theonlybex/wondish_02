"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  computePredictionEstimate,
  fromKg,
  type PredictionProfileInput,
} from "@/lib/prediction-data";

// Slider position (exercise days/week, 0–7) ↔ engine activity level (1–4).
// The defaults are chosen so a round-trip lands on the profile's own level,
// keeping the untouched card identical to the /prediction page.
const daysToLevel = (d: number) => (d <= 0 ? 1 : d <= 3 ? 2 : d <= 5 ? 3 : 4);
const LEVEL_TO_DAYS: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 6 };

function goalDate(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export default function PredictionWhatIf({
  input,
}: {
  input: PredictionProfileInput | null;
}) {
  const defaultDays = LEVEL_TO_DAYS[input?.activityLevel ?? 1] ?? 0;
  const [goalWeight, setGoalWeight] = useState(input?.goalWeight ?? 0);
  const [exerciseDays, setExerciseDays] = useState(defaultDays);

  const estimate = useMemo(
    () =>
      input
        ? computePredictionEstimate(input, {
            goalWeight,
            activityLevel: daysToLevel(exerciseDays),
          })
        : null,
    [input, goalWeight, exerciseDays]
  );

  const cardStyle = {
    boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
  };

  // Profile incomplete, or no weight-loss prediction applies at the profile's
  // own values — show a quiet prompt instead of an empty calculator.
  if (!input || (goalWeight === input.goalWeight && exerciseDays === defaultDays && !estimate)) {
    return (
      <div className="bg-white rounded-2xl p-6 text-center" style={cardStyle}>
        <p className="text-sm font-semibold text-[#1E1A1A] mb-1">No prediction yet</p>
        <p className="text-xs" style={{ color: "#848181" }}>
          {input
            ? "A weight-loss prediction will appear here when your profile shows weight to lose."
            : (
              <>
                Add your weight, goal weight and activity level in your{" "}
                <Link href="/profile" className="text-[#812549] font-semibold hover:underline">
                  profile
                </Link>{" "}
                to see how long your journey will take.
              </>
            )}
        </p>
      </div>
    );
  }

  const unit = input.weightUnit;
  // Goal slider floor: the weight at BMI 18.5 — anything lower isn't healthy.
  const heightCm = input.heightUnit === "in" ? input.heightValue * 2.54 : input.heightValue;
  const heightM2 = (heightCm / 100) ** 2;
  const minGoal = Math.ceil(fromKg(18.5 * heightM2, unit));
  const maxGoal = Math.floor(input.weightValue - 1);
  const changed = goalWeight !== input.goalWeight || exerciseDays !== defaultDays;

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8" style={cardStyle}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
          Your Prediction
        </p>
        {changed && (
          <button
            onClick={() => {
              setGoalWeight(input.goalWeight);
              setExerciseDays(defaultDays);
            }}
            className="text-[11px] font-semibold transition-colors hover:text-[#1E1A1A]"
            style={{ color: "#848181" }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Day count */}
      <div className="text-center mb-7">
        {estimate ? (
          <>
            <p className="font-black tabular-nums leading-none text-[#1E1A1A]" style={{ fontSize: "3.5rem" }}>
              {estimate.days}
              <span className="text-lg font-bold ml-2" style={{ color: "#ABA6A6" }}>days</span>
            </p>
            <p className="text-xs mt-3" style={{ color: "#848181" }}>
              reaching {estimate.goalWeight} {unit} · {goalDate(estimate.days)}
            </p>
          </>
        ) : (
          <>
            <p className="font-black leading-none" style={{ fontSize: "3.5rem", color: "#ABA6A6" }}>—</p>
            <p className="text-xs mt-3" style={{ color: "#848181" }}>
              no prediction for these values
            </p>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="whatif-goal" className="text-xs font-semibold text-[#1E1A1A]">
              Goal weight
            </label>
            <span className="text-xs font-bold tabular-nums" style={{ color: "#812549" }}>
              {goalWeight} {unit}
            </span>
          </div>
          <input
            id="whatif-goal"
            type="range"
            min={Math.min(minGoal, maxGoal)}
            max={maxGoal}
            step={1}
            value={goalWeight}
            onChange={(e) => setGoalWeight(Number(e.target.value))}
            className="w-full h-1.5 cursor-pointer"
            style={{ accentColor: "#812549" }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="whatif-exercise" className="text-xs font-semibold text-[#1E1A1A]">
              Exercise per week
            </label>
            <span className="text-xs font-bold tabular-nums" style={{ color: "#812549" }}>
              {exerciseDays} {exerciseDays === 1 ? "day" : "days"}
            </span>
          </div>
          <input
            id="whatif-exercise"
            type="range"
            min={0}
            max={7}
            step={1}
            value={exerciseDays}
            onChange={(e) => setExerciseDays(Number(e.target.value))}
            className="w-full h-1.5 cursor-pointer"
            style={{ accentColor: "#812549" }}
          />
        </div>
      </div>

      {/* Footer */}
      <p
        className="text-[11px] text-center mt-6 pt-4 border-t tabular-nums"
        style={{ color: "#848181", borderColor: "#F5F1DD" }}
      >
        Current {input.weightValue} {unit}
        {estimate && (
          <>
            {" "}· {estimate.weightToLose} {unit} to go · ~{estimate.weeklyGoal} {unit}/wk
          </>
        )}
      </p>
    </div>
  );
}
