"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { RecipeDTO } from "@/types";

interface SwapMealModalProps {
  open: boolean;
  onClose: () => void;
  menuId: string;
  mealTypeId: string;
  currentRecipeId: string;
  onSwapped: (menuId: string, newRecipe: RecipeDTO) => void;
}

export default function SwapMealModal({
  open,
  onClose,
  menuId,
  mealTypeId,
  currentRecipeId,
  onSwapped,
}: SwapMealModalProps) {
  const [alternatives, setAlternatives] = useState<RecipeDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [swappingId, setSwappingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mealTypeId) return;
    setLoading(true);
    fetch(
      `/api/meal-plan/alternatives?mealTypeId=${mealTypeId}&excludeRecipeId=${currentRecipeId}`
    )
      .then((r) => r.json())
      .then((d) => setAlternatives(d.alternatives ?? []))
      .finally(() => setLoading(false));
  }, [open, mealTypeId, currentRecipeId]);

  const handleSelect = async (recipe: RecipeDTO) => {
    setSwappingId(recipe.id);
    try {
      const res = await fetch(`/api/meal-plan/${menuId}/swap`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: recipe.id }),
      });
      if (!res.ok) throw new Error("Swap failed");
      onSwapped(menuId, recipe);
      onClose();
    } finally {
      setSwappingId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Swap Meal" size="md">
      {loading ? (
        <div className="text-center py-8 text-[#8A8D93]">Loading alternatives…</div>
      ) : alternatives.length === 0 ? (
        <div className="text-center py-8 text-[#8A8D93]">No alternatives available.</div>
      ) : (
        <div className="space-y-3">
          {alternatives.map((recipe) => (
            <div
              key={recipe.id}
              className="flex items-center justify-between p-4 rounded-xl border border-[#E8E7EA] hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{recipe.emoji ?? "🍽"}</span>
                <div>
                  <p className="font-medium text-navy">{recipe.name}</p>
                  <p className="text-[#8A8D93] text-xs">
                    {recipe.calories ? `${recipe.calories} kcal` : ""}{" "}
                    {recipe.protein ? `· ${recipe.protein}g protein` : ""}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                loading={swappingId === recipe.id}
                onClick={() => handleSelect(recipe)}
              >
                Select
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
