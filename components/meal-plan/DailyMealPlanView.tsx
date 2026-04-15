"use client";

import { useState } from "react";
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

// ── Calories meter ────────────────────────────────────────────────────────────
function CaloriesMeter({
  totalCalories,
  completedCalories,
  completedCount,
  totalCount,
}: {
  totalCalories: number;
  completedCalories: number;
  completedCount: number;
  totalCount: number;
}) {
  const pct = totalCalories > 0 ? Math.min(100, Math.round((completedCalories / totalCalories) * 100)) : 0;
  const isComplete = completedCount === totalCount && totalCount > 0;
  const fillColor = isComplete ? "#34d399" : "#7367F0";

  return (
    <div className="w-16 shrink-0 flex flex-col items-center gap-2 sticky top-6 pt-1">
      <p className="text-[9px] font-bold text-[#8A8D93] uppercase tracking-widest text-center leading-tight">
        Daily<br />Calories
      </p>

      {/* Vertical bar */}
      <div className="relative w-7 h-56 bg-[#F0EFF4] rounded-full overflow-hidden">
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all duration-700"
          style={{
            height: `${pct}%`,
            background: `linear-gradient(to top, ${fillColor}, ${fillColor}99)`,
          }}
        />
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            className="absolute left-0 right-0 h-px bg-white/60"
            style={{ bottom: `${tick}%` }}
          />
        ))}
      </div>

      <div className="text-center">
        <p className={`font-bold text-sm ${isComplete ? "text-emerald-500" : "text-navy"}`}>
          {pct}%
        </p>
        <p className="text-[10px] text-[#8A8D93] mt-0.5">{Math.round(completedCalories)}</p>
        <p className="text-[10px] text-[#8A8D93]">/ {Math.round(totalCalories)}</p>
        <p className="text-[10px] text-[#8A8D93]">kcal</p>
      </div>

      {isComplete && <span className="text-xl">🎯</span>}
    </div>
  );
}

// ── Expanded recipe panel ────────────────────────────────────────────────────
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
  onSwap: (menuId: string, mealTypeId: string, recipeId: string) => void;
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
      {/* ── Hero header ── */}
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
              onClick={() => onSwap(menu.id, menu.mealTypeId ?? "", r.id)}
            >
              Swap meal
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
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

// ── Main component ───────────────────────────────────────────────────────────
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

  const handleRegenerate = async () => {
    setRegenerating(true);
    setSelectedId(null);
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      const endDate = format(addDays(date, 6), "yyyy-MM-dd");
      await fetch("/api/meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: dateStr, endDate }),
      });
      const res = await fetch(`/api/meal-plan?date=${dateStr}`);
      setMenus((await res.json()).menus ?? []);
    } finally {
      setRegenerating(false);
    }
  };

  const [swapModal, setSwapModal] = useState<{
    menuId: string;
    mealTypeId: string;
    recipeId: string;
  } | null>(null);

  const navigate = async (dir: "prev" | "next") => {
    setSelectedId(null);
    const newDate = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    const dateStr = format(newDate, "yyyy-MM-dd");
    setDate(newDate);
    setLoading(true);
    try {
      const res = await fetch(`/api/meal-plan?date=${dateStr}`);
      const data = await res.json();
      let fetched = data.menus ?? [];

      if (fetched.length === 0 && dir === "next") {
        const endDate = format(addDays(newDate, 6), "yyyy-MM-dd");
        await fetch("/api/meal-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: dateStr, endDate }),
        });
        const retry = await fetch(`/api/meal-plan?date=${dateStr}`);
        const retryData = await retry.json();
        fetched = retryData.menus ?? [];
        setLoggedRecipeIds(retryData.loggedRecipeIds ?? []);
        setMealRatings(retryData.mealRatings ?? {});
      } else {
        setLoggedRecipeIds(data.loggedRecipeIds ?? []);
        setMealRatings(data.mealRatings ?? {});
      }

      setMenus(fetched);
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
      const mRes = await fetch(`/api/meal-plan?date=${format(new Date(), "yyyy-MM-dd")}`);
      setMenus((await mRes.json()).menus ?? []);
    } finally {
      setSettingStart(false);
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
  const otherMenus = selectedMenu ? menus.filter((m) => m.id !== selectedId) : [];

  const loggedSet = new Set(loggedRecipeIds);
  const isAllDone = menus.length > 0 && menus.every((m) => loggedSet.has(m.recipe.id));
  const completedCount = menus.filter((m) => loggedSet.has(m.recipe.id)).length;

  // Split menus into main dishes and side dishes
  const mainDishMenus = menus.filter((m) => {
    const dt = m.recipe.dishType?.name?.toLowerCase() ?? "";
    return dt !== "side";
  });
  const sideDishMenus = menus.filter((m) => {
    const dt = m.recipe.dishType?.name?.toLowerCase() ?? "";
    return dt === "side";
  });

  // Calories tracking
  const totalCalories = menus.reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);
  const completedCalories = menus
    .filter((m) => loggedSet.has(m.recipe.id))
    .reduce((sum, m) => sum + (m.recipe.calories ?? 0), 0);

  return (
    <div>
      {/* Date nav */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("prev")}
          className="w-9 h-9 rounded-xl border border-[#E8E7EA] flex items-center justify-center hover:bg-[#F3F2FF] transition-colors text-navy"
        >‹</button>
        <p className="font-semibold text-navy text-lg">{format(date, "EEEE, MMMM d")}</p>
        <button
          onClick={() => navigate("next")}
          className="w-9 h-9 rounded-xl border border-[#E8E7EA] flex items-center justify-center hover:bg-[#F3F2FF] transition-colors text-navy"
        >›</button>
      </div>

      {/* Completion banner */}
      {menus.length > 0 && (
        <div
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 mb-5 text-sm font-medium transition-all ${
            isAllDone
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-[#F8F7FA] border border-[#E8E7EA] text-[#8A8D93]"
          }`}
        >
          <span className="text-xl">{isAllDone ? "🎉" : "🍽"}</span>
          <div className="flex-1">
            {isAllDone ? (
              <span className="font-semibold">All meals done for today — this day is now on your streak!</span>
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
                  className={`w-2 h-2 rounded-full ${loggedSet.has(m.recipe.id) ? "bg-emerald-400" : "bg-[#E8E7EA]"}`}
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
          <p className="text-[#8A8D93] text-sm mb-4">We&apos;ll generate a personalized 7-day meal plan starting today.</p>
          <Button loading={settingStart} onClick={handleSetStartDate}>Start Meal Plan Today</Button>
        </div>
      )}

      {/* Cards + Calories Meter */}
      {loading ? (
        <div className="text-center py-12 text-[#8A8D93]">Loading…</div>
      ) : menus.length === 0 ? (
        <div className="text-center py-12 text-[#8A8D93]">
          No meal plan for this day.
          {startDate && (
            <p className="mt-2 text-sm">Meal plan started {format(startDate, "MMMM d")} — this day may be outside the generated range.</p>
          )}
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          {/* Dishes area */}
          <div className="flex-1 min-w-0">
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
                  {/* Big card */}
                  <div className="flex-1 min-w-0">
                    <ExpandedRecipe
                      menu={selectedMenu}
                      onClose={() => setSelectedId(null)}
                      onSwap={(menuId, mealTypeId, recipeId) => setSwapModal({ menuId, mealTypeId, recipeId })}
                      isCompleted={loggedSet.has(selectedMenu.recipe.id)}
                      rating={mealRatings[selectedMenu.recipe.id] ?? null}
                      onRate={handleRate}
                    />
                  </div>

                  {/* Other meals sidebar */}
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
                /* ── Grid layout ── */
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Main dishes */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {mainDishMenus.map((menu) => (
                      <MealCard
                        key={menu.id}
                        menuId={menu.id}
                        recipe={menu.recipe}
                        mealTypeName={menu.mealType?.name}
                        isCompleted={loggedSet.has(menu.recipe.id)}
                        onSelect={() => setSelectedId(menu.id)}
                      />
                    ))}
                  </div>

                  {/* Side dishes section */}
                  {sideDishMenus.length > 0 && (
                    <div className="mt-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-px flex-1 bg-[#E8E7EA]" />
                        <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest">Side Dishes</p>
                        <div className="h-px flex-1 bg-[#E8E7EA]" />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        {sideDishMenus.map((menu) => (
                          <MealCard
                            key={menu.id}
                            menuId={menu.id}
                            recipe={menu.recipe}
                            mealTypeName={menu.mealType?.name}
                            isCompleted={loggedSet.has(menu.recipe.id)}
                            onSelect={() => setSelectedId(menu.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Calories meter */}
          <CaloriesMeter
            totalCalories={totalCalories}
            completedCalories={completedCalories}
            completedCount={completedCount}
            totalCount={menus.length}
          />
        </div>
      )}

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
