"use client";

import { useState } from "react";
import { format } from "date-fns";
import DatePicker from "@/components/ui/DatePicker";
import Button from "@/components/ui/Button";
import MealRatingCard from "@/components/journal/MealRatingCard";
import { MenuEntry } from "@/types";

interface JournalMealState {
  mealType: string;
  recipeId?: string;
  recipeName?: string;
  rating: number;
  skipped: boolean;
  preparation: string;
}

interface JournalFormProps {
  initialDate: Date;
  initialMenus: MenuEntry[];
  initialEntry?: Record<string, unknown> | null;
}

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

export default function JournalForm({
  initialDate,
  initialMenus,
  initialEntry,
}: JournalFormProps) {
  const [date, setDate] = useState(initialDate);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [mood, setMood] = useState((initialEntry?.mood as string) ?? "");
  const [weight, setWeight] = useState(
    initialEntry?.weight ? String(initialEntry.weight) : ""
  );
  const [energyLevel, setEnergyLevel] = useState(
    (initialEntry?.energyLevel as string) ?? ""
  );
  const [activityLevel, setActivityLevel] = useState(
    (initialEntry?.activityLevel as string) ?? ""
  );
  const [notes, setNotes] = useState((initialEntry?.notes as string) ?? "");

  const initialMeals: JournalMealState[] = initialMenus.map((menu) => {
    const existing = (
      initialEntry?.meals as {
        mealType: string;
        recipeId?: string;
        rating?: number;
        skipped?: boolean;
        preparation?: string;
      }[]
    )?.find((m) => m.mealType === menu.mealType?.name);
    return {
      mealType: menu.mealType?.name ?? "",
      recipeId: menu.recipe.id,
      recipeName: menu.recipe.name,
      rating: existing?.rating ?? 0,
      skipped: existing?.skipped ?? false,
      preparation: existing?.preparation ?? "",
    };
  });

  const [meals, setMeals] = useState<JournalMealState[]>(initialMeals);

  const updateMeal = (idx: number, updates: Partial<JournalMealState>) => {
    setMeals((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...updates } : m))
    );
  };

  const loadEntry = async (d: Date) => {
    const res = await fetch(`/api/journal?date=${format(d, "yyyy-MM-dd")}`);
    const data = await res.json();
    if (data.entry) {
      setMood(data.entry.mood ?? "");
      setWeight(data.entry.weight ? String(data.entry.weight) : "");
      setEnergyLevel(data.entry.energyLevel ?? "");
      setActivityLevel(data.entry.activityLevel ?? "");
      setNotes(data.entry.notes ?? "");
    }
  };

  const handleDateChange = async (d: Date) => {
    setDate(d);
    await loadEntry(d);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: format(date, "yyyy-MM-dd"),
          mood: mood || null,
          weight: weight || null,
          energyLevel: energyLevel || null,
          activityLevel: activityLevel || null,
          notes: notes || null,
          meals: meals.map((m) => ({
            mealType: m.mealType,
            recipeId: m.recipeId,
            rating: m.rating || null,
            skipped: m.skipped,
            preparation: m.skipped ? "skipped" : m.preparation || null,
          })),
        }),
      });

      if (!res.ok) throw new Error("Failed to save journal");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {error && (
        <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="bg-success/10 border border-success/20 text-success rounded-xl px-4 py-3 text-sm font-medium">
          Journal saved!
        </div>
      )}

      {/* Date */}
      <DatePicker
        label="Date"
        value={date}
        onChange={handleDateChange}
        disabled={(d) => d > new Date()}
      />

      {/* Meal ratings */}
      {meals.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-navy mb-4">Meals</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {meals.map((meal, idx) => (
              <MealRatingCard
                key={`${meal.mealType}-${idx}`}
                mealType={meal.mealType}
                recipeName={meal.recipeName}
                rating={meal.rating}
                skipped={meal.skipped}
                preparation={meal.preparation}
                onRatingChange={(r) => updateMeal(idx, { rating: r })}
                onSkipToggle={() =>
                  updateMeal(idx, {
                    skipped: !meal.skipped,
                    preparation: !meal.skipped ? "skipped" : "",
                  })
                }
                onPreparationChange={(p) => updateMeal(idx, { preparation: p })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Health metrics */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Health Metrics</h2>
        <div className="space-y-5">
          {/* Mood */}
          <div>
            <p className="text-sm font-medium text-[#25293C] mb-2">Mood</p>
            <div className="flex gap-3">
              {MOOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMood(opt.value)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all text-2xl ${
                    mood === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-[#E8E7EA] hover:border-primary/30"
                  }`}
                >
                  {opt.emoji}
                  <span className="text-xs text-[#8A8D93]">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Energy */}
          <div>
            <p className="text-sm font-medium text-[#25293C] mb-2">Energy Level</p>
            <div className="flex flex-wrap gap-2">
              {ENERGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEnergyLevel(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    energyLevel === opt.value
                      ? "bg-primary text-white"
                      : "bg-[#F3F2FF] text-[#8A8D93] hover:bg-primary/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div>
            <p className="text-sm font-medium text-[#25293C] mb-2">Activity Level</p>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setActivityLevel(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    activityLevel === opt.value
                      ? "bg-primary text-white"
                      : "bg-[#F3F2FF] text-[#8A8D93] hover:bg-primary/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Weight */}
          <div>
            <label className="text-sm font-medium text-[#25293C] block mb-1.5">
              Weight (kg)
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-32 px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#25293C] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              placeholder="70.5"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-[#25293C] block mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#25293C] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all resize-none"
              placeholder="How was your day?"
            />
          </div>
        </div>
      </section>

      <Button type="submit" size="lg" loading={loading}>
        Save Journal
      </Button>
    </form>
  );
}
