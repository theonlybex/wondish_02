"use client";

import { useState } from "react";
import { format, addDays, subDays } from "date-fns";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import MealCard from "@/components/meal-plan/MealCard";
import SwapMealModal from "@/components/meal-plan/SwapMealModal";
import Button from "@/components/ui/Button";
import { MenuEntry, RecipeDTO } from "@/types";

interface DailyMealPlanViewProps {
  initialMenus: MenuEntry[];
  initialDate: string;
  mealPlanStartDate?: string | null;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Expanded recipe panel ────────────────────────────────────────────────────
function ExpandedRecipe({
  menu,
  onClose,
  onSwap,
}: {
  menu: MenuEntry;
  onClose: () => void;
  onSwap: (menuId: string, mealTypeId: string, recipeId: string) => void;
}) {
  const r = menu.recipe;

  // Placeholder cooking steps (seed data has none — shown as example)
  const steps: string[] = [];

  return (
    <motion.div
      layoutId={`card-${r.id}`}
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

        <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
          {menu.mealType?.name}
        </span>

        <div className="flex items-center gap-4 mt-2">
          <span className="text-6xl">{r.emoji ?? "🍽"}</span>
          <div>
            <h2 className="text-2xl font-bold text-navy leading-tight">{r.name}</h2>
            {r.description && (
              <p className="text-[#8A8D93] text-sm mt-1 leading-relaxed max-w-sm">{r.description}</p>
            )}
          </div>
        </div>

        {/* time row */}
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

        {/* Nutrition */}
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

        {/* Ingredients */}
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

        {/* Cooking steps */}
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

        {/* Tags */}
        {r.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {r.tags.map((tag) => (
              <span key={tag} className="text-xs font-medium text-[#8A8D93] bg-[#F7F6FB] px-3 py-1 rounded-full">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function DailyMealPlanView({
  initialMenus,
  initialDate,
  mealPlanStartDate,
}: DailyMealPlanViewProps) {
  const [date, setDate] = useState(() => parseLocalDate(initialDate));
  const [menus, setMenus] = useState(initialMenus);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(mealPlanStartDate ? new Date(mealPlanStartDate) : null);
  const [settingStart, setSettingStart] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        fetched = (await retry.json()).menus ?? [];
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

  const handleSwapped = (menuId: string, newRecipe: RecipeDTO) => {
    setMenus((prev) => prev.map((m) => m.id === menuId ? { ...m, recipe: newRecipe } : m));
    setSelectedId(null);
  };

  const selectedMenu = selectedId ? menus.find((m) => m.id === selectedId) ?? null : null;
  const sideMenus = selectedMenu ? menus.filter((m) => m.id !== selectedId) : [];

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

      {/* No start date */}
      {!startDate && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-6 text-center mb-6">
          <p className="text-navy font-semibold mb-2">Set your meal plan start date</p>
          <p className="text-[#8A8D93] text-sm mb-4">We&apos;ll generate a personalized 7-day meal plan starting today.</p>
          <Button loading={settingStart} onClick={handleSetStartDate}>Start Meal Plan Today</Button>
        </div>
      )}

      {/* Cards */}
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
        <LayoutGroup>
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
              {/* Big card - centre */}
              <div className="flex-1 min-w-0">
                <ExpandedRecipe
                  menu={selectedMenu}
                  onClose={() => setSelectedId(null)}
                  onSwap={(menuId, mealTypeId, recipeId) => setSwapModal({ menuId, mealTypeId, recipeId })}
                />
              </div>

              {/* Sidebar - other meals */}
              <div className="w-52 shrink-0 flex flex-col gap-2.5">
                <p className="text-[10px] font-bold text-[#8A8D93] uppercase tracking-widest px-1 mb-1">Other meals</p>
                {sideMenus.map((m) => (
                  <MealCard
                    key={m.id}
                    menuId={m.id}
                    recipe={m.recipe}
                    mealTypeName={m.mealType?.name}
                    compact
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
              className="grid sm:grid-cols-2 gap-4"
            >
              {menus.map((menu) => (
                <MealCard
                  key={menu.id}
                  menuId={menu.id}
                  recipe={menu.recipe}
                  mealTypeName={menu.mealType?.name}
                  onSelect={() => setSelectedId(menu.id)}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        </LayoutGroup>
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
