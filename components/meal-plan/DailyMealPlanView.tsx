"use client";

import React, { useState } from "react";
import { format, addDays, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import MealCard from "@/components/meal-plan/MealCard";
import SwapMealModal from "@/components/meal-plan/SwapMealModal";
import Button from "@/components/ui/Button";
import { MenuEntry, RecipeDTO } from "@/types";
import { getRecipeEmoji } from "@/lib/recipeEmoji";

interface DailyMealPlanViewProps {
  initialMenus: MenuEntry[];
  initialDate: string;
  mealPlanStartDate?: string | null;
  initialLoggedRecipeIds?: string[];
  initialMealRatings?: Record<string, number>;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Meal order and time labels ────────────────────────────────────────────────
const MEAL_ORDER = ["Breakfast", "Lunch", "Snack", "Dinner"] as const;
const MEAL_TIMES: Record<string, string> = {
  Breakfast: "8am",
  Lunch:     "12pm",
  Snack:     "3pm",
  Dinner:    "7pm",
};

// Map dishType name to a role badge
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

// ── Calorie pill ──────────────────────────────────────────────────────────────
function CaloriePill({ total, completed }: { total: number; completed: number }) {
  return (
    <div className="flex items-center gap-1.5 bg-white border border-[#c8e6cc] rounded-full px-3 py-1.5">
      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
      <span className="text-[10px] font-bold text-forest">{Math.round(completed)}</span>
      <span className="text-[10px] text-[#5a7a5d]">/ {Math.round(total)} kcal</span>
    </div>
  );
}

// ── Expanded recipe panel ─────────────────────────────────────────────────────
function ExpandedRecipe({
  menu,
  onClose,
  onSwap,
  isCompleted,
  rating,
  onRate,
}: {
  menu: MenuEntry;
  onClose: () => void;
  onSwap: (menuId: string, mealTypeId: string, recipeId: string, calories: number) => void;
  isCompleted: boolean;
  rating: number | null;
  onRate: (recipeId: string, mealTypeName: string, rating: number) => void;
}) {
  const r = menu.recipe;

  const steps: string[] = r.description
    ? r.description
        .split(/\n/)
        .map((s) => s.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean)
    : [];

  return (
    <motion.div
      className="bg-white border border-[#E8E7EA] rounded-3xl overflow-hidden flex flex-col"
      style={{ minHeight: 480 }}
    >
      {/* Hero header */}
      <div className="bg-gradient-to-br from-primary/10 to-primary/5 px-8 pt-8 pb-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/80 border border-[#E8E7EA] flex items-center justify-center text-[#8A8D93] hover:text-navy hover:bg-white transition-all text-sm font-bold"
        >
          ✕
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
            {menu.mealType?.name}
          </span>
          {r.ethnic?.name && (
            <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {r.ethnic.name}
            </span>
          )}
          {r.dishType?.name && (
            <span className="text-[10px] font-semibold bg-[#F0EFF4] text-[#8A8D93] px-2 py-0.5 rounded-full">
              {r.dishType.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 mt-2">
          <span className="text-6xl">{r.emoji ?? getRecipeEmoji(r.name, r.tags, menu.mealType?.name)}</span>
          <div>
            <h2 className="text-2xl font-bold text-navy leading-tight">{r.name}</h2>
            {steps.length === 0 && r.description && (
              <p className="text-[#8A8D93] text-sm mt-1 leading-relaxed max-w-sm">{r.description}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          {[
            { label: "Prep", value: (r.prepTime ?? 0) > 0 ? `${r.prepTime} min` : "—" },
            { label: "Cook", value: (r.cookTime ?? 0) > 0 ? `${r.cookTime} min` : "—" },
            { label: "Serves", value: (r.servings ?? 0) > 0 ? String(r.servings) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/70 border border-white rounded-xl px-4 py-2 text-center min-w-[72px]">
              <p className="font-bold text-navy text-sm">{value}</p>
              <p className="text-[10px] text-[#8A8D93] mt-0.5">{label}</p>
            </div>
          ))}

          <div className="ml-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSwap(menu.id, menu.mealTypeId ?? "", r.id, r.calories ?? 0)}
            >
              Swap meal
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-6">
        <section>
          <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest mb-3">Nutrition</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Calories", value: r.calories?.toString(), sub: "kcal", color: "bg-[#FFF3E0] text-warning" },
              { label: "Protein", value: r.protein ? `${r.protein}g` : null, sub: "protein", color: "bg-primary/10 text-primary" },
              { label: "Carbs", value: r.carbs ? `${r.carbs}g` : null, sub: "carbs", color: "bg-success/10 text-success" },
              { label: "Fat", value: r.fat ? `${r.fat}g` : null, sub: "fat", color: "bg-[#F3F2FF] text-[#8A8D93]" },
            ].map(({ label, value, sub, color }) =>
              value ? (
                <div key={label} className={`${color} rounded-2xl p-3 text-center`}>
                  <p className="font-bold text-xl leading-none">{value}</p>
                  <p className="text-[11px] mt-1.5 opacity-70">{sub}</p>
                </div>
              ) : null
            )}
          </div>
          {r.fiber && (
            <p className="text-xs text-[#8A8D93] mt-2">+ {r.fiber}g fiber</p>
          )}
        </section>

        <div className="h-px bg-[#E8E7EA]" />

        <section>
          <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest mb-3">Ingredients</p>
          {r.ingredients?.length > 0 ? (
            <ul className="space-y-2.5">
              {r.ingredients.map((ri) => (
                <li key={ri.ingredientId} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-navy font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                    {ri.ingredient.name}
                  </span>
                  {ri.quantity && (
                    <span className="text-xs text-[#8A8D93]">
                      {ri.quantity}{(ri.unit ?? ri.ingredient.unit) ? ` ${ri.unit ?? ri.ingredient.unit}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#8A8D93] italic">No ingredients listed — add them in the admin panel.</p>
          )}
        </section>

        <div className="h-px bg-[#E8E7EA]" />

        <section>
          <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest mb-3">Cooking Steps</p>
          {steps.length > 0 ? (
            <ol className="space-y-4">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-navy leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          ) : (
            <div className="bg-[#F7F6FB] rounded-2xl p-4 text-center">
              <p className="text-sm text-[#8A8D93]">No cooking steps added yet.</p>
              <p className="text-xs text-[#8A8D93] mt-1 opacity-70">Add steps via the admin panel to see them here.</p>
            </div>
          )}
        </section>

        {r.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {r.tags.map((tag) => (
              <span key={tag} className="text-xs font-medium text-[#8A8D93] bg-[#F7F6FB] px-3 py-1 rounded-full">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="pt-2 pb-1">
          <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest mb-2 text-center">
            {isCompleted ? "You rated this meal" : "How was this meal?"}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => onRate(r.id, menu.mealType?.name ?? "Meal", -1)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all ${
                rating === -1
                  ? "bg-red-500 text-white shadow-lg"
                  : "bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
              }`}
              style={rating === -1 ? { boxShadow: "0 4px 14px rgba(239,68,68,0.4)" } : {}}
            >
              <span className="text-lg">👎</span>
              {rating === -1 ? "Not for me!" : "Not for me"}
            </button>
            <button
              onClick={() => onRate(r.id, menu.mealType?.name ?? "Meal", 1)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all ${
                rating === 1
                  ? "bg-emerald-500 text-white shadow-lg"
                  : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              }`}
              style={rating === 1 ? { boxShadow: "0 4px 14px rgba(34,197,94,0.4)" } : {}}
            >
              <span className="text-lg">👍</span>
              {rating === 1 ? "Loved it!" : "Loved it"}
            </button>
          </div>
          {isCompleted && (
            <p className="text-[10px] text-[#8A8D93] text-center mt-2">Tap again to undo</p>
          )}
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
}: DailyMealPlanViewProps) {
  const [date, setDate] = useState(() => parseLocalDate(initialDate));
  const [menus, setMenus] = useState(initialMenus);
  const [loggedRecipeIds, setLoggedRecipeIds] = useState<string[]>(initialLoggedRecipeIds);
  const [mealRatings, setMealRatings] = useState<Record<string, number>>(initialMealRatings);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(mealPlanStartDate ? new Date(mealPlanStartDate) : null);
  const [settingStart, setSettingStart] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [swapModal, setSwapModal] = useState<{
    menuId: string;
    mealTypeId: string;
    recipeId: string;
    calories: number;
  } | null>(null);

  const handleSetStartDate = async () => {
    setSettingStart(true);
    setProfileIncomplete(false);
    try {
      const res = await fetch("/api/meal-plan/start-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: format(new Date(), "yyyy-MM-dd") }),
      });
      const data = await res.json();
      const newStartDate = new Date(data.startDate);
      setStartDate(newStartDate);

      const startStr = format(newStartDate, "yyyy-MM-dd");
      const endStr   = format(addDays(newStartDate, 34), "yyyy-MM-dd");
      const genRes = await fetch("/api/meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startStr, endDate: endStr }),
      });
      if (!genRes.ok) {
        const err = await genRes.json();
        if (err.error === "Profile not complete") { setProfileIncomplete(true); return; }
      }

      const mRes = await fetch(`/api/meal-plan?date=${format(new Date(), "yyyy-MM-dd")}`);
      const mData = await mRes.json();
      setMenus(mData.menus ?? []);
      setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
      setMealRatings(mData.mealRatings ?? {});
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
      const endStr   = format(addDays(startDate, 34), "yyyy-MM-dd");
      const genRes = await fetch("/api/meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startStr, endDate: endStr }),
      });
      if (!genRes.ok) {
        const err = await genRes.json();
        if (err.error === "Profile not complete") { setProfileIncomplete(true); return; }
      }
      const dateStr = format(date, "yyyy-MM-dd");
      const res = await fetch(`/api/meal-plan?date=${dateStr}`);
      const data = await res.json();
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
    } finally {
      setRegenerating(false);
    }
  };

  const navigate = async (dir: "prev" | "next") => {
    setSelectedId(null);
    const newDate  = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    const dateStr  = format(newDate, "yyyy-MM-dd");
    setDate(newDate);
    setLoading(true);
    try {
      const res  = await fetch(`/api/meal-plan?date=${dateStr}`);
      const data = await res.json();
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
    } finally {
      setLoading(false);
    }
  };

  const handleRate = async (recipeId: string, mealTypeName: string, rating: number) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const res = await fetch("/api/journal/log-meal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeId, mealTypeName, date: dateStr, rating }),
    });
    const data = await res.json();
    if (data.loggedRecipeIds) setLoggedRecipeIds(data.loggedRecipeIds);
    if (data.mealRatings) setMealRatings(data.mealRatings);
  };

  const handleSwapped = (menuId: string, newRecipe: RecipeDTO) => {
    setMenus((prev) => prev.map((m) => m.id === menuId ? { ...m, recipe: newRecipe } : m));
    setSelectedId(null);
  };

  const selectedMenu = selectedId ? menus.find((m) => m.id === selectedId) ?? null : null;
  const otherMenus   = selectedMenu ? menus.filter((m) => m.id !== selectedId) : [];

  const loggedSet       = new Set(loggedRecipeIds);
  const isAllDone       = menus.length > 0 && menus.every((m) => loggedSet.has(m.recipe.id));
  const completedCount  = menus.filter((m) => loggedSet.has(m.recipe.id)).length;
  const totalCalories   = menus.reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);
  const completedCalories = menus
    .filter((m) => loggedSet.has(m.recipe.id))
    .reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);

  // Group menus by meal type in display order
  const mealGroups = MEAL_ORDER
    .map((name) => ({
      name,
      time: MEAL_TIMES[name] ?? "",
      isLunch: name === "Lunch",
      dishes: menus.filter((m) => m.mealType?.name === name),
    }))
    .filter((g) => g.dishes.length > 0);

  return (
    <div>
      {/* Profile-incomplete banner */}
      {profileIncomplete && (
        <div className="bg-error/10 border border-error/20 rounded-2xl p-4 mb-4 text-sm text-error">
          Complete your health profile before generating a meal plan.{" "}
          <a href="/profile" className="underline font-semibold">Go to Profile →</a>
        </div>
      )}

      {/* Date nav + calorie pill */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("prev")}
          className="w-9 h-9 rounded-xl border border-[#c8e6cc] flex items-center justify-center hover:bg-[#f0fdf4] transition-colors text-forest"
        >‹</button>
        <p className="font-semibold text-forest text-lg">{format(date, "EEEE, MMMM d")}</p>
        <button
          onClick={() => navigate("next")}
          className="w-9 h-9 rounded-xl border border-[#c8e6cc] flex items-center justify-center hover:bg-[#f0fdf4] transition-colors text-forest"
        >›</button>
        <div className="ml-auto">
          {menus.length > 0 && (
            <CaloriePill total={totalCalories} completed={completedCalories} />
          )}
        </div>
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
          No meal plan for this day.
          {startDate && (
            <p className="mt-2 text-sm">This day is outside your current plan.</p>
          )}
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {selectedMenu ? (
            /* ── Expanded layout ── */
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex gap-4 items-start"
            >
              <div className="flex-1 min-w-0">
                <ExpandedRecipe
                  menu={selectedMenu}
                  onClose={() => setSelectedId(null)}
                  onSwap={(menuId, mealTypeId, recipeId, calories) =>
                    setSwapModal({ menuId, mealTypeId, recipeId, calories })
                  }
                  isCompleted={loggedSet.has(selectedMenu.recipe.id)}
                  rating={mealRatings[selectedMenu.recipe.id] ?? null}
                  onRate={handleRate}
                />
              </div>

              <div className="w-48 shrink-0 flex flex-col gap-2.5">
                <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest px-1 mb-1">Other meals</p>
                {otherMenus.map((m) => (
                  <MealCard
                    key={m.id}
                    menuId={m.id}
                    recipe={m.recipe}
                    mealTypeName={m.mealType?.name}
                    compact
                    isCompleted={loggedSet.has(m.recipe.id)}
                    onSelect={() => setSelectedId(m.id)}
                  />
                ))}
              </div>
            </motion.div>
          ) : (
            /* ── Timeline layout ── */
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
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
                              const badge      = roleBadge(menu.recipe.dishType?.name);
                              const isCompleted = loggedSet.has(menu.recipe.id);
                              const isMainDish  = dIdx === 0;
                              return (
                                <React.Fragment key={menu.id}>
                                  {dIdx > 0 && <div className="h-px bg-[#e8f5e9] my-2" />}
                                  <div
                                    className="flex items-center justify-between gap-2 cursor-pointer"
                                    onClick={() => setSelectedId(menu.id)}
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
                                      <button
                                        className="w-[22px] h-[22px] border border-[#c8e6cc] rounded-md flex items-center justify-center text-[#5a7a5d] text-[9px] hover:bg-[#f0fdf4] transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSwapModal({
                                            menuId:     menu.id,
                                            mealTypeId: menu.mealTypeId ?? "",
                                            recipeId:   menu.recipe.id,
                                            calories:   menu.recipe.calories ?? 0,
                                          });
                                        }}
                                      >
                                        ↔
                                      </button>
                                    </div>
                                  </div>
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

              {/* Regenerate button */}
              {startDate && (
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" size="sm" loading={regenerating} onClick={handleRegenerate}>
                    Regenerate plan
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
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
  );
}
