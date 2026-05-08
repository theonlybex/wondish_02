"use client";

import { useState } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

const MOOD_OPTIONS = [
  { value: "1", emoji: "😞", label: "Bad" },
  { value: "2", emoji: "😐", label: "Meh" },
  { value: "3", emoji: "🙂", label: "Good" },
  { value: "4", emoji: "😄", label: "Great" },
];

const ENERGY_OPTIONS = [
  { value: "1", label: "Very Low", icon: "▁" },
  { value: "2", label: "Low", icon: "▃" },
  { value: "3", label: "Moderate", icon: "▆" },
  { value: "4", label: "High", icon: "█" },
];

const ACTIVITY_OPTIONS = [
  { value: "none", label: "Rest", emoji: "🛋️" },
  { value: "light", label: "Walk", emoji: "🚶" },
  { value: "moderate", label: "Gym", emoji: "🏋️" },
  { value: "intense", label: "Sport", emoji: "🏃" },
];

const STEPS = ["mood", "weight", "energy", "activity", "notes"] as const;
type Step = typeof STEPS[number];

interface QuickJournalLogProps {
  defaultWeightUnit?: string;
}

const STEP_QUESTIONS: Record<Step, string> = {
  mood: "How are you feeling?",
  weight: "What's your weight today?",
  energy: "How's your energy?",
  activity: "Any activity today?",
  notes: "Anything to note?",
};

export default function QuickJournalLog({ defaultWeightUnit = "lbs" }: QuickJournalLogProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [mood, setMood] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState(defaultWeightUnit);
  const [energyLevel, setEnergyLevel] = useState("");
  const [activityLevel, setActivityLevel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const currentStep = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const advance = (dir = 1) => {
    setDirection(dir);
    setStepIndex((i) => Math.min(Math.max(i + dir, 0), STEPS.length - 1));
  };

  const handleSelect = (setter: (v: string) => void, value: string, current: string) => {
    setter(current === value ? "" : value);
    if (current !== value && stepIndex < STEPS.length - 1) {
      setTimeout(() => advance(1), 280);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      let weightKg: string | null = null;
      if (weight) {
        const w = parseFloat(weight);
        if (!isNaN(w)) {
          weightKg = String(weightUnit === "lbs" ? w * 0.45359237 : w);
        }
      }
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: format(new Date(), "yyyy-MM-dd"),
          mood: mood || null,
          weight: weightKg,
          energyLevel: energyLevel || null,
          activityLevel: activityLevel || null,
          notes: notes || null,
          meals: [],
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setSaved(true);
    } catch {
      setError("Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const hasData = mood || weight || energyLevel || activityLevel || notes;

  if (saved) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-8 gap-3"
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
          style={{ background: "rgba(74,222,128,0.12)", color: "#4ade80" }}
        >
          ✓
        </div>
        <p className="text-sm font-bold text-[#0d1f10]">Entry saved!</p>
        <Link
          href="/journal"
          className="text-[10px] tracking-[0.2em] uppercase font-bold transition-colors"
          style={{ color: "#4ade80" }}
        >
          Full Journal →
        </Link>
      </motion.div>
    );
  }

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <div>
      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-5">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => { setDirection(i > stepIndex ? 1 : -1); setStepIndex(i); }}
            className="transition-all duration-300 rounded-full"
            style={{
              width: i === stepIndex ? 18 : 6,
              height: 6,
              background: i < stepIndex ? "#4ade80" : i === stepIndex ? "#0d1f10" : "#E2EAE2",
            }}
          />
        ))}
        <span
          className="ml-auto text-[9px] tracking-[0.2em] uppercase font-bold"
          style={{ color: "#ADBDAD" }}
        >
          {stepIndex + 1}/{STEPS.length}
        </span>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={currentStep}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <p
            className="text-base font-bold mb-4 leading-snug"
            style={{ color: "#0d1f10" }}
          >
            {STEP_QUESTIONS[currentStep]}
          </p>

          {/* Step content */}
          {currentStep === "mood" && (
            <div className="flex gap-2">
              {MOOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(setMood, opt.value, mood)}
                  className="flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all text-2xl cursor-pointer"
                  style={{
                    borderColor: mood === opt.value ? "#4ade80" : "#F0F4F0",
                    background: mood === opt.value ? "rgba(74,222,128,0.08)" : "#fff",
                    transform: mood === opt.value ? "scale(1.06)" : "scale(1)",
                  }}
                >
                  {opt.emoji}
                  <span
                    className="text-[9px] font-bold tracking-wide uppercase"
                    style={{ color: mood === opt.value ? "#0d1f10" : "#ADBDAD" }}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {currentStep === "weight" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  autoFocus
                  className="flex-1 px-4 py-3 rounded-xl border-2 border-[#F0F4F0] bg-white text-lg text-[#0d1f10] font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                  placeholder={weightUnit === "lbs" ? "150" : "70"}
                />
                <div className="flex flex-col rounded-xl overflow-hidden border-2 border-[#F0F4F0]">
                  {(["lbs", "kg"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setWeightUnit(u)}
                      className="px-3 py-2 text-xs font-bold transition-colors"
                      style={{
                        background: weightUnit === u ? "#0d1f10" : "#fff",
                        color: weightUnit === u ? "#fff" : "#ADBDAD",
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {currentStep === "energy" && (
            <div className="grid grid-cols-2 gap-2">
              {ENERGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(setEnergyLevel, opt.value, energyLevel)}
                  className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border-2 transition-all cursor-pointer"
                  style={{
                    borderColor: energyLevel === opt.value ? "#60a5fa" : "#F0F4F0",
                    background: energyLevel === opt.value ? "rgba(96,165,250,0.08)" : "#fff",
                  }}
                >
                  <span
                    className="text-base font-black tabular-nums leading-none"
                    style={{ color: energyLevel === opt.value ? "#60a5fa" : "#C8D4C8" }}
                  >
                    {opt.icon}
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: energyLevel === opt.value ? "#0d1f10" : "#9EA8A0" }}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {currentStep === "activity" && (
            <div className="grid grid-cols-2 gap-2">
              {ACTIVITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(setActivityLevel, opt.value, activityLevel)}
                  className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border-2 transition-all cursor-pointer"
                  style={{
                    borderColor: activityLevel === opt.value ? "#fb923c" : "#F0F4F0",
                    background: activityLevel === opt.value ? "rgba(251,146,60,0.08)" : "#fff",
                  }}
                >
                  <span className="text-lg">{opt.emoji}</span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: activityLevel === opt.value ? "#0d1f10" : "#9EA8A0" }}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {currentStep === "notes" && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              autoFocus
              className="w-full px-4 py-3 rounded-xl border-2 border-[#F0F4F0] bg-white text-sm text-[#0d1f10] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none"
              placeholder="How was your day…"
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center gap-2 mt-5">
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={() => advance(-1)}
            className="px-3.5 py-2 rounded-xl border-2 border-[#F0F4F0] text-xs font-bold transition-colors hover:border-[#C8D4C8]"
            style={{ color: "#9EA8A0" }}
          >
            ← Back
          </button>
        )}

        {!isLast ? (
          <button
            type="button"
            onClick={() => advance(1)}
            className="ml-auto px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: "#F0F4F0", color: "#9EA8A0" }}
          >
            Skip →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasData || saving}
            className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={
              hasData && !saving
                ? { background: "#0d1f10", color: "#4ade80", cursor: "pointer" }
                : { background: "#F0F4F0", color: "#C8D4C8", cursor: "not-allowed" }
            }
          >
            {saving ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              "Save Entry"
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs font-medium text-red-500">{error}</p>
      )}
    </div>
  );
}
