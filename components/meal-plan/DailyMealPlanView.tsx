"use client";

import { useState } from "react";
import { format, addDays, subDays } from "date-fns";
import MealCard from "@/components/meal-plan/MealCard";
import SwapMealModal from "@/components/meal-plan/SwapMealModal";
import Button from "@/components/ui/Button";
import { MenuEntry, RecipeDTO } from "@/types";

interface DailyMealPlanViewProps {
  initialMenus: MenuEntry[];
  initialDate: Date;
  mealPlanStartDate?: string | null;
}

export default function DailyMealPlanView({
  initialMenus,
  initialDate,
  mealPlanStartDate,
}: DailyMealPlanViewProps) {
  const [date, setDate] = useState(initialDate);
  const [menus, setMenus] = useState(initialMenus);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    mealPlanStartDate ? new Date(mealPlanStartDate) : null
  );
  const [settingStart, setSettingStart] = useState(false);

  const [swapModal, setSwapModal] = useState<{
    menuId: string;
    mealTypeId: string;
    recipeId: string;
  } | null>(null);

  const navigate = async (dir: "prev" | "next") => {
    const newDate = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    setDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/meal-plan?date=${format(newDate, "yyyy-MM-dd")}`
      );
      const data = await res.json();
      setMenus(data.menus ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleSetStartDate = async () => {
    setSettingStart(true);
    try {
      const res = await fetch("/api/meal-plan/start-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: format(new Date(), "yyyy-MM-dd") }),
      });
      const data = await res.json();
      setStartDate(new Date(data.startDate));
      // Reload today's menus
      const mRes = await fetch(
        `/api/meal-plan?date=${format(new Date(), "yyyy-MM-dd")}`
      );
      const mData = await mRes.json();
      setMenus(mData.menus ?? []);
    } finally {
      setSettingStart(false);
    }
  };

  const handleSwapped = (menuId: string, newRecipe: RecipeDTO) => {
    setMenus((prev) =>
      prev.map((m) =>
        m.id === menuId ? { ...m, recipe: newRecipe } : m
      )
    );
  };

  return (
    <div>
      {/* Date navigation */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("prev")}
          className="w-9 h-9 rounded-xl border border-[#E8E7EA] flex items-center justify-center hover:bg-[#F3F2FF] transition-colors text-navy"
        >
          ‹
        </button>
        <p className="font-semibold text-navy text-lg">
          {format(date, "EEEE, MMMM d")}
        </p>
        <button
          onClick={() => navigate("next")}
          className="w-9 h-9 rounded-xl border border-[#E8E7EA] flex items-center justify-center hover:bg-[#F3F2FF] transition-colors text-navy"
        >
          ›
        </button>
      </div>

      {/* No start date — CTA */}
      {!startDate && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-6 text-center mb-6">
          <p className="text-navy font-semibold mb-2">Set your meal plan start date</p>
          <p className="text-[#8A8D93] text-sm mb-4">
            We&apos;ll generate a personalized 7-day meal plan starting today.
          </p>
          <Button loading={settingStart} onClick={handleSetStartDate}>
            Start Meal Plan Today
          </Button>
        </div>
      )}

      {/* Meal cards */}
      {loading ? (
        <div className="text-center py-12 text-[#8A8D93]">Loading…</div>
      ) : menus.length === 0 ? (
        <div className="text-center py-12 text-[#8A8D93]">
          No meal plan for this day.
          {startDate && (
            <p className="mt-2 text-sm">
              Meal plan started {format(startDate, "MMMM d")} — this day may be outside the generated range.
            </p>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {menus.map((menu) => (
            <MealCard
              key={menu.id}
              menuId={menu.id}
              recipe={menu.recipe}
              mealTypeName={menu.mealType?.name}
              mealTypeId={menu.mealTypeId ?? undefined}
              onSwap={(menuId, mealTypeId, recipeId) =>
                setSwapModal({ menuId, mealTypeId, recipeId })
              }
            />
          ))}
        </div>
      )}

      {/* Swap modal */}
      {swapModal && (
        <SwapMealModal
          open={!!swapModal}
          onClose={() => setSwapModal(null)}
          menuId={swapModal.menuId}
          mealTypeId={swapModal.mealTypeId}
          currentRecipeId={swapModal.recipeId}
          onSwapped={handleSwapped}
        />
      )}
    </div>
  );
}
