"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CUISINES } from "@/lib/cuisines";
import { computeBasketReadiness } from "@/lib/basket-readiness";
// Old "What to buy" design (reused the standalone GroceryListView). Replaced
// (2026-09-07) by the inline shopping list below, which ticks bought items
// straight into "What I have". Kept for reference.
// import GroceryListView from "@/components/grocery/GroceryListView";

interface Ing {
  id: string;
  name: string;
}
interface Dish {
  id: string;
  name: string;
  emoji: string | null;
  calories: number | null;
  mealType: string | null;
  missing: string[];
}
interface Cookable {
  ready: Dish[];
  almost: Dish[];
  pantryCount: number;
  readyTotal?: number;
  dayCoverage?: {
    canFillDay: boolean;
    missingSlots: string[];
    coveredCalories: number;
    targetCalories: number;
  };
}
interface CookDayMeal {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  calories: number | null;
  mealType: string | null;
  ingredients: string[];
}
interface CookDayResult {
  meals: CookDayMeal[];
  totalCalories: number;
  targetCalories: number;
  slotsFilled: number;
  slotsRequested: number;
}

export default function PantryClient({
  isOnboarding,
  initialTab = "have",
}: {
  isOnboarding: boolean;
  initialTab?: "have" | "buy";
}) {
  // Top switch: "What I have" (pick ingredients → suggestions) vs "What to buy"
  // (this week's shopping list from the plan — the former standalone screen).
  const [view, setView] = useState<"have" | "buy">(initialTab);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [common, setCommon] = useState<Ing[]>([]);
  const [selected, setSelected] = useState<Map<string, string>>(new Map()); // id → name
  const [cookable, setCookable] = useState<Cookable | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Ing[]>([]);
  const [cookDay, setCookDay] = useState<CookDayResult | null>(null);
  const [cooking, setCooking] = useState(false);
  const [cookError, setCookError] = useState("");
  // Nothing generates until the user picks a cuisine (no auto-fire).
  const [cookingCuisine, setCookingCuisine] = useState<string | null>(null);
  // "What to buy" — smart stocking list: ingredients that unlock the most
  // dishes, favorites first, minus what's already on hand. null = not loaded.
  const [groceryItems, setGroceryItems] = useState<
    { ingredientId: string; name: string; dishCount: number; favorite: boolean }[] | null
  >(null);
  const [groceryLoading, setGroceryLoading] = useState(false);
  const [groceryError, setGroceryError] = useState("");

  // Sequence guards so a slow response can never clobber a newer one.
  const cookableSeq = useRef(0);
  const searchSeq = useRef(0);
  const saveSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/pantry");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCommon(data.common ?? []);
      setSelected(new Map((data.items ?? []).map((i: Ing) => [i.id, i.name])));
      void refreshCookable();
    } catch {
      setLoadError("Couldn't load your ingredients. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const refreshCookable = async () => {
    const seq = ++cookableSeq.current;
    try {
      const res = await fetch("/api/pantry/cookable");
      if (!res.ok) return;
      const data = await res.json();
      if (seq === cookableSeq.current) setCookable(data);
    } catch {
      /* keep the previous list; the pantry itself still works */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGrocery = async () => {
    setGroceryLoading(true);
    setGroceryError("");
    try {
      const res = await fetch("/api/pantry/to-buy");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGroceryItems(data.items ?? []);
    } catch {
      setGroceryError("Couldn't load your shopping list. Check your connection and try again.");
    } finally {
      setGroceryLoading(false);
    }
  };

  // Load the shopping list the first time the "What to buy" tab is opened.
  useEffect(() => {
    if (view === "buy" && groceryItems === null && !groceryLoading) void loadGrocery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const persist = async (next: Map<string, string>) => {
    const seq = ++saveSeq.current;
    try {
      const res = await fetch("/api/pantry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientIds: Array.from(next.keys()) }),
      });
      if (!res.ok) throw new Error();
      if (seq === saveSeq.current) {
        setSyncError("");
        void refreshCookable();
      }
    } catch {
      if (seq === saveSeq.current) {
        setSyncError("Couldn't save that change — it may not stick. Check your connection.");
      }
    }
  };

  const toggle = (ing: Ing) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(ing.id)) next.delete(ing.id);
      else next.set(ing.id, ing.name);
      void persist(next);
      return next;
    });
  };

  const onQueryChange = (q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const seq = ++searchSeq.current;
      try {
        const res = await fetch(`/api/pantry?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) return;
        const data = await res.json();
        if (seq === searchSeq.current) setResults(data.ingredients ?? []);
      } catch {
        /* typeahead miss is non-fatal */
      }
    }, 250);
  };

  const cookMyDay = async (cuisine: string) => {
    if (cooking) return;
    setCooking(true);
    setCookingCuisine(cuisine);
    setCookError("");
    try {
      const res = await fetch("/api/pantry/cook-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuisine }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCookError(
          data?.error ?? "Clara couldn't cook right now — nothing was used up. Try again."
        );
        return;
      }
      setCookDay(data);
      void refreshCookable(); // the new dishes are now cookable rows too
    } catch {
      setCookError("Network error — nothing was used up. Check your connection and try again.");
    } finally {
      setCooking(false);
    }
  };

  const chip = (ing: Ing) => {
    const active = selected.has(ing.id);
    return (
      <button
        key={ing.id}
        type="button"
        aria-pressed={active}
        onClick={() => toggle(ing)}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
          active
            ? "bg-primary text-white shadow-sm shadow-primary/30"
            : "bg-[#F3F2FF] text-[#848181] hover:bg-primary/10 hover:text-primary"
        }`}
      >
        {ing.name}
      </button>
    );
  };

  const dishCard = (d: Dish, dimmed: boolean) => (
    <div
      key={d.id}
      className={`bg-white rounded-2xl p-4 flex items-center gap-3 ${dimmed ? "opacity-75" : ""}`}
      style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
        style={{ background: "rgba(129,37,73,0.08)" }}
      >
        {d.emoji ?? "🍽"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[#1E1A1A] text-sm truncate">{d.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {d.mealType && <span className="text-[10px]" style={{ color: "#ABA6A6" }}>{d.mealType}</span>}
          {d.calories != null && (
            <span className="text-[10px]" style={{ color: "#ABA6A6" }}>· {d.calories} kcal</span>
          )}
          {d.missing.length > 0 && (
            <span className="text-[10px] font-medium" style={{ color: "#B75E78" }}>
              · needs {d.missing.join(", ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const tabs = (
    <div className="flex gap-1 mb-6 p-1 rounded-xl bg-[#F3F2FF] w-fit">
      {(["have", "buy"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setView(v)}
          aria-pressed={view === v}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
            view === v ? "bg-white text-primary shadow-sm" : "text-[#848181] hover:text-primary"
          }`}
        >
          {v === "have" ? "What I have" : "What to buy"}
        </button>
      ))}
    </div>
  );

  // "What to buy" — this week's shopping list from the meal plan. Ticking an
  // item marks it bought and drops it straight into "What I have" (reuses the
  // pantry's `toggle` → PatientPantryItem write). Items already on hand show
  // as done.
  if (view === "buy") {
    return (
      <div>
        {tabs}
        <div className="mb-5 flex items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "#848181" }}>
            Buy these to unlock the most dishes — your favorites are on top.
          </p>
          <a href="/taste?edit=1" className="text-xs font-semibold shrink-0 hover:underline" style={{ color: "#812549" }}>
            Edit favorites →
          </a>
        </div>
        {groceryLoading && groceryItems === null ? (
          <div className="py-16 text-center" role="status" aria-label="Loading shopping list">
            <svg className="animate-spin h-6 w-6 text-primary mx-auto" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        ) : groceryError ? (
          <div className="py-12 text-center">
            <div role="alert" className="inline-block bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mb-4">
              {groceryError}
            </div>
            <div>
              <button type="button" onClick={() => void loadGrocery()} className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold">
                Try again
              </button>
            </div>
          </div>
        ) : !groceryItems || groceryItems.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: "#848181" }}>
            Nothing to suggest yet — rate a few ingredients to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {groceryItems.map((item) => {
              const have = selected.has(item.ingredientId);
              return (
                <button
                  key={item.ingredientId}
                  type="button"
                  onClick={() => toggle({ id: item.ingredientId, name: item.name })}
                  aria-pressed={have}
                  className="w-full flex items-center gap-3 bg-white rounded-2xl px-4 py-3 text-left transition-colors hover:bg-[#FBFAF5]"
                  style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
                >
                  <span
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      have ? "bg-primary border-primary" : "border-[#EAE4CA]"
                    }`}
                  >
                    {have && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    {item.favorite && (
                      <span aria-label="favorite" title="A favorite ingredient" style={{ color: "#812549" }}>★</span>
                    )}
                    <span className={`text-sm font-medium truncate ${have ? "line-through text-[#ABA6A6]" : "text-[#1E1A1A]"}`}>
                      {item.name}
                    </span>
                  </span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: have ? "#812549" : "#ABA6A6" }}>
                    {have ? "In your ingredients" : `unlocks ${item.dishCount} dish${item.dishCount === 1 ? "" : "es"}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {tabs}
        <div className="py-16 text-center text-sm" style={{ color: "#848181" }}>
          Loading your ingredients…
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div>
        {tabs}
        <div className="py-12 text-center">
          <div role="alert" className="inline-block bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mb-4">
            {loadError}
          </div>
          <div>
            <button
              type="button"
              onClick={() => void load()}
              className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const readyCount = cookable?.readyTotal ?? cookable?.ready.length ?? 0;

  return (
    <div className="space-y-8">
      {tabs}
      {/* Picker */}
      <section
        className="bg-white rounded-2xl p-6"
        style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
      >
        <div className="mb-4">
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search ingredients — chicken, rice, tomatoes…"
            aria-label="Search ingredients"
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#EAE4CA] bg-white text-[#1E1A1A] text-sm placeholder:text-[#A8A4B5] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
          />
          {results.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">{results.map((r) => chip(r))}</div>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mb-4">
            <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
              Selected ({selected.size})
            </p>
            <div className="flex flex-wrap gap-2">
              {Array.from(selected.entries()).map(([id, name]) => chip({ id, name }))}
            </div>
          </div>
        )}

        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
          Common ingredients
        </p>
        <div className="flex flex-wrap gap-2">
          {common.filter((c) => !selected.has(c.id)).map((c) => chip(c))}
        </div>

        {syncError && (
          <div role="alert" className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-2.5 text-xs mt-4">
            {syncError}
          </div>
        )}
      </section>

      {/* Cookable now */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-[#1E1A1A]">
            {selected.size === 0
              ? "Tap the ingredients you have — dishes appear here"
              : `${readyCount} ${readyCount === 1 ? "dish" : "dishes"} we can suggest right now`}
          </h2>
        </div>
        {cookable && cookable.ready.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3">{cookable.ready.map((d) => dishCard(d, false))}</div>
        )}
        {selected.size > 0 && cookable && cookable.ready.length === 0 && (
          <p className="text-sm py-4" style={{ color: "#848181" }}>
            Nothing fully covered yet — keep tapping, or check &quot;almost there&quot; below.
          </p>
        )}
      </section>

      {/* Clara day-cooking: the user picks a cuisine FIRST — nothing generates
          until a chip is clicked. */}
      {selected.size >= 3 && cookable?.dayCoverage && !cookable.dayCoverage.canFillDay && !cookDay && (
        <section
          className="rounded-2xl p-6 text-center"
          style={{
            background: "linear-gradient(140deg, #5F1C35 0%, #812549 60%, #5F1C35 100%)",
            boxShadow: "0 8px 32px rgba(30,26,26,0.25)",
          }}
        >
          <p className="text-white font-bold mb-1">
            {cooking ? `Clara is cooking your ${cookingCuisine ?? ""} day…` : "Your ingredients can't fill a whole day yet"}
          </p>
          <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.55)" }}>
            {cooking ? (
              "Building breakfast to dinner from exactly what you have — a few seconds."
            ) : (
              <>
                {cookable.dayCoverage.coveredCalories > 0
                  ? `These dishes cover ~${cookable.dayCoverage.coveredCalories} of your ${cookable.dayCoverage.targetCalories} kcal day.`
                  : `Your day needs ${cookable.dayCoverage.targetCalories} kcal.`}{" "}
                Pick a cuisine and Clara cooks the whole day from your ingredients.
              </>
            )}
          </p>

          {cooking ? (
            <div className="flex justify-center mb-1" role="status" aria-label="Generating">
              <svg className="animate-spin h-6 w-6 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 mb-2" role="group" aria-label="Choose a cuisine">
              {CUISINES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void cookMyDay(c)}
                  className="px-3.5 py-1.5 rounded-full text-sm font-semibold bg-white/10 text-white border border-white/20 hover:bg-white hover:text-[#812549] transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {cookError && (
            <div role="alert" className="bg-white/10 border border-white/20 text-white rounded-xl px-4 py-2.5 text-xs mt-3">
              {cookError}
            </div>
          )}
          <p className="text-[10px] mt-3" style={{ color: "rgba(255,255,255,0.38)" }}>
            Once a day · uses only your ingredients · allergies always respected
          </p>
        </section>
      )}

      {cookDay && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#1E1A1A]">Your day, cooked by Clara</h2>
            <span className="text-xs font-bold tabular-nums" style={{ color: "#812549" }}>
              {cookDay.totalCalories} / {cookDay.targetCalories} kcal
            </span>
          </div>
          {cookDay.slotsFilled < cookDay.slotsRequested && (
            <p className="text-xs mb-3" style={{ color: "#848181" }}>
              Clara filled {cookDay.slotsFilled} of {cookDay.slotsRequested} meals safely from your ingredients — add a few more for full coverage.
            </p>
          )}
          <div className="space-y-3">
            {cookDay.meals.map((m) => (
              <div
                key={m.id}
                className="bg-white rounded-2xl p-4 flex items-start gap-3"
                style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                  style={{ background: "rgba(129,37,73,0.08)" }}
                >
                  {m.emoji ?? "🍽"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {m.mealType && (
                      <span className="text-[9px] tracking-[0.18em] uppercase font-bold" style={{ color: "#B75E78" }}>
                        {m.mealType}
                      </span>
                    )}
                    {m.calories != null && (
                      <span className="text-[10px] tabular-nums" style={{ color: "#ABA6A6" }}>
                        {Math.round(m.calories)} kcal
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-[#1E1A1A] text-sm mt-0.5">{m.name}</p>
                  {m.description && (
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: "#848181" }}>
                      {m.description}
                    </p>
                  )}
                  <p className="text-[10px] mt-1.5" style={{ color: "#ABA6A6" }}>
                    {m.ingredients.join(" · ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {cookable && cookable.almost.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-[#1E1A1A] mb-3">
            Almost there <span className="text-xs font-normal" style={{ color: "#ABA6A6" }}>— missing 1–2 ingredients</span>
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">{cookable.almost.map((d) => dishCard(d, true))}</div>
        </section>
      )}

      {/* Required-ingredients counter — how close the basket is to filling a
          full week. Sticks to the bottom while selecting (onboarding + New-week). */}
      {(() => {
        const status = computeBasketReadiness(Array.from(selected.values()));
        return (
          <div
            className="sticky bottom-0 z-10 mt-4 px-4 py-3 rounded-2xl border backdrop-blur"
            style={{
              borderColor: status.ready ? "#2E7D5B" : "#EAE4CA",
              background: status.ready ? "rgba(46,125,91,0.08)" : "rgba(255,255,255,0.92)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold" style={{ color: status.ready ? "#2E7D5B" : "#5F1C35" }}>
                {status.count} / {status.min} ingredients{status.ready ? " ✓" : ""}
              </span>
              <span className="text-xs text-right" style={{ color: "#848181" }}>
                {status.ready
                  ? "Enough to fill a full week"
                  : `Add ${Math.max(0, status.min - status.count)} more${
                      status.missingCategories.length ? ` (a ${status.missingCategories.join(", ")})` : ""
                    }`}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0EFF5" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (status.count / status.min) * 100)}%`,
                  background: status.ready ? "#2E7D5B" : "#812549",
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* Continue */}
      <div className="pt-4">
        <Link
          href="/meal-plan"
          className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition-colors shadow-lg shadow-primary/25"
        >
          {isOnboarding ? "Continue to my meal plan →" : "Back to my meal plan →"}
        </Link>
        <p className="text-xs mt-2" style={{ color: "#ABA6A6" }}>
          Update this anytime — after shopping, tap what you bought and more dishes unlock.
        </p>
      </div>
    </div>
  );
}
