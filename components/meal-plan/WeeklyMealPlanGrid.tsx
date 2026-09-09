"use client";

import { format } from "date-fns";
import Link from "next/link";

// One menu row as loaded by the weekly page (typed loosely; the page casts).
interface WeekMenu {
  id: string;
  date: string | Date;
  mealType?: { name: string } | null;
  recipe: { name: string; calories?: number | null; ethnic?: { name: string } | null };
}

const ORDER = ["breakfast", "lunch", "dinner", "snack"];
const mealRank = (n?: string) => {
  const i = ORDER.indexOf((n ?? "").toLowerCase());
  return i < 0 ? 99 : i;
};
const SHADOW = "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)";

// Weekly overview in the app's card language: one card per day (cream header,
// burgundy accent for today), meals listed as rows like the daily MealCard.
// Vertical + mobile-first — no spreadsheet table, no horizontal scroll.
export default function WeeklyMealPlanGrid({ menus }: { menus: WeekMenu[] }) {
  if (menus.length === 0) {
    return (
      <div className="text-center py-16 px-6 bg-white rounded-2xl border border-[#EAE4CA]" style={{ boxShadow: SHADOW }}>
        <p className="text-navy font-semibold mb-2">No week generated yet</p>
        <p className="text-[#848181] text-sm mb-5">
          Head to your meal plan and generate your week from your ingredients.
        </p>
        <Link href="/meal-plan" className="inline-block px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition-colors">
          Go to meal plan →
        </Link>
      </div>
    );
  }

  const byDate = new Map<string, WeekMenu[]>();
  for (const m of menus) {
    const k = format(new Date(m.date), "yyyy-MM-dd");
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(m);
  }
  const dateKeys = Array.from(byDate.keys()).sort();
  const todayKey = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-3">
      {dateKeys.map((k) => {
        const day = new Date(`${k}T00:00:00`);
        const isToday = k === todayKey;
        const meals = byDate.get(k)!;
        const dayKcal = meals.reduce((s, m) => s + (m.recipe.calories ?? 0), 0);
        // Group by meal type — a single meal can be several dishes (a complete
        // meal + a side/filler, or a dish + a beverage), all stamped with the
        // slot's meal type. Show the label once with its dishes listed under it.
        const groups = new Map<string, WeekMenu[]>();
        for (const m of meals) {
          const name = m.mealType?.name ?? "Other";
          if (!groups.has(name)) groups.set(name, []);
          groups.get(name)!.push(m);
        }
        const orderedGroups = Array.from(groups.entries()).sort((a, b) => mealRank(a[0]) - mealRank(b[0]));

        return (
          <div
            key={k}
            className="bg-white rounded-2xl overflow-hidden border"
            style={{ borderColor: isToday ? "rgba(129,37,73,0.35)" : "#EAE4CA", boxShadow: SHADOW }}
          >
            {/* Day header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ background: isToday ? "rgba(129,37,73,0.06)" : "#F9F7ED" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex flex-col items-center justify-center w-11 h-11 rounded-xl shrink-0"
                  style={{ background: isToday ? "#812549" : "#fff", border: isToday ? "none" : "1px solid #EAE4CA" }}
                >
                  <span className="text-[9px] font-bold uppercase leading-none" style={{ color: isToday ? "rgba(255,255,255,0.75)" : "#ABA6A6" }}>
                    {format(day, "EEE")}
                  </span>
                  <span className="text-base font-bold leading-none mt-0.5" style={{ color: isToday ? "#fff" : "#1E1A1A" }}>
                    {format(day, "d")}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1E1A1A] leading-tight">{format(day, "EEEE")}</p>
                  {isToday && (
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#812549" }}>Today</span>
                  )}
                </div>
              </div>
              {dayKcal > 0 && (
                <span className="text-xs font-semibold tabular-nums" style={{ color: "#848181" }}>
                  {Math.round(dayKcal)} kcal
                </span>
              )}
            </div>

            {/* Meals — one row per meal type, dishes stacked under it */}
            <div className="divide-y divide-[#EAE4CA]">
              {orderedGroups.map(([mtName, dishes]) => (
                <div key={mtName} className="flex gap-3 px-4 py-3">
                  <span className="w-16 shrink-0 pt-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "#ABA6A6" }}>
                    {mtName}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {dishes.map((m) => (
                      <div key={m.id} className="flex items-center gap-2">
                        <p className="flex-1 min-w-0 text-sm font-semibold text-navy truncate">
                          {m.recipe.name}
                          {m.recipe.ethnic?.name && (
                            <span className="ml-1.5 text-[10px] font-medium align-middle" style={{ color: "#812549" }}>
                              {m.recipe.ethnic.name}
                            </span>
                          )}
                        </p>
                        {m.recipe.calories ? (
                          <span className="text-[11px] shrink-0 tabular-nums" style={{ color: "#848181" }}>
                            {m.recipe.calories} kcal
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
