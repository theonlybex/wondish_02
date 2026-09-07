"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { RecipeDTO } from "@/types";
import { CUISINES } from "@/lib/cuisines";

interface SwapMealModalProps {
  open: boolean;
  onClose: () => void;
  menuId: string;
  // Kept for API compatibility with the caller; the Clara swap uses the
  // server-side slot (meal type + calories), so these aren't read here.
  mealTypeId: string;
  currentRecipeId: string;
  currentCalories?: number | null;
  onSwapped: (menuId: string, newRecipe: RecipeDTO) => void;
}

export default function SwapMealModal({
  open,
  onClose,
  menuId,
  onSwapped,
}: SwapMealModalProps) {
  const [request, setRequest] = useState("");
  const [cuisine, setCuisine] = useState<string>("Surprise me");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reset the form each time the modal opens for a fresh dish.
  useEffect(() => {
    if (open) {
      setRequest("");
      setCuisine("Surprise me");
      setError("");
      setLoading(false);
    }
  }, [open]);

  const askClara = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/meal-plan/${menuId}/clara-swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: request.trim(), cuisine }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Daily swap limit, unsafe/no result, or Clara unavailable.
        setError(data?.error ?? "Clara couldn't swap that — try rewording your request.");
        return;
      }
      if (data?.recipe) {
        onSwapped(menuId, data.recipe as RecipeDTO);
        onClose();
      } else {
        setError("Clara couldn't swap that — try again.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Swap with Clara" size="md">
      <p className="text-sm mb-4" style={{ color: "#848181" }}>
        What would you like instead? Tell Clara and she&apos;ll cook up a new dish for this slot —
        same meal, your calories and diet respected.
      </p>

      <label htmlFor="swap-request" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">
        Your request <span className="font-normal" style={{ color: "#ABA6A6" }}>(optional)</span>
      </label>
      <textarea
        id="swap-request"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder="e.g. something lighter, high-protein, no dairy, a warm soup…"
        className="w-full px-3.5 py-2.5 rounded-xl border border-[#EAE4CA] bg-white text-[#1E1A1A] text-sm placeholder:text-[#A8A4B5] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all resize-none"
      />

      <p className="text-sm font-medium text-[#1E1A1A] mt-4 mb-1.5">Cuisine</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a cuisine">
        {CUISINES.map((c) => {
          const active = cuisine === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCuisine(c)}
              aria-pressed={active}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                active
                  ? "bg-primary text-white shadow-sm shadow-primary/30"
                  : "bg-[#F3F2FF] text-[#848181] hover:bg-primary/10 hover:text-primary"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="mt-4 bg-error/10 border border-error/20 text-error rounded-xl px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      <div className="mt-6">
        <Button size="lg" loading={loading} onClick={askClara} className="w-full">
          {loading ? "Clara is cooking…" : "Ask Clara for a new dish ✦"}
        </Button>
      </div>
    </Modal>
  );
}
