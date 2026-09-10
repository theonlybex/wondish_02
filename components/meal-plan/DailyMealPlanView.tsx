"use client";

import { apiFetch } from "@/lib/client-fetch";
import React, { useState, useEffect } from "react";
import { displayDishName } from "@/lib/dish-name";
import { CUISINES } from "@/lib/cuisines";
import { format, addDays, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import SwapMealModal from "@/components/meal-plan/SwapMealModal";
import Button from "@/components/ui/Button";
import type { MealType } from "@/lib/local-date";
import { MenuEntry, RecipeDTO, PlanExchangeDTO } from "@/types";

interface DailyMealPlanViewProps {
  initialMenus: MenuEntry[];
  initialDate: string;
  mealPlanStartDate?: string | null;
  initialLoggedRecipeIds?: string[];
  initialMealRatings?: Record<string, number>;
  initialDailyCalorieTarget?: number | null;
  initialStale?: boolean;
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

// Plan meal-type name ("Breakfast"/…) → the meal-log slug the API expects.
const MEAL_TYPE_SLUG: Record<string, MealType> = {
  Breakfast: "breakfast",
  Lunch:     "lunch",
  Snack:     "snack",
  Dinner:    "dinner",
};
function mealTypeSlug(name?: string | null): MealType {
  return MEAL_TYPE_SLUG[name ?? ""] ?? "snack";
}

function roleBadge(dishTypeName?: string | null): { label: string; bg: string; text: string } | null {
  const n = (dishTypeName ?? "").toLowerCase();
  if (n === "complete meal")     return { label: "Complete meal", bg: "bg-[#F5F1DD]", text: "text-[#006658]" };
  if (n === "veggie side dish")  return { label: "Veggie side",   bg: "bg-[#d1fae5]", text: "text-[#059669]" };
  if (n === "starchy side dish") return { label: "Starchy side",  bg: "bg-[#fef3c7]", text: "text-[#b45309]" };
  if (n === "fruity side dish")  return { label: "Fruity side",   bg: "bg-[#fef9c3]", text: "text-[#a16207]" };
  if (n === "dessert")           return { label: "Dessert",        bg: "bg-[#fce7f3]", text: "text-[#be185d]" };
  if (n === "beverage")          return { label: "Beverage",       bg: "bg-[#eff6ff]", text: "text-[#1d4ed8]" };
  if (n === "main dish" || n === "main course" || n === "side dish" || n === "salad" || n === "soup")
    return { label: "Main", bg: "bg-[#F5F1DD]", text: "text-[#006658]" };
  return null;
}

function CaloriePill({ total, completed }: { total: number; completed: number }) {
  return (
    <div className="flex items-center gap-1.5 bg-white border border-[#EAE4CA] rounded-full px-3 py-1.5">
      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
      <span className="text-[10px] font-bold text-forest">{Math.round(completed)}</span>
      <span className="text-[10px] text-[#848181]">/ {Math.round(total)} kcal</span>
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
  // Prefer the recipe's real cooking steps (Clara + curated); fall back to
  // splitting the description for older dishes that packed steps in there.
  const savedSteps = (r as { steps?: string[] }).steps;
  const steps = Array.isArray(savedSteps) && savedSteps.length > 0
    ? savedSteps.map((s) => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean)
    : r.description
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
      <div className="pt-3 mt-2 border-t border-[#F5F1DD]">
        {/* Tags */}
        {(r.ethnic?.name || r.dishType?.name) && (
          <div className="flex flex-wrap gap-1 mb-3">
            {r.ethnic?.name && (
              <span className="text-[9px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {r.ethnic.name}
              </span>
            )}
            {r.dishType?.name && (
              <span className="text-[9px] font-semibold bg-[#F0EFF4] text-[#848181] px-2 py-0.5 rounded-full">
                {r.dishType.name}
              </span>
            )}
          </div>
        )}

        {/* Stats + swap */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {[
            { label: "Prep",   value: (r.prepTime  ?? 0) > 0 ? `${r.prepTime}m`   : "—" },
            { label: "Cook",   value: (r.cookTime  ?? 0) > 0 ? `${r.cookTime}m`   : "—" },
            { label: "Serves", value: (r.servings  ?? 0) > 0 ? String(r.servings) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#F9F7ED] border border-[#EAE4CA] rounded-lg px-2.5 py-1.5 text-center min-w-[52px]">
              <p className="font-bold text-forest text-xs">{value}</p>
              <p className="text-[9px] text-[#9C9494] mt-0.5">{label}</p>
            </div>
          ))}
          <button
            className="ml-auto text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-[#EAE4CA] text-[#848181] hover:bg-[#ffffff] transition-colors"
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
            { label: "Fat",     value: r.fat     ? `${r.fat}g`     : null, sub: "fat",     color: "bg-[#F3F2FF] text-[#848181]"  },
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
            <p className="text-[9px] font-bold text-[#848181] uppercase tracking-widest mb-2">Ingredients</p>
            <ul className="space-y-1.5">
              {r.ingredients.map((ri) => (
                <li key={ri.ingredientId} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-forest font-medium">
                    <span className="w-1 h-1 rounded-full bg-primary/40 shrink-0" />
                    {/* Clara-created ingredients arrive lowercase; the catalog is Title-case. */}
                    {ri.ingredient.name.charAt(0).toUpperCase() + ri.ingredient.name.slice(1)}
                    {ri.note && <span className="text-[10px] font-normal text-[#848181]">· {ri.note}</span>}
                  </span>
                  {ri.quantity && (
                    <span className="text-[10px] text-[#848181]">
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
            <p className="text-[9px] font-bold text-[#848181] uppercase tracking-widest mb-2">Steps</p>
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
              <span key={tag} className="text-[9px] font-medium text-[#848181] bg-[#F7F6FB] px-2 py-0.5 rounded-full">
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
  initialStale = false,
}: DailyMealPlanViewProps) {
  const [date, setDate]                 = useState(() => parseLocalDate(initialDate));
  const [menus, setMenus]               = useState(initialMenus);
  const [loggedRecipeIds, setLoggedRecipeIds] = useState<string[]>(initialLoggedRecipeIds);
  const [mealRatings, setMealRatings]   = useState<Record<string, number>>(initialMealRatings);
  const [loading, setLoading]           = useState(false);
  const [startDate, setStartDate]       = useState(mealPlanStartDate ? new Date(mealPlanStartDate) : null);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState<number | null>(initialDailyCalorieTarget);
  // Basket readiness for the New-week gate (min ingredients + category
  // coverage). Generation is manual now — no auto-start; when the week runs
  // out the New-week panel below drives it.
  const [basketStatus, setBasketStatus] = useState<{
    count: number; min: number; ready: boolean; missingCategories: string[];
  } | null>(null);
  const loadBasketStatus = async () => {
    try {
      const res = await apiFetch("/api/pantry/basket-status");
      if (res.ok) setBasketStatus(await res.json());
    } catch {
      /* leave null — the panel falls back to the ready-looking state */
    }
  };
  useEffect(() => {
    void loadBasketStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [stale, setStale] = useState(initialStale);
  const [swapModal, setSwapModal]       = useState<{
    menuId: string; mealTypeId: string; recipeId: string; calories: number;
  } | null>(null);
  // Plan-exchange overlay (display parity — the exchange interaction lives in
  // the iOS app; the server is the single source of truth).
  const [exchanges, setExchanges] = useState<{ pending: PlanExchangeDTO[]; resolved: PlanExchangeDTO[] } | null>(null);

  // Hydrate the exchange overlay for the initial date (the server render
  // doesn't include it), backfill the calorie target if the server couldn't
  // compute it on first render, and — timezone fix (2026-07-31) — snap to the
  // CLIENT's local today: the server component computes "today" in the server
  // timezone (UTC on Vercel), which after ~5pm local showed users the next
  // day's dishes and disagreed with the iOS app's device-local date.
  useEffect(() => {
    const clientToday = format(new Date(), "yyyy-MM-dd");
    const serverDay = format(date, "yyyy-MM-dd");
    const dateStr = clientToday !== serverDay ? clientToday : serverDay;
    apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`)
      .then((r) => r.json())
      .then((data) => {
        if (clientToday !== serverDay) {
          setDate(parseLocalDate(clientToday));
          setMenus(data.menus ?? []);
          setLoggedRecipeIds(data.loggedRecipeIds ?? []);
          setMealRatings(data.mealRatings ?? {});
          setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
        } else if (dailyCalorieTarget === null && data.dailyCalorieTarget != null) {
          setDailyCalorieTarget(data.dailyCalorieTarget);
        }
        setExchanges(data.exchanges ?? null);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New-week (rolling) generation — manual, gated on basket readiness. Builds
  // the next 7 days from the pantry basket (see /api/meal-plan/new-week).
  const [newWeekLoading, setNewWeekLoading] = useState(false);
  const [newWeekError, setNewWeekError] = useState("");
  const generateNewWeek = async () => {
    if (newWeekLoading) return;
    setNewWeekLoading(true);
    setNewWeekError("");
    setSelectedId(null);
    try {
      const res = await apiFetch("/api/meal-plan/new-week", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNewWeekError(data?.error ?? "Couldn't generate your week — try again.");
        void loadBasketStatus();
        return;
      }
      const dateStr = format(new Date(), "yyyy-MM-dd");
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json();
      setMenus(mData.menus ?? []);
      setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
      setMealRatings(mData.mealRatings ?? {});
      if (mData.mealPlanStartDate) setStartDate(new Date(mData.mealPlanStartDate));
      setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
      setExchanges(mData.exchanges ?? null);
      setStale(false);
    } catch {
      setNewWeekError("Network error — try again.");
    } finally {
      setNewWeekLoading(false);
    }
  };

  // "Cuisine for today" — rebuild just the viewed day in a chosen cuisine
  // (basket-constrained; cuisine is a soft lens). The rest of the week stays.
  const [cuisineDayLoading, setCuisineDayLoading] = useState(false);
  const [cuisineDayError, setCuisineDayError] = useState("");
  const [showCuisines, setShowCuisines] = useState(false);
  const setCuisineForDay = async (cuisine: string) => {
    if (cuisineDayLoading) return;
    setCuisineDayLoading(true);
    setCuisineDayError("");
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      const res = await apiFetch("/api/meal-plan/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr, cuisine }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCuisineDayError(data?.error ?? "Couldn't update today — try again.");
        return;
      }
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json();
      setMenus(mData.menus ?? []);
      setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
      setMealRatings(mData.mealRatings ?? {});
      setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
      setExchanges(mData.exchanges ?? null);
      setShowCuisines(false);
    } catch {
      setCuisineDayError("Network error — try again.");
    } finally {
      setCuisineDayLoading(false);
    }
  };

  // Browsing horizon: today through one week ahead. The plan is generated
  // weeks out, but distant days get recomputed as weight drifts; past days
  // live in the Journal calendar, not here.
  const BROWSE_AHEAD_DAYS = 7;
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const maxBrowseDate = addDays(todayMidnight, BROWSE_AHEAD_DAYS);
  const atForwardLimit = date >= maxBrowseDate;
  const atBackLimit = date <= todayMidnight;

  const navigate = async (dir: "prev" | "next") => {
    if (dir === "next" && atForwardLimit) return;
    if (dir === "prev" && atBackLimit) return;
    setSelectedId(null);
    const newDate = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    const dateStr = format(newDate, "yyyy-MM-dd");
    setDate(newDate);
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const data = await res.json();
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
      if (data.mealPlanStartDate) setStartDate(new Date(data.mealPlanStartDate));
      setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
      setExchanges(data.exchanges ?? null);
    } finally {
      setLoading(false);
    }
  };

  const handleRate = async (recipeId: string, mealTypeName: string, rating: number) => {
    setSelectedId(null);
    const dateStr = format(date, "yyyy-MM-dd");
    const res = await apiFetch("/api/journal/log-meal", {
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


  const loggedSet        = new Set(loggedRecipeIds);

  // Plan-exchange overlay: a RESOLVED exchange replaces its displaced menu's
  // dish everywhere below — macros come from the exchange snapshot × servings,
  // and "done" means the exchanged-in dish was eaten (not the recipe logged).
  const exchangeByMenuId = new Map<string, PlanExchangeDTO>(
    (exchanges?.resolved ?? [])
      .filter((x) => x.displacedMenuId)
      .map((x) => [x.displacedMenuId as string, x])
  );
  const pendingExchanges = exchanges?.pending ?? [];
  const xMacro = (x: PlanExchangeDTO, key: "calories" | "protein" | "carbs" | "fat") =>
    (x.perServing[key] ?? 0) * x.servings;
  const menuMacro = (m: MenuEntry, key: "calories" | "protein" | "carbs" | "fat") => {
    const x = exchangeByMenuId.get(m.id);
    return x ? xMacro(x, key) : m.recipe[key] ?? 0;
  };
  const menuDone = (m: MenuEntry) => {
    const x = exchangeByMenuId.get(m.id);
    return x ? x.eaten : loggedSet.has(m.recipe.id);
  };

  const isAllDone        = menus.length > 0 && menus.every(menuDone);
  const completedCount   = menus.filter(menuDone).length;
  const totalCalories    = menus.reduce((sum, m) => sum + menuMacro(m, "calories"), 0);
  const completedCalories = menus.filter(menuDone).reduce((sum, m) => sum + menuMacro(m, "calories"), 0);
  const totalProtein     = menus.reduce((sum, m) => sum + menuMacro(m, "protein"), 0);
  const totalCarbs       = menus.reduce((sum, m) => sum + menuMacro(m, "carbs"), 0);
  const totalFat         = menus.reduce((sum, m) => sum + menuMacro(m, "fat"), 0);
  const consumedProtein  = menus.filter(menuDone).reduce((sum, m) => sum + menuMacro(m, "protein"), 0);
  const consumedCarbs    = menus.filter(menuDone).reduce((sum, m) => sum + menuMacro(m, "carbs"), 0);
  const consumedFat      = menus.filter(menuDone).reduce((sum, m) => sum + menuMacro(m, "fat"), 0);
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
    <div className="flex flex-col lg:flex-row gap-6 items-stretch lg:items-start">
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

      {stale && startDate && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 text-sm">
          <span className="flex-1 text-amber-800">Your profile changed — generate a new week to apply it to your meal plan.</span>
          <Button size="sm" loading={newWeekLoading} onClick={() => void generateNewWeek()}>New week</Button>
        </div>
      )}

      {/* Cuisine-for-today + full-week entry — only when a day exists. */}
      {menus.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowCuisines((v) => !v)}
              aria-expanded={showCuisines}
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 transition-opacity"
              style={{ color: "#812549" }}
            >
              Cuisine for today
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: showCuisines ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <a
              href="/meal-plan/weekly"
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:opacity-80 transition-opacity"
              style={{ color: "#812549" }}
            >
              View full week
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
          {showCuisines && (
            <div className="mt-2 rounded-2xl px-3 py-3 border border-dashed" style={{ borderColor: "#812549", background: "rgba(129,37,73,0.04)" }}>
              {cuisineDayError && <p role="alert" className="text-xs mb-2 text-error">{cuisineDayError}</p>}
              <div className="flex flex-wrap gap-1.5">
                {CUISINES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void setCuisineForDay(c)}
                    disabled={cuisineDayLoading}
                    className="min-h-[44px] sm:min-h-0 px-3.5 sm:px-3 py-1 rounded-full text-xs font-semibold border border-[#812549]/30 text-[#5F1C35] bg-white hover:bg-[#812549] hover:text-white transition-colors disabled:opacity-50"
                  >
                    {c}
                  </button>
                ))}
              </div>
              {cuisineDayLoading && (
                <p className="text-xs mt-2 flex items-center gap-2" style={{ color: "#5F1C35" }}>
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" role="status" aria-label="Rebuilding">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Rebuilding today…
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Date nav + calorie pill */}
      <div className="flex items-center mb-6">
        {atBackLimit ? (
          <div className="w-9 h-9 shrink-0" aria-hidden="true" />
        ) : (
          <button
            onClick={() => navigate("prev")}
            aria-label="Previous day"
            className="w-9 h-9 rounded-xl border border-[#EAE4CA] flex items-center justify-center hover:bg-[#ffffff] transition-colors text-forest shrink-0"
          >‹</button>
        )}
        <p className="flex-1 text-center font-semibold text-forest text-lg">{format(date, "EEEE, MMMM d")}</p>
        {atForwardLimit ? (
          <div className="w-9 h-9 shrink-0" aria-hidden="true" />
        ) : (
          <button
            onClick={() => navigate("next")}
            aria-label="Next day"
            className="w-9 h-9 rounded-xl border border-[#EAE4CA] flex items-center justify-center hover:bg-[#ffffff] transition-colors text-forest shrink-0"
          >›</button>
        )}
      </div>

      {/* New-week generation (2026-09-08): manual + basket-gated. Shown whenever
          the current day has no dishes (fresh user or the week ran out). */}
      {menus.length === 0 && !profileIncomplete && (
        <div className="rounded-2xl px-4 py-4 mb-4 border border-dashed" style={{ borderColor: "#812549", background: "rgba(129,37,73,0.04)" }}>
          {newWeekLoading ? (
            <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "#5F1C35" }}>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" role="status" aria-label="Generating">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Generating your week…
            </p>
          ) : basketStatus && !basketStatus.ready ? (
            <div>
              <p className="text-sm font-semibold" style={{ color: "#5F1C35" }}>
                {basketStatus.count} / {basketStatus.min} ingredients
              </p>
              <p className="text-xs mt-0.5 mb-3" style={{ color: "#848181" }}>
                Add {Math.max(0, basketStatus.min - basketStatus.count)} more
                {basketStatus.missingCategories.length ? ` (include a ${basketStatus.missingCategories.join(", ")})` : ""} so
                Clara can fill all 7 days without repeats.
              </p>
              <a href="/pantry" className="inline-block px-4 py-2 rounded-full text-xs font-semibold text-white" style={{ background: "#812549" }}>
                Add ingredients →
              </a>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold" style={{ color: "#5F1C35" }}>New week</p>
              <p className="text-xs mt-0.5 mb-3" style={{ color: "#848181" }}>
                Your selected ingredients are the base of your plan. Make sure you&apos;re happy —{" "}
                <a href="/pantry" className="font-semibold underline" style={{ color: "#812549" }}>edit the list</a> — then
                generate your whole week.
              </p>
              {newWeekError && <p role="alert" className="text-xs mb-2 text-error">{newWeekError}</p>}
              <button
                type="button"
                onClick={() => void generateNewWeek()}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white"
                style={{ background: "#812549" }}
              >
                Generate my whole week
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending plan-exchanges strip (display parity — resolve in the app) */}
      {pendingExchanges.length > 0 && (
        <div className="bg-white border border-[#EAE4CA] rounded-2xl px-4 py-3 mb-4 text-sm text-[#5F1C35]">
          <span className="font-semibold">{pendingExchanges.length}</span>{" "}
          dish{pendingExchanges.length > 1 ? "es" : ""} waiting to join today&apos;s plan — choose what
          to exchange in the Wondish app.
          <span className="flex flex-wrap gap-1.5 mt-2">
            {pendingExchanges.map((x) => (
              <span
                key={x.id}
                className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F5F1DD] text-[#5F1C35]"
              >
                {x.emoji ? `${x.emoji} ` : ""}{x.name} · {x.originLabel}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Completion banner */}
      {menus.length > 0 && (
        <div
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 mb-5 text-sm font-medium transition-all ${
            isAllDone
              ? "bg-[#F5F1DD] border border-[#EAE4CA] text-[#5F1C35]"
              : "bg-[#F9F7ED] border border-[#EAE4CA] text-[#848181]"
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
                  className={`w-2 h-2 rounded-full ${menuDone(m) ? "bg-primary" : "bg-[#EAE4CA]"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main content. The New-week panel above owns the empty state (fresh
          user or elapsed week), so here we only handle loading + the plan. */}
      {loading ? (
        <div className="text-center py-12 text-[#848181]">Loading…</div>
      ) : menus.length === 0 ? null : (
        <div>
          {/* Timeline */}
          <div
            className="grid gap-0 bg-[#F9F7ED] rounded-2xl p-4"
            // minmax(0, …) lets the card column shrink below its content's
            // min width on phones; a bare 1fr is minmax(auto, 1fr) and the
            // dish cards pushed past the viewport edge.
            style={{ gridTemplateColumns: "40px 24px minmax(0, 1fr)" }}
          >
            {mealGroups.map((group, idx) => {
              const isLast = idx === mealGroups.length - 1;
              return (
                <React.Fragment key={group.name}>
                  {/* Time label */}
                  <div className="text-right pr-1 pt-[10px]">
                    <span className="text-[9px] font-semibold text-[#9C9494]">{group.time}</span>
                  </div>

                  {/* Spine */}
                  <div className="flex flex-col items-center">
                    <div
                      className="mt-[10px] w-2.5 h-2.5 rounded-full bg-primary border-2 border-white shrink-0 z-10"
                      style={{ boxShadow: "0 0 0 1px #812549" }}
                    />
                    {!isLast && (
                      <div className="flex-1 w-0.5 bg-gradient-to-b from-primary to-[#B75E78]" />
                    )}
                  </div>

                  {/* Meal card */}
                  <div className={`pl-2 ${isLast ? "pb-0" : "pb-2.5"}`}>
                    <div
                      className={
                        group.isLunch
                          ? "bg-white border-[1.5px] border-primary rounded-xl overflow-hidden shadow-[0_2px_14px_rgba(129,37,73,.12)]"
                          : "bg-white border border-[#EAE4CA] rounded-xl overflow-hidden"
                      }
                    >
                      {/* Card header */}
                      <div
                        className={`flex items-center justify-between px-3.5 py-2.5 border-b border-[#F5F1DD] ${
                          group.isLunch ? "bg-[#ffffff]" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-bold text-primary uppercase tracking-[.08em]">
                            {group.name}
                          </span>
                          {group.isLunch && (
                            <span className="text-[8px] font-bold bg-primary text-white px-1.5 py-0.5 rounded-full">
                              Biggest meal
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-[#848181]">
                          {Math.round(group.dishes.reduce((s, m) => s + menuMacro(m, "calories"), 0))} kcal
                        </span>
                      </div>

                      {/* Dish rows */}
                      <div className="px-3.5 py-2.5 flex flex-col">
                        {group.dishes.map((menu, dIdx) => {
                          const badge       = roleBadge(menu.recipe.dishType?.name);
                          const isCompleted = loggedSet.has(menu.recipe.id);
                          const isMainDish  = dIdx === 0;
                          const isSelected  = selectedId === menu.id;
                          const exchange    = exchangeByMenuId.get(menu.id);

                          // Displaced slot: the exchanged-in dish renders in
                          // place of the planned one. Display-only — swap/
                          // rate/expand live in the iOS app for exchanges.
                          if (exchange) {
                            return (
                              <React.Fragment key={menu.id}>
                                {dIdx > 0 && <div className="h-px bg-[#F5F1DD] my-2" />}
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-forest truncate ${isMainDish ? "text-[11px] font-semibold" : "text-[10px] font-medium"}`}>
                                      {exchange.emoji ? `${exchange.emoji} ` : ""}{exchange.name}
                                      {exchange.eaten && <span className="ml-1.5 text-primary text-[9px] font-bold">✓</span>}
                                    </p>
                                    <p className="text-[9px] text-[#848181] mt-0.5">
                                      {exchange.perServing.calories == null && exchange.perServing.protein == null
                                        ? "No nutrition info for this dish"
                                        : [
                                            exchange.perServing.calories ? `${Math.round(xMacro(exchange, "calories"))} kcal` : null,
                                            exchange.perServing.protein ? `${Math.round(xMacro(exchange, "protein"))}g protein` : null,
                                          ].filter(Boolean).join(" · ")}
                                    </p>
                                    <p className="text-[9px] text-[#9C9494] mt-0.5 line-through truncate">
                                      was: {displayDishName(menu.recipe.name)}
                                    </p>
                                  </div>
                                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#F5F1DD] text-[#5F1C35] shrink-0">
                                    From {exchange.originLabel}
                                  </span>
                                </div>
                              </React.Fragment>
                            );
                          }

                          return (
                            <React.Fragment key={menu.id}>
                              {dIdx > 0 && <div className="h-px bg-[#F5F1DD] my-2" />}

                              {/* Dish row */}
                              <div
                                className={`flex items-center justify-between gap-2 cursor-pointer rounded-lg transition-colors ${
                                  isSelected ? "-mx-1.5 px-1.5 py-0.5 bg-[#ffffff]" : ""
                                }`}
                                onClick={() => setSelectedId(isSelected ? null : menu.id)}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className={`text-forest truncate ${isMainDish ? "text-[11px] font-semibold" : "text-[10px] font-medium"}`}>
                                    {displayDishName(menu.recipe.name)}
                                    {isCompleted && <span className="ml-1.5 text-primary text-[9px] font-bold">✓</span>}
                                  </p>
                                  <p className="text-[9px] text-[#848181] mt-0.5">
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
                                    className="text-[#9C9494] text-[11px] transition-transform duration-200 select-none"
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
            <div className="mt-3 border-2 border-dashed border-[#EAE4CA] rounded-xl px-4 py-3 flex items-center gap-3 bg-[#F9F7ED]">
              <div className="w-8 h-8 rounded-full bg-white border border-[#EAE4CA] flex items-center justify-center text-sm font-bold text-primary shrink-0">
                +
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-forest">
                  {Math.round(freeCalories)} kcal free
                </p>
                <p className="text-[10px] text-[#848181] mt-0.5">
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
        // Stacks under the timeline on phones; a sticky rail from lg up.
        <div className="w-full lg:w-64 shrink-0 lg:sticky lg:top-6">
          <div
            className="rounded-2xl p-5"
            style={{
              background: "#fff",
              boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
            }}
          >
            <p className="text-[9px] tracking-[0.22em] uppercase font-bold text-center mb-2" style={{ color: "#ABA6A6" }}>
              Today&apos;s calories
            </p>
            <div className="text-center mb-5">
              <span className="text-5xl font-black tracking-tight tabular-nums leading-none" style={{ color: "#812549" }}>
                {Math.round(completedCalories)}
              </span>
              <span className="text-xl font-bold mx-1" style={{ color: "#CCC6C6" }}>/</span>
              <span className="text-xl font-bold tabular-nums" style={{ color: "#1E1A1A" }}>
                {Math.round(budgetCalories)}
              </span>
              <span className="text-sm font-medium ml-1.5" style={{ color: "#CCC6C6" }}>kcal</span>
            </div>

            <div className="space-y-3 mb-5">
              {[
                { label: "Protein", consumed: Math.round(consumedProtein), total: Math.round(totalProtein), color: "#60a5fa" },
                { label: "Carbs",   consumed: Math.round(consumedCarbs),   total: Math.round(totalCarbs),   color: "#fb923c" },
                { label: "Fat",     consumed: Math.round(consumedFat),     total: Math.round(totalFat),     color: "#a78bfa" },
              ].map(({ label, consumed, total, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <p className="text-[9px] tracking-[0.18em] uppercase font-bold" style={{ color: "#ABA6A6" }}>{label}</p>
                  <p className="tabular-nums leading-none" style={{ color: "#1E1A1A" }}>
                    <span className="text-lg font-bold" style={{ color }}>{consumed}</span>
                    <span className="text-xs font-medium mx-0.5" style={{ color: "#CCC6C6" }}>/</span>
                    <span className="text-base font-bold">{total}</span>
                    <span className="text-xs font-medium ml-0.5" style={{ color }}>g</span>
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              {[
                { label: "Cal",     pct: calPct,  color: "#812549" },
                { label: "Protein", pct: protPct, color: "#60a5fa" },
                { label: "Carbs",   pct: carbPct, color: "#fb923c" },
                { label: "Fat",     pct: fatPct,  color: "#a78bfa" },
              ].map(({ label, pct, color }, i) => (
                <div key={label} className="flex items-center gap-2">
                  <p className="text-[9px] w-11 font-bold uppercase tracking-wide flex-shrink-0" style={{ color: "#ABA6A6" }}>{label}</p>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#F5F1DD" }}>
                    <div
                      className="mp-bar h-full rounded-full"
                      style={{ width: `${pct}%`, background: color, animationDelay: `${200 + i * 60}ms` }}
                    />
                  </div>
                  <p className="text-[9px] font-bold w-7 text-right tabular-nums flex-shrink-0" style={{ color: "#ABA6A6" }}>
                    {Math.round(pct)}%
                  </p>
                </div>
              ))}
            </div>
          </div>
          {startDate && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" loading={newWeekLoading} onClick={() => void generateNewWeek()} className="w-full">
                Generate a new week
              </Button>
              {newWeekError && <p role="alert" className="text-xs mt-1.5 text-error">{newWeekError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
