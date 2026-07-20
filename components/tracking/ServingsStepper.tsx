"use client";

// Quarter-serving stepper shared by MealLogModal and AddToLogButton.
// Matches the repo's flat bordered-control idiom (QuickJournalLog inputs).

const STEP = 0.25;
const MIN = 0.25;
const MAX = 50;

function clampServings(v: number): number {
  const snapped = Math.round(v / STEP) * STEP;
  return Math.min(MAX, Math.max(MIN, snapped));
}

interface ServingsStepperProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

export default function ServingsStepper({
  value,
  onChange,
  disabled,
  size = "md",
}: ServingsStepperProps) {
  const btn =
    size === "sm"
      ? "w-7 h-8 text-sm"
      : "w-9 h-10 text-base";
  const valueCls =
    size === "sm"
      ? "min-w-[38px] text-xs"
      : "min-w-[48px] text-sm";

  const step = (dir: 1 | -1) => onChange(clampServings(value + dir * STEP));

  return (
    <div
      role="group"
      aria-label="Servings"
      className="inline-flex items-stretch rounded-xl border border-[#EAE4CA] bg-white overflow-hidden"
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled || value <= MIN}
        aria-label="Decrease servings"
        className={`${btn} flex items-center justify-center font-bold text-[#848181] hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
      >
        −
      </button>
      <span
        aria-live="polite"
        className={`${valueCls} flex items-center justify-center font-bold text-[#1E1A1A] tabular-nums border-x border-[#EAE4CA] px-1`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled || value >= MAX}
        aria-label="Increase servings"
        className={`${btn} flex items-center justify-center font-bold text-[#848181] hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
      >
        +
      </button>
    </div>
  );
}
