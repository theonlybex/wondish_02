"use client";

import { useState } from "react";
import { format, addWeeks, subWeeks, startOfWeek, addDays } from "date-fns";
import { MenuEntry } from "@/types";

interface WeeklyMealPlanGridProps {
  initialMenus: MenuEntry[];
  initialWeekStart: Date;
}

export default function WeeklyMealPlanGrid({
  initialMenus,
  initialWeekStart,
}: WeeklyMealPlanGridProps) {
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [menus, setMenus] = useState(initialMenus);
  const [loading, setLoading] = useState(false);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Group menus by mealType name and date string
  const grouped: Record<string, Record<string, MenuEntry>> = {};
  const mealTypeOrder: string[] = [];
  for (const menu of menus) {
    const mtName = menu.mealType?.name ?? "Other";
    if (!grouped[mtName]) {
      grouped[mtName] = {};
      mealTypeOrder.push(mtName);
    }
    const dateKey = format(new Date(menu.date), "yyyy-MM-dd");
    grouped[mtName][dateKey] = menu;
  }

  // Same browsing horizon as the daily view (one week ahead of today):
  // the next calendar week is viewable, anything beyond is not.
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const maxBrowseDate = addDays(todayMidnight, 7);
  const atForwardLimit = addWeeks(weekStart, 1) > maxBrowseDate;

  const navigate = async (dir: "prev" | "next") => {
    if (dir === "next" && atForwardLimit) return;
    const newWeekStart =
      dir === "next" ? addWeeks(weekStart, 1) : subWeeks(weekStart, 1);
    setWeekStart(newWeekStart);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/meal-plan?weekStart=${format(newWeekStart, "yyyy-MM-dd")}`
      );
      const data = await res.json();
      setMenus(data.menus ?? []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Week navigation */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("prev")}
          className="w-9 h-9 rounded-xl border border-[#EAE4CA] flex items-center justify-center hover:bg-[#F3F2FF] transition-colors text-navy"
        >
          ‹
        </button>
        <p className="font-semibold text-navy">
          {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
        </p>
        <button
          onClick={() => navigate("next")}
          disabled={atForwardLimit}
          aria-disabled={atForwardLimit}
          aria-label={atForwardLimit ? "You can browse up to one week ahead" : "Next week"}
          title={atForwardLimit ? "You can browse up to one week ahead" : undefined}
          className={`w-9 h-9 rounded-xl border border-[#EAE4CA] flex items-center justify-center transition-colors text-navy ${
            atForwardLimit ? "opacity-40 cursor-not-allowed" : "hover:bg-[#F3F2FF]"
          }`}
        >
          ›
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#848181]">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[700px]">
            <thead>
              <tr>
                <th className="w-24 text-left py-2 px-3 text-[#848181] text-xs font-semibold uppercase tracking-wide">
                  Meal
                </th>
                {days.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="text-center py-2 px-2 text-xs font-semibold text-[#848181] uppercase"
                  >
                    <span className="block">{format(day, "EEE")}</span>
                    <span className="block text-navy font-bold text-sm">{format(day, "d")}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mealTypeOrder.map((mtName) => (
                <tr key={mtName} className="border-t border-[#EAE4CA]">
                  <td className="py-3 px-3 text-xs font-semibold text-[#848181] uppercase tracking-wide align-top">
                    {mtName}
                  </td>
                  {days.map((day) => {
                    const dateKey = format(day, "yyyy-MM-dd");
                    const menu = grouped[mtName]?.[dateKey];
                    return (
                      <td key={dateKey} className="py-3 px-2 align-top">
                        {menu ? (
                          <div className="flex flex-col items-center text-center">
                            <span className="text-2xl">{menu.recipe.emoji ?? "🍽"}</span>
                            <p className="text-navy text-xs font-medium mt-1 line-clamp-2">
                              {menu.recipe.name}
                            </p>
                            {menu.recipe.ethnic?.name && (
                              <span className="mt-1 px-1.5 py-0.5 rounded-full bg-[#F3F2FF] text-primary text-[10px] font-medium">
                                {menu.recipe.ethnic.name}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-center text-[#D0CDD7] text-lg">—</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {mealTypeOrder.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-[#848181] text-sm">
                    No meal plan for this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
