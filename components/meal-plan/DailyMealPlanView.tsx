"use client";

import React, { useState, useEffect } from "react";
import { format, addDays, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import SwapMealModal from "@/components/meal-plan/SwapMealModal";
import Button from "@/components/ui/Button";
import { MenuEntry, RecipeDTO } from "@/types";

interface DailyMealPlanViewProps {
  initialMenus: MenuEntry[];
  initialDate: string;
  mealPlanStartDate?: string | null;
  initialLoggedRecipeIds?: string[];
  initialMealRatings?: Record<string, number>;
  initialDailyCalorieTarget?: number | null;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const MEAL_ORDER = ["Breakfast", "Lunch", "Snack", "Dinner"] as const;
const MEAL_TIMES: Record<string, string> = {
  Breakfast: "8am",
  Lunch:     "12pm",
  Snack:     "3pm",
  Dinner:    "7pm",
};

function roleBadge(dishTypeName?: string | null): { label: string; bg: string; text: string } | null {
  const n = (dishTypeName ?? "").toLowerCase();
  if (n === "complete meal")     return { label: "Complete meal", bg: "bg-[#dcfce7]", text: "text-[#15803d]" };
  if (n === "veggie side dish")  return { label: "Veggie side",   bg: "bg-[#d1fae5]", text: "text-[#059669]" };
  if (n === "starchy side dish") return { label: "Starchy side",  bg: "bg-[#fef3c7]", text: "text-[#b45309]" };
  if (n === "fruity side dish")  return { label: "Fruity side",   bg: "bg-[#fef9c3]", text: "text-[#a16207]" };
  if (n === "dessert")           return { label: "Dessert",        bg: "bg-[#fce7f3]", text: "text-[#be185d]" };
  if (n === "beverage")          return { label: "Beverage",       bg: "bg-[#eff6ff]", text: "text-[#1d4ed8]" };
  if (n === "main dish" || n === "main course" || n === "side dish" || n === "salad" || n === "soup")
    return { label: "Main", bg: "bg-[#dcfce7]", text: "text-[#15803d]" };
  return null;
}

function CaloriePill({ total, completed }: { total: number; completed: number }) {
  return (
    <div className="flex items-center gap-1.5 bg-white border border-[#c8e6cc] rounded-full px-3 py-1.5">
      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
      <span className="text-[10px] font-bold text-forest">{Math.round(completed)}</span>
      <span className="text-[10px] text-[#5a7a5d]">/ {Math.round(total)} kcal</span>
    </div>
  );
}

// ── Inline expanded dish ──────────────────────────────────────────────────────
function InlineDishExpand({
  menu,
  onSwap,
  rating,
  onRate,
}: {
  menu: MenuEntry;
  onSwap: (menuId: string, mealTypeId: string, recipeId: string, calories: number) => void;
  isCompleted: boolean;
  rating: number | null;
  onRate: (recipeId: string, mealTypeName: string, rating: number) => void;
}) {
  const r = menu.recipe;
  const steps = r.description
    ? r.description.split(/\n/).map((s) => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean)
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="pt-3 mt-2 border-t border-[#e8f5e9]">
        {/* Tags */}
        {(r.ethnic?.name || r.dishType?.name) && (
          <div className="flex flex-wrap gap-1 mb-3">
            {r.ethnic?.name && (
              <span className="text-[9px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {r.ethnic.name}
              </span>
            )}
            {r.dishType?.name && (
              <span className="text-[9px] font-semibold bg-[#F0EFF4] text-[#8A8D93] px-2 py-0.5 rounded-full">
                {r.dishType.name}
              </span>
            )}
          </div>
        )}

        {/* Stats + swap */}
        <div className="flex items-center gap-2 mb-3">
          {[
            { label: "Prep",   value: (r.prepTime  ?? 0) > 0 ? `${r.prepTime}m`   : "—" },
            { label: "Cook",   value: (r.cookTime  ?? 0) > 0 ? `${r.cookTime}m`   : "—" },
            { label: "Serves", value: (r.servings  ?? 0) > 0 ? String(r.servings) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#f4faf5] border border-[#c8e6cc] rounded-lg px-2.5 py-1.5 text-center min-w-[52px]">
              <p className="font-bold text-forest text-xs">{value}</p>
              <p className="text-[9px] text-[#86a98a] mt-0.5">{label}</p>
            </div>
          ))}
          <button
            className="ml-auto text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-[#c8e6cc] text-[#5a7a5d] hover:bg-[#f0fdf4] transition-colors"
            onClick={(e) => { e.stopPropagation(); onSwap(menu.id, menu.mealTypeId ?? "", r.id, r.calories ?? 0); }}
          >
            Swap ↔
          </button>
        </div>

        {/* Nutrition tiles */}
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {[
            { label: "Cal",     value: r.calories?.toString(),             sub: "kcal",    color: "bg-[#FFF3E0] text-[#b45309]" },
            { label: "Protein", value: r.protein ? `${r.protein}g` : null, sub: "protein", color: "bg-primary/10 text-primary"   },
            { label: "Carbs",   value: r.carbs   ? `${r.carbs}g`   : null, sub: "carbs",   color: "bg-success/10 text-success"   },
            { label: "Fat",     value: r.fat     ? `${r.fat}g`     : null, sub: "fat",     color: "bg-[#F3F2FF] text-[#8A8D93]"  },
          ].map(({ label, value, sub, color }) =>
            value ? (
              <div key={label} className={`${color} rounded-xl p-2 text-center`}>
                <p className="font-bold text-xs leading-none">{value}</p>
                <p className="text-[8px] mt-1 opacity-70">{sub}</p>
              </div>
            ) : null
          )}
        </div>

        {/* Ingredients */}
        {r.ingredients?.length > 0 && (
          <div className="mb-3">
            <p className="text-[9px] font-bold text-[#8A8D93] uppercase tracking-widest mb-2">Ingredients</p>
            <ul className="space-y-1.5">
              {r.ingredients.map((ri) => (
                <li key={ri.ingredientId} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-forest font-medium">
                    <span className="w-1 h-1 rounded-full bg-primary/40 shrink-0" />
                    {ri.ingredient.name}
                  </span>
                  {ri.quantity && (
                    <span className="text-[10px] text-[#8A8D93]">
                      {ri.quantity}{(ri.unit ?? ri.ingredient.unit) ? ` ${ri.unit ?? ri.ingredient.unit}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Steps */}
        {steps.length > 0 && (
          <div className="mb-3">
            <p className="text-[9px] font-bold text-[#8A8D93] uppercase tracking-widest mb-2">Steps</p>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-xs text-forest leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Tags */}
        {r.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {r.tags.map((tag) => (
              <span key={tag} className="text-[9px] font-medium text-[#8A8D93] bg-[#F7F6FB] px-2 py-0.5 rounded-full">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Rating */}
        <div className="flex gap-2 pb-1">
          <button
            onClick={(e) => { e.stopPropagation(); onRate(r.id, menu.mealType?.name ?? "Meal", -1); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-semibold text-xs transition-all ${
              rating === -1 ? "bg-red-500 text-white" : "bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
            }`}
          >
            <span>👎</span> {rating === -1 ? "Not for me!" : "Not for me"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRate(r.id, menu.mealType?.name ?? "Meal", 1); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-semibold text-xs transition-all ${
              rating === 1 ? "bg-emerald-500 text-white" : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            <span>👍</span> {rating === 1 ? "Loved it!" : "Loved it"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DailyMealPlanView({
  initialMenus,
  initialDate,
  mealPlanStartDate,
  initialLoggedRecipeIds = [],
  initialMealRatings = {},
  initialDailyCalorieTarget = null,
}: DailyMealPlanViewProps) {
  const [date, setDate]                 = useState(() => parseLocalDate(initialDate));
  const [menus, setMenus]               = useState(initialMenus);
  const [loggedRecipeIds, setLoggedRecipeIds] = useState<string[]>(initialLoggedRecipeIds);
  const [mealRatings, setMealRatings]   = useState<Record<string, number>>(initialMealRatings);
  const [loading, setLoading]           = useState(false);
  const [startDate, setStartDate]       = useState(mealPlanStartDate ? new Date(mealPlanStartDate) : null);
  const [settingStart, setSettingStart] = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState<number | null>(initialDailyCalorieTarget);
  const [swapModal, setSwapModal]       = useState<{
    menuId: string; mealTypeId: string; recipeId: string; calories: number;
  } | null>(null);

  // If the server didn't compute the target (missing profile fields on first render),
  // fetch it client-side so the free calories card always appears.
  useEffect(() => {
    if (dailyCalorieTarget !== null) return;
    const dateStr = format(date, "yyyy-MM-dd");
    fetch(`/api/meal-plan?date=${dateStr}`)
      .then((r) => r.json())
      .then((data) => { if (data.dailyCalorieTarget != null) setDailyCalorieTarget(data.dailyCalorieTarget); })
      .catch(() => {});
  }, []);

  const handleSetStartDate = async () => {
    setSettingStart(true);
    setProfileIncomplete(false);
    try {
      const today = new Date();
      const res = await fetch("/api/meal-plan/start-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: format(today, "yyyy-MM-dd") }),
      });
      if (res.status === 422) { setProfileIncomplete(true); return; }
      const data = await res.json();
      const newStartDate = new Date(data.startDate);
      setStartDate(newStartDate);
      setDate(today);
      const mRes = await fetch(`/api/meal-plan?date=${format(today, "yyyy-MM-dd")}`);
      const mData = await mRes.json();
      setMenus(mData.menus ?? []);
      setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
      setMealRatings(mData.mealRatings ?? {});
      setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
    } finally {
      setSettingStart(false);
    }
  };

  const handleRegenerate = async () => {
    if (!startDate) return;
    setRegenerating(true);
    setSelectedId(null);
    setProfileIncomplete(false);
    try {
      const startStr = format(startDate, "yyyy-MM-dd");
      await fetch("/api/meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startStr }),
      });
      const dateStr = format(date, "yyyy-MM-dd");
      const res = await fetch(`/api/meal-plan?date=${dateStr}`);
      const data = await res.json();
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
      setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
    } finally {
      setRegenerating(false);
    }
  };

  const navigate = async (dir: "prev" | "next") => {
    setSelectedId(null);
    const newDate = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    const dateStr = format(newDate, "yyyy-MM-dd");
    setDate(newDate);
    setLoading(true);
    try {
      const res  = await fetch(`/api/meal-plan?date=${dateStr}`);
      const data = await res.json();
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
      if (data.mealPlanStartDate) setStartDate(new Date(data.mealPlanStartDate));
      setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
    } finally {
      setLoading(false);
    }
  };

  const handleRate = async (recipeId: string, mealTypeName: string, rating: number) => {
    setSelectedId(null);
    const dateStr = format(date, "yyyy-MM-dd");
    const res = await fetch("/api/journal/log-meal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeId, mealTypeName, date: dateStr, rating }),
    });
    const data = await res.json();
    if (data.loggedRecipeIds) setLoggedRecipeIds(data.loggedRecipeIds);
    if (data.mealRatings)     setMealRatings(data.mealRatings);
  };

  const handleSwapped = (menuId: string, newRecipe: RecipeDTO) => {
    setMenus((prev) => prev.map((m) => m.id === menuId ? { ...m, recipe: newRecipe } : m));
    setSelectedId(null);
  };

  const planEnd = startDate ? addDays(startDate, 90) : null;
  const isPastPlanEnd = planEnd ? date > planEnd : false;

  const loggedSet        = new Set(loggedRecipeIds);
  const isAllDone        = menus.length > 0 && menus.every((m) => loggedSet.has(m.recipe.id));
  const completedCount   = menus.filter((m) => loggedSet.has(m.recipe.id)).length;
  const totalCalories    = menus.reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);
  const completedCalories = menus
    .filter((m) => loggedSet.has(m.recipe.id))
    .reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);
  const totalProtein     = menus.reduce((sum, m) => sum + (m.recipe.protein  ?? 0), 0);
  const totalCarbs       = menus.reduce((sum, m) => sum + (m.recipe.carbs    ?? 0), 0);
  const totalFat         = menus.reduce((sum, m) => sum + (m.recipe.fat      ?? 0), 0);
  const consumedProtein  = menus.filter((m) => loggedSet.has(m.recipe.id)).reduce((sum, m) => sum + (m.recipe.protein  ?? 0), 0);
  const consumedCarbs    = menus.filter((m) => loggedSet.has(m.recipe.id)).reduce((sum, m) => sum + (m.recipe.carbs    ?? 0), 0);
  const consumedFat      = menus.filter((m) => loggedSet.has(m.recipe.id)).reduce((sum, m) => sum + (m.recipe.fat      ?? 0), 0);
  const budgetCalories = dailyCalorieTarget ?? totalCalories;
  const freeCalories   = dailyCalorieTarget ? Math.max(0, dailyCalorieTarget - totalCalories) : 0;
  const calPct  = budgetCalories > 0 ? Math.min(100, (completedCalories / budgetCalories) * 100) : 0;
  const protPct = totalProtein  > 0 ? Math.min(100, (consumedProtein   / totalProtein)  * 100) : 0;
  const carbPct = totalCarbs    > 0 ? Math.min(100, (consumedCarbs     / totalCarbs)    * 100) : 0;
  const fatPct  = totalFat      > 0 ? Math.min(100, (consumedFat       / totalFat)      * 100) : 0;

  const mealGroups = MEAL_ORDER
    .map((name) => ({
      name,
      time:    MEAL_TIMES[name] ?? "",
      isLunch: name === "Lunch",
      dishes:  menus.filter((m) => m.mealType?.name === name),
    }))
    .filter((g) => g.dishes.length > 0);

  return (
    <div className="flex gap-6 items-start">
      <style>{`
        @keyframes mp-bar { from { width: 0%; } }
        .mp-bar { animation: mp-bar 0.9s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
      <div className="flex-1 min-w-0">
      {profileIncomplete && (
        <div className="bg-error/10 border border-error/20 rounded-2xl p-4 mb-4 text-sm text-error">
          Complete your health profile before generating a meal plan.{" "}
          <a href="/profile" className="underline font-semibold">Go to Profile →</a>
        </div>
      )}

      {/* Date nav + calorie pill */}
      <div className="flex items-center mb-6">
        <button
          onClick={() => navigate("prev")}
          className="w-9 h-9 rounded-xl border border-[#c8e6cc] flex items-center justify-center hover:bg-[#f0fdf4] transition-colors text-forest shrink-0"
        >‹</button>
        <p className="flex-1 text-center font-semibold text-forest text-lg">{format(date, "EEEE, MMMM d")}</p>
        <button
          onClick={() => navigate("next")}
          className="w-9 h-9 rounded-xl border border-[#c8e6cc] flex items-center justify-center hover:bg-[#f0fdf4] transition-colors text-forest shrink-0"
        >›</button>
      </div>

      {/* Completion banner */}
      {menus.length > 0 && (
        <div
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 mb-5 text-sm font-medium transition-all ${
            isAllDone
              ? "bg-[#dcfce7] border border-[#86efac] text-[#1e3422]"
              : "bg-[#f4faf5] border border-[#c8e6cc] text-[#5a7a5d]"
          }`}
        >
          <div className="flex-1">
            {isAllDone ? (
              <span className="font-semibold">All meals done for today — great job!</span>
            ) : (
              <span>
                {completedCount}/{menus.length} meals logged
                {completedCount === 0 ? " — log your meals to mark this day complete" : " — almost there!"}
              </span>
            )}
          </div>
          {!isAllDone && menus.length > 0 && (
            <div className="flex gap-1">
              {menus.map((m) => (
                <div
                  key={m.id}
                  className={`w-2 h-2 rounded-full ${loggedSet.has(m.recipe.id) ? "bg-primary" : "bg-[#c8e6cc]"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* No start date */}
      {!startDate && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-6 text-center mb-6">
          <p className="text-navy font-semibold mb-2">Set your meal plan start date</p>
          <p className="text-[#8A8D93] text-sm mb-4">We&apos;ll generate a personalized 35-day meal plan starting today.</p>
          <Button loading={settingStart} onClick={handleSetStartDate}>Start Meal Plan Today</Button>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div className="text-center py-12 text-[#5a7a5d]">Loading…</div>
      ) : menus.length === 0 ? (
        <div className="text-center py-12 text-[#5a7a5d]">
          {isPastPlanEnd ? (
            <>
              <p className="font-semibold text-[#0d1f10]">Your 35-day plan has ended.</p>
              <p className="mt-2 text-sm">Start a new 35-day plan from today.</p>
              <Button
                loading={settingStart}
                onClick={handleSetStartDate}
                className="mt-4 mx-auto"
              >
                Start new plan
              </Button>
            </>
          ) : (
            <>
              <p>No meal plan for this day.</p>
              {startDate && (
                <>
                  <p className="mt-2 text-sm">Regenerate your full 35-day plan.</p>
                  <Button
                    loading={regenerating}
                    onClick={handleRegenerate}
                    className="mt-4 mx-auto"
                  >
                    Generate meal plan
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <div>
          {/* Timeline */}
          <div
            className="grid gap-0 bg-[#f4faf5] rounded-2xl p-4"
            style={{ gridTemplateColumns: "40px 24px 1fr" }}
          >
            {mealGroups.map((group, idx) => {
              const isLast = idx === mealGroups.length - 1;
              return (
                <React.Fragment key={group.name}>
                  {/* Time label */}
                  <div className="text-right pr-1 pt-[10px]">
                    <span className="text-[9px] font-semibold text-[#86a98a]">{group.time}</span>
                  </div>

                  {/* Spine */}
                  <div className="flex flex-col items-center">
                    <div
                      className="mt-[10px] w-2.5 h-2.5 rounded-full bg-primary border-2 border-white shrink-0 z-10"
                      style={{ boxShadow: "0 0 0 1px #4ade80" }}
                    />
                    {!isLast && (
                      <div className="flex-1 w-0.5 bg-gradient-to-b from-primary to-[#86efac]" />
                    )}
                  </div>

                  {/* Meal card */}
                  <div className={`pl-2 ${isLast ? "pb-0" : "pb-2.5"}`}>
                    <div
                      className={
                        group.isLunch
                          ? "bg-white border-[1.5px] border-primary rounded-xl overflow-hidden shadow-[0_2px_14px_rgba(74,222,128,.12)]"
                          : "bg-white border border-[#c8e6cc] rounded-xl overflow-hidden"
                      }
                    >
                      {/* Card header */}
                      <div
                        className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#e8f5e9] ${
                          group.isLunch ? "bg-[#f0fdf4]" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-bold text-primary uppercase tracking-[.08em]">
                            {group.name}
                          </span>
                          {group.isLunch && (
                            <span className="text-[8px] font-bold bg-primary text-forest px-1.5 py-0.5 rounded-full">
                              Biggest meal
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-[#5a7a5d]">
                          {Math.round(group.dishes.reduce((s, m) => s + (m.recipe.calories ?? 0), 0))} kcal
                        </span>
                      </div>

                      {/* Dish rows */}
                      <div className="px-3.5 py-2.5 flex flex-col">
                        {group.dishes.map((menu, dIdx) => {
                          const badge       = roleBadge(menu.recipe.dishType?.name);
                          const isCompleted = loggedSet.has(menu.recipe.id);
                          const isMainDish  = dIdx === 0;
                          const isSelected  = selectedId === menu.id;
                          return (
                            <React.Fragment key={menu.id}>
                              {dIdx > 0 && <div className="h-px bg-[#e8f5e9] my-2" />}

                              {/* Dish row */}
                              <div
                                className={`flex items-center justify-between gap-2 cursor-pointer rounded-lg transition-colors ${
                                  isSelected ? "-mx-1.5 px-1.5 py-0.5 bg-[#f0fdf4]" : ""
                                }`}
                                onClick={() => setSelectedId(isSelected ? null : menu.id)}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className={`text-forest truncate ${isMainDish ? "text-[11px] font-semibold" : "text-[10px] font-medium"}`}>
                                    {menu.recipe.name}
                                    {isCompleted && <span className="ml-1.5 text-primary text-[9px] font-bold">✓</span>}
                                  </p>
                                  <p className="text-[9px] text-[#5a7a5d] mt-0.5">
                                    {[
                                      menu.recipe.calories ? `${menu.recipe.calories} kcal` : null,
                                      menu.recipe.protein  ? `${menu.recipe.protein}g protein` : null,
                                    ].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {badge && (
                                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                                      {badge.label}
                                    </span>
                                  )}
                                  <span
                                    className="text-[#86a98a] text-[11px] transition-transform duration-200 select-none"
                                    style={{ display: "inline-block", transform: isSelected ? "rotate(90deg)" : "rotate(0deg)" }}
                                  >
                                    ›
                                  </span>
                                </div>
                              </div>

                              {/* Inline expansion */}
                              <AnimatePresence>
                                {isSelected && (
                                  <InlineDishExpand
                                    key={`expand-${menu.id}`}
                                    menu={menu}
                                    onSwap={(menuId, mealTypeId, recipeId, calories) =>
                                      setSwapModal({ menuId, mealTypeId, recipeId, calories })
                                    }
                                    isCompleted={isCompleted}
                                    rating={mealRatings[menu.recipe.id] ?? null}
                                    onRate={handleRate}
                                  />
                                )}
                              </AnimatePresence>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* Free calories card */}
          {freeCalories > 0 && (
            <div className="mt-3 border-2 border-dashed border-[#c8e6cc] rounded-xl px-4 py-3 flex items-center gap-3 bg-[#f4faf5]">
              <div className="w-8 h-8 rounded-full bg-white border border-[#c8e6cc] flex items-center justify-center text-sm font-bold text-primary shrink-0">
                +
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-forest">
                  {Math.round(freeCalories)} kcal free
                </p>
                <p className="text-[10px] text-[#5a7a5d] mt-0.5">
                  Use on any snack you like — not tracked
                </p>
              </div>
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full shrink-0">
                Flex
              </span>
            </div>
          )}

        </div>
      )}

      {swapModal && (
        <SwapMealModal
          open={!!swapModal}
          onClose={() => setSwapModal(null)}
          menuId={swapModal.menuId}
          mealTypeId={swapModal.mealTypeId}
          currentRecipeId={swapModal.recipeId}
          currentCalories={swapModal.calories}
          onSwapped={handleSwapped}
        />
      )}
      </div>

      {menus.length > 0 && (
        <div className="w-64 shrink-0 sticky top-6">
          <div
            className="rounded-2xl p-5"
            style={{
              background: "#fff",
              boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
            }}
          >
            <p className="text-[9px] tracking-[0.22em] uppercase font-bold text-center mb-2" style={{ color: "#ADBDAD" }}>
              Today&apos;s calories
            </p>
            <div className="text-center mb-5">
              <span className="text-5xl font-black tracking-tight tabular-nums leading-none" style={{ color: "#4ade80" }}>
                {Math.round(completedCalories)}
              </span>
              <span className="text-xl font-bold mx-1" style={{ color: "#C8D4C8" }}>/</span>
              <span className="text-xl font-bold tabular-nums" style={{ color: "#0d1f10" }}>
                {Math.round(budgetCalories)}
              </span>
              <span className="text-sm font-medium ml-1.5" style={{ color: "#C8D4C8" }}>kcal</span>
            </div>

            <div className="space-y-3 mb-5">
              {[
                { label: "Protein", consumed: Math.round(consumedProtein), total: Math.round(totalProtein), color: "#60a5fa" },
                { label: "Carbs",   consumed: Math.round(consumedCarbs),   total: Math.round(totalCarbs),   color: "#fb923c" },
                { label: "Fat",     consumed: Math.round(consumedFat),     total: Math.round(totalFat),     color: "#a78bfa" },
              ].map(({ label, consumed, total, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <p className="text-[9px] tracking-[0.18em] uppercase font-bold" style={{ color: "#ADBDAD" }}>{label}</p>
                  <p className="tabular-nums leading-none" style={{ color: "#0d1f10" }}>
                    <span className="text-lg font-bold" style={{ color }}>{consumed}</span>
                    <span className="text-xs font-medium mx-0.5" style={{ color: "#C8D4C8" }}>/</span>
                    <span className="text-base font-bold">{total}</span>
                    <span className="text-xs font-medium ml-0.5" style={{ color }}>g</span>
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              {[
                { label: "Cal",     pct: calPct,  color: "#4ade80" },
                { label: "Protein", pct: protPct, color: "#60a5fa" },
                { label: "Carbs",   pct: carbPct, color: "#fb923c" },
                { label: "Fat",     pct: fatPct,  color: "#a78bfa" },
              ].map(({ label, pct, color }, i) => (
                <div key={label} className="flex items-center gap-2">
                  <p className="text-[9px] w-11 font-bold uppercase tracking-wide flex-shrink-0" style={{ color: "#ADBDAD" }}>{label}</p>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0F4F0" }}>
                    <div
                      className="mp-bar h-full rounded-full"
                      style={{ width: `${pct}%`, background: color, animationDelay: `${200 + i * 60}ms` }}
                    />
                  </div>
                  <p className="text-[9px] font-bold w-7 text-right tabular-nums flex-shrink-0" style={{ color: "#ADBDAD" }}>
                    {Math.round(pct)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
          {startDate && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" loading={regenerating} onClick={handleRegenerate} className="w-full">
                Regenerate plan
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
