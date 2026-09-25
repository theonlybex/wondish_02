"use client";

import { apiFetch } from "@/lib/client-fetch";
import Link from "next/link";
import React, { useState, useEffect, useRef } from "react";
import { displayDishName, formatAmount } from "@/lib/dish-name";
import { basketBlockerText } from "@/lib/basket-readiness";
import { CUISINES } from "@/lib/cuisines";
import { format, addDays, subDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import SwapMealModal from "@/components/meal-plan/SwapMealModal";
import Button from "@/components/ui/Button";
import QuotaError from "@/components/ui/QuotaError";
import type { MealType } from "@/lib/local-date";
import { MenuEntry, RecipeDTO, PlanExchangeDTO } from "@/types";

interface DailyMealPlanViewProps {
  initialMenus: MenuEntry[];
  initialDate: string;
  mealPlanStartDate?: string | null;
  initialLoggedRecipeIds?: string[];
  initialMealRatings?: Record<string, number>;
  initialDailyCalorieTarget?: number | null;
  /** Target grams for the rendered day, so the four rings share a denominator
   *  from the first paint rather than after a round-trip. */
  initialDailyMacroTarget?: { protein: number; carbs: number; fat: number } | null;
  /** True when the URL asked for a specific day (?date=). Suppresses the
   *  "correct the server's timezone to the client's today" rewrite. */
  pinnedDate?: boolean;
  initialStale?: boolean;
  /** The account already has a generation in flight (mealPlanStatus). */
  initialGenerating?: boolean;
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

// Tags that record provenance rather than describing the food.
const INTERNAL_TAGS = new Set(["clara", "clara-swap", "generated", "seed", "import"]);
const visibleTags = (tags?: string[] | null): string[] =>
  (tags ?? []).filter((t) => !INTERNAL_TAGS.has(t.trim().toLowerCase()));

/**
 * The user-facing name for a dishType, or null when it says nothing. Every
 * generated dish is a "complete meal" for selection reasons, so that value is
 * noise on a card — and a lie on a snack.
 */
function dishTypeLabel(dishTypeName?: string | null): string | null {
  const n = (dishTypeName ?? "").trim();
  if (!n || n.toLowerCase() === "complete meal") return null;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function roleBadge(dishTypeName?: string | null): { label: string; bg: string; text: string } | null {
  const n = (dishTypeName ?? "").toLowerCase();
  // "Complete meal" is not shown. Every Clara-generated dish carries that
  // dishType because the builder's primary-dish step selects on it
  // (lib/clara/recipe-generation.ts), so it appeared on 25 of 25 cards in one
  // QA week — including a 240 kcal snack of broccoli, oil and thyme, where it
  // was simply wrong. A chip that is always present carries no information;
  // the side/dessert/beverage labels below do, so they stay.
  if (n === "complete meal")     return null;
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

// One error paragraph for every "new week" failure surface. The quota 429 also
// carries an upgrade hint (`upgrade: true` from quotaExceededBody), and that
// hint has to appear wherever the message does. It previously rendered on only
// one of the three surfaces, so the bottom "Generate a new week" button — the
// one users actually press — showed "Premium gives you 5 a week" with nothing
// to click (2026-09-17).
//
// The link points at /pricing, not /membership: a free account needs to pick a
// plan, which is what /pricing does and where the header's own upgrade link
// goes. /membership renders the billing panel, which for an account carrying a
// FREE Stripe row shows the lapsed-subscriber view rather than a plan picker.
// ── Inline expanded dish ──────────────────────────────────────────────────────
function InlineDishExpand({
  menu,
  onSwap,
  rating,
  onRate,
  ratingBusy,
  rateError,
}: {
  menu: MenuEntry;
  onSwap: (menuId: string, mealTypeId: string, recipeId: string, calories: number) => void;
  isCompleted: boolean;
  rating: number | null;
  onRate: (recipeId: string, mealTypeName: string, rating: number) => void;
  ratingBusy: boolean;
  rateError: string;
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
        {/* dishType is shown here ONCE, as a label, and not at all when it is
            "complete meal" — see roleBadge. This block used to print the raw
            lowercase DB value alongside the styled chip, so a card carried
            "Complete meal" and "complete meal" one above the other. */}
        {(r.ethnic?.name || dishTypeLabel(r.dishType?.name)) && (
          <div className="flex flex-wrap gap-1 mb-3">
            {r.ethnic?.name && (
              <span className="text-[9px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {r.ethnic.name}
              </span>
            )}
            {dishTypeLabel(r.dishType?.name) && (
              <span className="text-[9px] font-semibold bg-[#F0EFF4] text-[#848181] px-2 py-0.5 rounded-full">
                {dishTypeLabel(r.dishType?.name)}
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
                      {formatAmount(ri.quantity, ri.unit ?? ri.ingredient.unit)}
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

        {/* Tags — minus the internal ones. "clara" and "clara-swap" are how
            the catalog records who WROTE a dish (lib/clara/recipe-generation.ts
            tags every generated row), and they were rendering as a "#clara"
            chip on every card in a generated week. Provenance is not a label
            for the diner. */}
        {visibleTags(r.tags).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {visibleTags(r.tags).map((tag) => (
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
            disabled={ratingBusy}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              rating === -1 ? "bg-red-500 text-white" : "bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
            }`}
          >
            <span>👎</span> {rating === -1 ? "Not for me!" : "Not for me"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRate(r.id, menu.mealType?.name ?? "Meal", 1); }}
            disabled={ratingBusy}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-semibold text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              rating === 1 ? "bg-emerald-500 text-white" : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            <span>👍</span> {rating === 1 ? "Loved it!" : "Loved it"}
          </button>
        </div>
        {rateError && (
          <p role="alert" className="text-xs mt-2 text-error">{rateError}</p>
        )}
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
  initialDailyMacroTarget = null,
  pinnedDate = false,
  initialStale = false,
  initialGenerating = false,
}: DailyMealPlanViewProps) {
  const [date, setDate]                 = useState(() => parseLocalDate(initialDate));
  const [menus, setMenus]               = useState(initialMenus);
  const [loggedRecipeIds, setLoggedRecipeIds] = useState<string[]>(initialLoggedRecipeIds);
  const [mealRatings, setMealRatings]   = useState<Record<string, number>>(initialMealRatings);
  const [loading, setLoading]           = useState(false);
  const [startDate, setStartDate]       = useState(mealPlanStartDate ? new Date(mealPlanStartDate) : null);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [ratingBusy, setRatingBusy]     = useState(false);
  const [rateError, setRateError]       = useState("");
  // State updates are async, so two clicks inside one render both saw
  // ratingBusy === false. The ref flips synchronously and is the real guard;
  // ratingBusy only drives the disabled styling.
  const ratingInFlight = useRef(false);
  // rateError belongs to the open card, so clear it whenever the selection
  // changes — otherwise a failure on one dish greets you on the next one.
  const selectCard = (id: string | null) => {
    setRateError("");
    setSelectedId(id);
  };
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState<number | null>(initialDailyCalorieTarget);
  // Target grams for the day, from /api/meal-plan. The macro rows used to be
  // divided by the PLAN's own totals while the calorie ring above them used
  // the target — one widget, two denominators, neither labelled.
  const [dailyMacroTarget, setDailyMacroTarget] = useState<{ protein: number; carbs: number; fat: number } | null>(initialDailyMacroTarget);
  // Sodium from the day's added salt, and the guideline to read it against.
  // The builder aims under the guideline and cannot always get there — four
  // dishes at a quarter teaspoon each is already 2,325 mg — so the number is
  // shown rather than quietly missed.
  const [daySalt, setDaySalt] = useState<{ mg: number; guideline: number } | null>(null);
  // Basket readiness for the New-week gate (min ingredients + category
  // coverage). Generation is manual now — no auto-start; when the week runs
  // out the New-week panel below drives it.
  const [basketStatus, setBasketStatus] = useState<{
    count: number; min: number; ready: boolean; missingCategories: string[]; missingBreakfast?: boolean;
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
    // The timezone correction applies ONLY when the page is showing "today".
    // When the URL asked for a specific day, the server rendered that day on
    // purpose and "today" is not a correction, it is a different question:
    // this branch was silently rewriting ?date=2026-09-26 back to today, which
    // is why the parameter still looked dead after the page started honouring
    // it (QA 2026-09-24).
    const correctTimezone = !pinnedDate && clientToday !== serverDay;
    const dateStr = correctTimezone ? clientToday : serverDay;
    apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        // Any error body (401 after idle, 404, 403) used to wipe the
        // server-rendered plan to [] and invite a wasted regeneration (C2).
        if (!r.ok || !data) return;
        if (correctTimezone) {
          setDate(parseLocalDate(clientToday));
          setMenus(data.menus ?? []);
          setLoggedRecipeIds(data.loggedRecipeIds ?? []);
          setMealRatings(data.mealRatings ?? {});
          setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
        } else if (dailyCalorieTarget === null && data.dailyCalorieTarget != null) {
          setDailyCalorieTarget(data.dailyCalorieTarget);
        }
        // Unconditionally, and NOT inside either branch: the macro target has
        // no server-rendered value to fall back on, so gating it behind
        // "calorie target is still null" meant it stayed null on every normal
        // load. The calorie ring then divided by the target while the three
        // macro rows divided by the plan's own totals — the exact defect the
        // single-denominator change was meant to fix, still shipping because
        // the number it needed never arrived.
        if (data.dailyMacroTarget) setDailyMacroTarget(data.dailyMacroTarget);
        if (data.daySaltSodiumMg != null) setDaySalt({ mg: data.daySaltSodiumMg, guideline: data.dailySodiumGuidelineMg ?? 2300 });
        setExchanges(data.exchanges ?? null);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back and Forward move between days, now that each day pushes an entry.
  // Without this the URL changed and the view did not, which is a worse state
  // than not pushing at all.
  useEffect(() => {
    const onPop = () => {
      const param = new URLSearchParams(window.location.search).get("date");
      const next = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? parseLocalDate(param) : null;
      if (!next || format(next, "yyyy-MM-dd") === format(date, "yyyy-MM-dd")) return;
      setDate(next);
      void apiFetch(`/api/meal-plan?date=${format(next, "yyyy-MM-dd")}&exchanges=1`)
        .then(async (r) => {
          const data = await r.json().catch(() => null);
          if (!r.ok || !data) return;
          setMenus(data.menus ?? []);
          setLoggedRecipeIds(data.loggedRecipeIds ?? []);
          setMealRatings(data.mealRatings ?? {});
          setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
          setDailyMacroTarget(data.dailyMacroTarget ?? null);
          setDaySalt(data.daySaltSodiumMg != null ? { mg: data.daySaltSodiumMg, guideline: data.dailySodiumGuidelineMg ?? 2300 } : null);
          setExchanges(data.exchanges ?? null);
        })
        .catch(() => {});
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Adopt a build that was already running when this page loaded: poll until
  // it finishes, then read the plan in, exactly as if this tab had asked.
  useEffect(() => {
    if (!initialGenerating) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await apiFetch("/api/meal-plan/status");
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.status !== "GENERATING") {
          const dateStr = format(new Date(), "yyyy-MM-dd");
          const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
          const mData = await mRes.json().catch(() => null);
          if (mRes.ok && mData) {
            setMenus(mData.menus ?? []);
            setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
            setMealRatings(mData.mealRatings ?? {});
            if (mData.mealPlanStartDate) setStartDate(new Date(mData.mealPlanStartDate));
            setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
            if (mData.dailyMacroTarget) setDailyMacroTarget(mData.dailyMacroTarget);
      if (mData.daySaltSodiumMg != null) setDaySalt({ mg: mData.daySaltSodiumMg, guideline: mData.dailySodiumGuidelineMg ?? 2300 });
            setExchanges(mData.exchanges ?? null);
            setStale(false);
          }
          setNewWeekLoading(false);
          return;
        }
      } catch {
        // A failed poll is not a failed build; keep waiting.
      }
      if (!stop) setTimeout(tick, 4000);
    };
    void tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New-week (rolling) generation — manual, gated on basket readiness. Builds
  // the next 7 days from the pantry basket (see /api/meal-plan/new-week).
  // A build started elsewhere — another tab, or this tab before the user
  // navigated away and came back. Until 2026-09-24 that state was invisible:
  // /api/meal-plan/status said GENERATING while the page showed the OLD plan,
  // the "profile changed" banner and a live New week button, so a tester was
  // invited to spend a second weekly generation on a build already running.
  const [newWeekLoading, setNewWeekLoading] = useState(initialGenerating);
  const [newWeekError, setNewWeekError] = useState("");
  // Set when the 429 body says the premium tier has a higher weekly limit.
  const [newWeekUpgrade, setNewWeekUpgrade] = useState(false);
  const generateNewWeek = async () => {
    if (newWeekLoading) return;
    setNewWeekLoading(true);
    setNewWeekError("");
    setNewWeekUpgrade(false);
    selectCard(null);
    try {
      const res = await apiFetch("/api/meal-plan/new-week", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNewWeekError(data?.error ?? "Couldn't generate your week — try again.");
        setNewWeekUpgrade(data?.code === "quota" && data?.upgrade === true);
        void loadBasketStatus();
        return;
      }
      const dateStr = format(new Date(), "yyyy-MM-dd");
      const mRes = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const mData = await mRes.json().catch(() => null);
      if (!mRes.ok || !mData) {
        // The week WAS generated; only the re-read failed. Never blank the
        // screen or the user will burn a second weekly token rebuilding.
        setNewWeekError("Your new week is ready — reload the page to see it.");
        return;
      }
      setMenus(mData.menus ?? []);
      setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
      setMealRatings(mData.mealRatings ?? {});
      if (mData.mealPlanStartDate) setStartDate(new Date(mData.mealPlanStartDate));
      setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
      setDailyMacroTarget(mData.dailyMacroTarget ?? null);
      if (mData.daySaltSodiumMg != null) setDaySalt({ mg: mData.daySaltSodiumMg, guideline: mData.dailySodiumGuidelineMg ?? 2300 });
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
  const [navError, setNavError] = useState("");
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
      const mData = await mRes.json().catch(() => null);
      if (!mRes.ok || !mData) {
        setCuisineDayError("Today was updated — reload the page to see it.");
        return;
      }
      setMenus(mData.menus ?? []);
      setLoggedRecipeIds(mData.loggedRecipeIds ?? []);
      setMealRatings(mData.mealRatings ?? {});
      setDailyCalorieTarget(mData.dailyCalorieTarget ?? null);
      setDailyMacroTarget(mData.dailyMacroTarget ?? null);
      if (mData.daySaltSodiumMg != null) setDaySalt({ mg: mData.daySaltSodiumMg, guideline: mData.dailySodiumGuidelineMg ?? 2300 });
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
  // A plan covers seven days from its start. Anything past that is not a day
  // the user can generate into; it is a day that does not exist yet.
  const PLAN_WINDOW_DAYS = 7;
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const maxBrowseDate = addDays(todayMidnight, BROWSE_AHEAD_DAYS);
  const atForwardLimit = date >= maxBrowseDate;
  const atBackLimit = date <= todayMidnight;
  // Past the plan's last day. Only meaningful once a plan exists — without one,
  // every day is a cold start and the generate card is the right thing to show.
  const beyondPlanWindow = startDate !== null && date >= addDays(startDate, PLAN_WINDOW_DAYS);

  const navigate = async (dir: "prev" | "next") => {
    if (dir === "next" && atForwardLimit) return;
    if (dir === "prev" && atBackLimit) return;
    if (loading) return;
    selectCard(null);
    setNavError("");
    const prevDate = date;
    const newDate = dir === "next" ? addDays(date, 1) : subDays(date, 1);
    const dateStr = format(newDate, "yyyy-MM-dd");
    setDate(newDate);
    // Put the day in the URL. Six presses of the arrow left the address bar on
    // /meal-plan, so the day was not shareable, a refresh lost it, and Back
    // exited the page instead of stepping back a day (QA cycle 8). replaceState
    // rather than pushState for the arrows would keep Back broken, so this
    // pushes — one history entry per day, which is what the arrows imply.
    if (typeof window !== "undefined") {
      window.history.pushState({ wondishDate: dateStr }, "", `?date=${dateStr}`);
    }
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/meal-plan?date=${dateStr}&exchanges=1`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        // Keep the dishes that match the header: revert the date instead of
        // showing yesterday's food under today's date (C2).
        setDate(prevDate);
        setNavError(data?.error ?? "Couldn't load that day — try again.");
        return;
      }
      setMenus(data.menus ?? []);
      setLoggedRecipeIds(data.loggedRecipeIds ?? []);
      setMealRatings(data.mealRatings ?? {});
      if (data.mealPlanStartDate) setStartDate(new Date(data.mealPlanStartDate));
      setDailyCalorieTarget(data.dailyCalorieTarget ?? null);
      setDailyMacroTarget(data.dailyMacroTarget ?? null);
      // This was the ONE of five fetch paths that forgot the salt figure, so
      // paging a day left yesterday's number on screen — and a day over the
      // guideline would have shown a stale under-guideline GREEN one. Every
      // number on this card comes from the same response; they have to be set
      // from it together.
      setDaySalt(data.daySaltSodiumMg != null ? { mg: data.daySaltSodiumMg, guideline: data.dailySodiumGuidelineMg ?? 2300 } : null);
      setExchanges(data.exchanges ?? null);
    } catch {
      setDate(prevDate);
      setNavError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRate = async (recipeId: string, mealTypeName: string, rating: number) => {
    // /api/journal/log-meal is a TOGGLE: two fast taps logged then un-logged
    // the meal with no feedback (C2). One in flight at a time.
    if (ratingInFlight.current) return;
    ratingInFlight.current = true;
    setRatingBusy(true);
    setRateError("");
    const dateStr = format(date, "yyyy-MM-dd");
    try {
      const res = await apiFetch("/api/journal/log-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, mealTypeName, date: dateStr, rating }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setRateError(data?.error ?? "Couldn't save your rating — try again.");
        return;
      }
      if (data.loggedRecipeIds) setLoggedRecipeIds(data.loggedRecipeIds);
      if (data.mealRatings)     setMealRatings(data.mealRatings);
      selectCard(null);
    } catch {
      setRateError("Network error — try again.");
    } finally {
      ratingInFlight.current = false;
      setRatingBusy(false);
    }
  };

  const handleSwapped = (menuId: string, newRecipe: RecipeDTO) => {
    setMenus((prev) => prev.map((m) => m.id === menuId ? { ...m, recipe: newRecipe } : m));
    selectCard(null);
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
  // All four rings measure intake against the SAME thing, and the label says
  // which: the day's target when BOTH denominators are known, the plan's own
  // totals otherwise. The either/or matters — a first pass took calories from
  // the target and macros from the plan whenever the macro target was missing,
  // and then labelled the card "this day's plan", which was false for the
  // headline number sitting right above it.
  const budgetIsTarget = dailyCalorieTarget != null && dailyMacroTarget != null;
  const budgetCalories = budgetIsTarget ? dailyCalorieTarget! : totalCalories;
  const budgetProtein  = budgetIsTarget ? dailyMacroTarget!.protein : totalProtein;
  const budgetCarbs    = budgetIsTarget ? dailyMacroTarget!.carbs   : totalCarbs;
  const budgetFat      = budgetIsTarget ? dailyMacroTarget!.fat     : totalFat;

  // Signed, so an overshoot is as visible as an undershoot. Math.max(0, …)
  // clamped it, so a day planned 100 kcal OVER target rendered as nothing at
  // all — the one direction a person on a deficit needs to be told about.
  const calorieVariance = dailyCalorieTarget ? dailyCalorieTarget - totalCalories : 0;
  const freeCalories   = Math.max(0, calorieVariance);
  const overCalories   = Math.max(0, -calorieVariance);
  const calPct  = budgetCalories > 0 ? Math.min(100, (completedCalories / budgetCalories) * 100) : 0;
  const protPct = budgetProtein > 0 ? Math.min(100, (consumedProtein / budgetProtein) * 100) : 0;
  const carbPct = budgetCarbs   > 0 ? Math.min(100, (consumedCarbs   / budgetCarbs)   * 100) : 0;
  const fatPct  = budgetFat     > 0 ? Math.min(100, (consumedFat     / budgetFat)     * 100) : 0;

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

      {/* Not while a build is running: the banner said "generate a new week to
          apply it" over a generation already in flight. */}
      {stale && !newWeekLoading && startDate && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-amber-800">Your profile changed — generate a new week to apply it to your meal plan.</span>
            <Button size="sm" loading={newWeekLoading} onClick={() => void generateNewWeek()}>New week</Button>
          </div>
          {/* The error used to render only next to the bottom "Generate a new
              week" button — off-screen from this banner on a phone, so a
              weekly-limit 429 looked like a dead tap (mobile QA 2026-09-11). */}
          <QuotaError message={newWeekError} upgrade={newWeekUpgrade} className="mt-2" />
        </div>
      )}

      {navError && (
        <p role="alert" className="text-xs mb-3 text-error">{navError}</p>
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
            className="w-9 h-9 rounded-xl border border-[#EAE4CA] flex items-center justify-center hover:bg-[#ffffff] transition-colors text-forest shrink-0 touch-target"
          >‹</button>
        )}
        <p className="flex-1 text-center font-semibold text-forest text-lg">{format(date, "EEEE, MMMM d")}</p>
        {atForwardLimit ? (
          <div className="w-9 h-9 shrink-0" aria-hidden="true" />
        ) : (
          <button
            onClick={() => navigate("next")}
            aria-label="Next day"
            className="w-9 h-9 rounded-xl border border-[#EAE4CA] flex items-center justify-center hover:bg-[#ffffff] transition-colors text-forest shrink-0 touch-target"
          >›</button>
        )}
      </div>

      {/* A build in progress, for someone who ALREADY has a plan. The
          "Generating your week…" copy below lives inside the
          `menus.length === 0` card, so a returning tester saw a greyed-out
          button and no explanation — twice reported, once as "the screen still
          tells me to generate a week while one is building" (QA 2026-09-24).
          role="status" so it is announced rather than merely visible. */}
      {newWeekLoading && menus.length > 0 && (
        <div
          role="status"
          className="rounded-2xl px-4 py-3 mb-4 flex items-center gap-2.5 border border-dashed"
          style={{ borderColor: "#812549", background: "rgba(129,37,73,0.04)" }}
        >
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm font-semibold" style={{ color: "#5F1C35" }}>
            Building your new week… you can leave this page, it keeps going.
          </p>
        </div>
      )}

      {/* New-week generation (2026-09-08): manual + basket-gated. Shown whenever
          the current day has no dishes (fresh user or the week ran out). */}
      {/* An empty day the user has PAGED to is not an invitation to rebuild the
          week. The generate card used to show on any dishless day, so paging
          back to a date before the plan started offered "Generate my whole
          week" — one of three weekly generations, spent on a day that is over
          (QA 2026-09-24). Only today, or a day inside the browsing horizon,
          gets the offer. */}
      {menus.length === 0 && !profileIncomplete && date < todayMidnight && (
        <div className="rounded-2xl px-4 py-4 mb-4 border border-dashed" style={{ borderColor: "#EAE4CA", background: "#FBFAF5" }}>
          <p className="text-sm" style={{ color: "#848181" }}>
            No plan was generated for this day — it is before your current week started.
          </p>
        </div>
      )}
      {/* …and a day BEYOND the plan is not an invitation either. The condition
          below was "dishless and not in the past", so ?date=2027-12-31 rendered
          "Your selected ingredients are the base of your plan… Generate my
          whole week" to somebody who already has one (QA 2026-09-25). The past
          case was handled and its mirror image was not. */}
      {menus.length === 0 && !profileIncomplete && date >= todayMidnight && beyondPlanWindow && (
        <div className="rounded-2xl px-4 py-4 mb-4 border border-dashed" style={{ borderColor: "#EAE4CA", background: "#FBFAF5" }}>
          <p className="text-sm" style={{ color: "#848181" }}>
            That day is beyond your current week. Your plan covers{" "}
            {startDate ? format(startDate, "MMM d") : ""} to{" "}
            {startDate ? format(addDays(startDate, PLAN_WINDOW_DAYS - 1), "MMM d") : ""}.
          </p>
        </div>
      )}
      {menus.length === 0 && !profileIncomplete && date >= todayMidnight && !beyondPlanWindow && (
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
                {basketStatus.missingCategories.length ? ` (include a ${basketStatus.missingCategories.join(", ")})` : ""}
                {basketStatus.missingBreakfast ? " — including something for breakfast, like eggs, oats or bread" : ""} so
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
              <QuotaError message={newWeekError} upgrade={newWeekUpgrade} className="mb-2" />
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
                                    <p className={`text-forest truncate ${isMainDish ? "text-[15px] sm:text-[11px] font-semibold" : "text-[13px] sm:text-[10px] font-medium"}`}>
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
                                onClick={() => selectCard(isSelected ? null : menu.id)}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className={`text-forest truncate ${isMainDish ? "text-[15px] sm:text-[11px] font-semibold" : "text-[13px] sm:text-[10px] font-medium"}`}>
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
                                    ratingBusy={ratingBusy}
                                    rateError={rateError}
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

          {/* How the day's plan sits against the target — in BOTH directions.
              Only the under case existed, so a day planned over target showed
              nothing at all: a QA week was +89 and +76 kcal on two days with
              no indication anywhere (2026-09-24). Over-target is stated
              plainly and without alarm — a small overshoot is normal, and the
              point is that the user is told rather than warned. */}
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
          {overCalories > 0 && (
            <div
              className="mt-3 rounded-xl px-4 py-3 flex items-center gap-3"
              style={{ background: "rgba(183,94,120,0.08)", border: "1px solid rgba(183,94,120,0.22)" }}
            >
              <div
                className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm font-bold shrink-0"
                style={{ border: "1px solid rgba(183,94,120,0.3)", color: "#B75E78" }}
                aria-hidden="true"
              >
                +
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#8C4258" }}>
                  {Math.round(overCalories)} kcal over today&apos;s target
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "#848181" }}>
                  This day&apos;s dishes add up to {Math.round(totalCalories)} kcal against a{" "}
                  {Math.round(dailyCalorieTarget ?? 0)} kcal target. Swap a dish for a lighter one, or let it
                  even out across the week.
                </p>
              </div>
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
            {/* Say what the number after the slash IS. Four figures on this
                card share one grammar, so leaving the denominator unnamed
                left the user to guess whether it was their target or the
                plan's own total — and until today it was silently both. */}
            <p className="text-[10px] text-center mb-2" style={{ color: "#ABA6A6" }}>
              eaten of {budgetIsTarget ? "your daily target" : "this day's plan"}
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
                { label: "Protein", consumed: Math.round(consumedProtein), total: Math.round(budgetProtein), color: "#60a5fa" },
                { label: "Carbs",   consumed: Math.round(consumedCarbs),   total: Math.round(budgetCarbs),   color: "#fb923c" },
                { label: "Fat",     consumed: Math.round(consumedFat),     total: Math.round(budgetFat),     color: "#a78bfa" },
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
              {/* Added salt, shown because the plan cannot always get under the
                  guideline: four dishes at a quarter teaspoon each is already
                  2,325 mg, so a silently-missed target would be a number the
                  app knew and did not say. Named "added salt" rather than
                  sodium — it counts the salt on the ingredient rows, not
                  everything the diner eats. */}
              {/* What the DAY'S PLAN holds, against the same targets — not what
                  has been logged. The rings above divide logged intake by the
                  target, so with nothing logged they read 0/43g and a day
                  carrying 93 g of fat was never compared to anything. QA
                  measured every day of a week at 158-238% of the fat target
                  with no surface anywhere saying so, while the app was already
                  honest about calories and sodium. */}
              {budgetIsTarget && menus.length > 0 && (
                <div className="pt-2.5 mt-0.5 border-t" style={{ borderColor: "#F0EFF5" }}>
                  <p className="text-[9px] tracking-[0.18em] uppercase font-bold mb-1.5" style={{ color: "#ABA6A6" }}>
                    This day&apos;s plan
                  </p>
                  {[
                    { label: "Protein", planned: Math.round(totalProtein), target: Math.round(budgetProtein) },
                    { label: "Carbs", planned: Math.round(totalCarbs), target: Math.round(budgetCarbs) },
                    { label: "Fat", planned: Math.round(totalFat), target: Math.round(budgetFat) },
                  ].map(({ label, planned, target }) => {
                    const pct = target > 0 ? Math.round((planned / target) * 100) : 0;
                    // A plan is not meant to hit a macro exactly; 70-130% is
                    // the band where nothing is worth saying.
                    const off = pct > 130 || pct < 70;
                    return (
                      <div key={label} className="flex items-center justify-between">
                        <p className="text-[10px]" style={{ color: "#848181" }}>{label}</p>
                        <p className="text-[10px] tabular-nums" style={{ color: off ? "#B75E78" : "#848181" }}>
                          {planned}g of {target}g{off ? ` · ${pct}%` : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              {daySalt && daySalt.mg > 0 && (
                <div className="flex items-center justify-between pt-2.5 border-t" style={{ borderColor: "#F0EFF5" }}>
                  <p className="text-[9px] tracking-[0.18em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
                    Added salt
                  </p>
                  <p className="tabular-nums leading-none" style={{ color: "#1E1A1A" }}>
                    <span
                      className="text-lg font-bold"
                      style={{ color: daySalt.mg > daySalt.guideline ? "#B75E78" : "#2E7D5B" }}
                    >
                      {daySalt.mg.toLocaleString()}
                    </span>
                    <span className="text-xs font-medium mx-0.5" style={{ color: "#CCC6C6" }}>/</span>
                    <span className="text-base font-bold">{daySalt.guideline.toLocaleString()}</span>
                    <span className="text-xs font-medium ml-0.5" style={{ color: "#ABA6A6" }}>mg</span>
                  </p>
                </div>
              )}
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
              {/* Disabled with the reason beside it when the basket cannot fill
                  a week. QA clicked an enabled button with an unready basket and
                  got nothing at all — the server's 422 is correct and the dead
                  click is the defect. A reason the user can read before clicking
                  beats an error afterwards.

                  aria-describedby, and aria-disabled rather than disabled: a
                  `disabled` button is removed from the tab order, so a keyboard
                  or screen-reader user could neither reach the control nor hear
                  the unassociated <p> explaining it (QA 2026-09-25). It stays
                  focusable, announces its reason, and the handler refuses.
                  The message itself comes from basketBlockerText, the one
                  composer /pantry and the server also use — they used to
                  disagree about the same basket. */}
              <Button
                variant="secondary"
                size="sm"
                loading={newWeekLoading}
                aria-disabled={basketStatus ? !basketStatus.ready : false}
                aria-describedby={basketStatus && !basketStatus.ready ? "new-week-blocker" : undefined}
                onClick={() => {
                  if (basketStatus && !basketStatus.ready) return;
                  void generateNewWeek();
                }}
                className={`w-full${basketStatus && !basketStatus.ready ? " opacity-50 cursor-not-allowed" : ""}`}
              >
                Generate a new week
              </Button>
              {basketStatus && !basketStatus.ready ? (
                <p id="new-week-blocker" className="text-[11px] mt-1.5 leading-snug" style={{ color: "#848181" }}>
                  {basketBlockerText(basketStatus)}{" "}
                  <Link href="/pantry" className="underline font-semibold" style={{ color: "#812549" }}>
                    open Ingredients
                  </Link>
                </p>
              ) : (
                <QuotaError message={newWeekError} upgrade={newWeekUpgrade} className="mt-1.5" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
