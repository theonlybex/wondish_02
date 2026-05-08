"use client";

import { useState } from "react";
import { format } from "date-fns";

const MOOD_OPTIONS = [
  { value: "1", emoji: "😞", label: "Bad" },
  { value: "2", emoji: "😐", label: "Meh" },
  { value: "3", emoji: "🙂", label: "Good" },
  { value: "4", emoji: "😄", label: "Great" },
];

const ENERGY_OPTIONS = [
  { value: "1", label: "Very Low" },
  { value: "2", label: "Low" },
  { value: "3", label: "Moderate" },
  { value: "4", label: "High" },
];

const ACTIVITY_OPTIONS = [
  { value: "none", label: "No Activity" },
  { value: "light", label: "Light (walk)" },
  { value: "moderate", label: "Moderate (gym)" },
  { value: "intense", label: "Intense (sport)" },
];

interface QuickJournalLogProps {
  defaultWeightUnit?: string;
}

export default function QuickJournalLog({ defaultWeightUnit = "lbs" }: QuickJournalLogProps) {
  const [mood, setMood] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState(defaultWeightUnit);
  const [energyLevel, setEnergyLevel] = useState("");
  const [activityLevel, setActivityLevel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      // Convert weight to kg for storage if user entered in lbs
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

      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch {
      setError("Could not save journal entry.");
    } finally {
      setSaving(false);
    }
  };

  const hasData = mood || weight || energyLevel || activityLevel || notes;

  return (
    <div className="space-y-5">
      <style>{`
        @keyframes qj-pop {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        .qj-pop { animation: qj-pop 0.3s cubic-bezier(0.34,1.56,0.64,1); }
      `}</style>

      {/* Mood */}
      <div>
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2.5"
           style={{ color: "#ADBDAD" }}>
          How are you feeling?
        </p>
        <div className="flex gap-2.5">
          {MOOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMood(mood === opt.value ? "" : opt.value)}
              className={`flex flex-col items-center gap-1 px-3.5 py-2.5 rounded-xl border-2 transition-all text-2xl cursor-pointer ${
                mood === opt.value
                  ? "border-primary bg-primary/10 qj-pop"
                  : "border-[#F0F4F0] hover:border-primary/30 bg-white"
              }`}
            >
              {opt.emoji}
              <span className="text-[10px]" style={{ color: mood === opt.value ? "#0d1f10" : "#ADBDAD" }}>
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Weight */}
      <div>
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2.5"
           style={{ color: "#ADBDAD" }}>
          Today&apos;s Weight
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-28 px-3.5 py-2.5 rounded-xl border-2 border-[#F0F4F0] bg-white text-sm text-[#0d1f10] font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
            placeholder={weightUnit === "lbs" ? "150" : "70"}
          />
          <div className="flex rounded-lg overflow-hidden border border-[#F0F4F0]">
            {(["lbs", "kg"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setWeightUnit(u)}
                className={`px-3 py-2 text-xs font-bold transition-colors ${
                  weightUnit === u
                    ? "bg-primary text-white"
                    : "bg-white text-[#ADBDAD] hover:text-[#0d1f10]"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Energy Level */}
      <div>
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2.5"
           style={{ color: "#ADBDAD" }}>
          Energy Level
        </p>
        <div className="flex flex-wrap gap-2">
          {ENERGY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEnergyLevel(energyLevel === opt.value ? "" : opt.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                energyLevel === opt.value
                  ? "bg-primary text-white shadow-sm"
                  : "bg-[#F6F8F6] text-[#ADBDAD] hover:text-[#0d1f10] hover:bg-[#EEF2EE]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity */}
      <div>
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2.5"
           style={{ color: "#ADBDAD" }}>
          Physical Activity
        </p>
        <div className="flex flex-wrap gap-2">
          {ACTIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setActivityLevel(activityLevel === opt.value ? "" : opt.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                activityLevel === opt.value
                  ? "bg-primary text-white shadow-sm"
                  : "bg-[#F6F8F6] text-[#ADBDAD] hover:text-[#0d1f10] hover:bg-[#EEF2EE]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2.5"
           style={{ color: "#ADBDAD" }}>
          Notes
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[#F0F4F0] bg-white text-sm text-[#0d1f10] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none"
          placeholder="How was your day?"
        />
      </div>

      {/* Save button + feedback */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasData || saving}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            hasData && !saving
              ? "bg-primary hover:bg-primary-dark text-[#0a1509] shadow-sm cursor-pointer"
              : "bg-[#F0F4F0] text-[#C8D4C8] cursor-not-allowed"
          }`}
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
        {saved && (
          <span className="text-xs font-medium" style={{ color: "#4ade80" }}>
            ✓ Saved
          </span>
        )}
        {error && (
          <span className="text-xs font-medium text-red-500">{error}</span>
        )}
      </div>
    </div>
  );
}
