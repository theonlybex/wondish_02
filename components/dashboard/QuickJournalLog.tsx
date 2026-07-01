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

const STEP_QUESTIONS: Record<Step, string> = {
  mood: "How are you feeling?",
  weight: "What's your weight today?",
  energy: "How's your energy?",
  activity: "Any activity today?",
  notes: "Anything to note?",
};

export default function QuickJournalLog() {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [mood, setMood] = useState("");
  const [weight, setWeight] = useState("");
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
      // Weight is stored in lbs — the client's single display unit.
      let weightLbs: string | null = null;
      if (weight) {
        const w = parseFloat(weight);
        if (!isNaN(w)) weightLbs = String(w);
      }
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: format(new Date(), "yyyy-MM-dd"),
          mood: mood || null,
          weight: weightLbs,
          energyLevel: energyLevel || null,
          activityLevel: activityLevel || null,
          notes: notes || null,
          meals: [],
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setSaved(true);
      // Notify sibling cards (e.g. Caloric Profile) that the weigh-in changed
      // so they can refetch live instead of waiting for a page reload.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("journal:saved"));
      }
    } catch {
      setError("Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const hasData = mood || weight || energyLevel || activityLevel || notes;

  const stepFilled: Record<Step, boolean> = {
    mood: !!mood,
    weight: !!weight,
    energy: !!energyLevel,
    activity: !!activityLevel,
    notes: !!notes,
  };
  const currentFilled = stepFilled[currentStep];

  if (saved) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-8 gap-3"
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
          style={{ background: "rgba(129,37,73,0.12)", color: "#812549" }}
        >
          ✓
        </div>
        <p className="text-sm font-bold text-[#1E1A1A]">Entry saved!</p>
        <Link
          href="/journal"
          className="text-[10px] tracking-[0.2em] uppercase font-bold transition-colors"
          style={{ color: "#812549" }}
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
    <div className="flex flex-col h-full">
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
              background: i < stepIndex ? "#812549" : i === stepIndex ? "#1E1A1A" : "#EAE4CA",
            }}
          />
        ))}
        <span
          className="ml-auto text-[9px] tracking-[0.2em] uppercase font-bold"
          style={{ color: "#ABA6A6" }}
        >
          {stepIndex + 1}/{STEPS.length}
        </span>
      </div>

      {/* Question — flex-1 lets this region grow so the navigation row is
          always pinned to the bottom of the card, regardless of step height. */}
      <div className="flex-1 min-h-[136px] overflow-x-clip">
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
            style={{ color: "#1E1A1A" }}
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
                  className="flex-1 min-w-0 flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all text-2xl cursor-pointer"
                  style={{
                    borderColor: mood === opt.value ? "#812549" : "#F5F1DD",
                    background: mood === opt.value ? "rgba(129,37,73,0.08)" : "#fff",
                    transform: mood === opt.value ? "scale(1.06)" : "scale(1)",
                  }}
                >
                  {opt.emoji}
                  <span
                    className="text-[9px] font-bold tracking-wide uppercase"
                    style={{ color: mood === opt.value ? "#1E1A1A" : "#ABA6A6" }}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      advance(1);
                    }
                  }}
                  autoFocus
                  className="flex-1 min-w-0 px-4 py-3 rounded-xl border-2 border-[#F5F1DD] bg-white text-lg text-[#1E1A1A] font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                  placeholder="150"
                />
                <span
                  className="px-4 py-3 rounded-xl border-2 border-[#F5F1DD] text-sm font-bold"
                  style={{ background: "#FAFAFA", color: "#848181" }}
                >
                  lbs
                </span>
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
                    borderColor: energyLevel === opt.value ? "#60a5fa" : "#F5F1DD",
                    background: energyLevel === opt.value ? "rgba(96,165,250,0.08)" : "#fff",
                  }}
                >
                  <span
                    className="text-base font-black tabular-nums leading-none"
                    style={{ color: energyLevel === opt.value ? "#60a5fa" : "#CCC6C6" }}
                  >
                    {opt.icon}
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: energyLevel === opt.value ? "#1E1A1A" : "#848181" }}
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
                    borderColor: activityLevel === opt.value ? "#fb923c" : "#F5F1DD",
                    background: activityLevel === opt.value ? "rgba(251,146,60,0.08)" : "#fff",
                  }}
                >
                  <span className="text-lg">{opt.emoji}</span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: activityLevel === opt.value ? "#1E1A1A" : "#848181" }}
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
              className="w-full px-4 py-3 rounded-xl border-2 border-[#F5F1DD] bg-white text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none"
              placeholder="How was your day…"
            />
          )}
        </motion.div>
      </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2 mt-5">
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={() => advance(-1)}
            className="px-3.5 py-2 rounded-xl border-2 border-[#F5F1DD] text-xs font-bold transition-colors hover:border-[#CCC6C6]"
            style={{ color: "#848181" }}
          >
            ← Back
          </button>
        )}

        {!isLast ? (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => advance(1)}
              className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
              style={{ background: "#F5F1DD", color: "#848181", cursor: "pointer" }}
            >
              Skip →
            </button>
            <button
              type="button"
              onClick={() => advance(1)}
              disabled={!currentFilled}
              className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
              style={
                currentFilled
                  ? { background: "#812549", color: "#fff", cursor: "pointer" }
                  : { background: "#F5F1DD", color: "#CCC6C6", cursor: "not-allowed" }
              }
            >
              Next →
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasData || saving}
            className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={
              hasData && !saving
                ? { background: "#812549", color: "#fff", cursor: "pointer" }
                : { background: "#F5F1DD", color: "#CCC6C6", cursor: "not-allowed" }
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
