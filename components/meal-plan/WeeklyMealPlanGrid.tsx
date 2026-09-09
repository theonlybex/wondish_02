"use client";

import { format } from "date-fns";
import Link from "next/link";
import { MenuEntry } from "@/types";

// Shows the current plan window — the days that actually have menus in the
// active version (a rolling 7-day week starts on the generation day, not a
// fixed Monday), from today forward. No week navigation: there is exactly one
// window; the next week doesn't exist until it's generated.
export default function WeeklyMealPlanGrid({ menus }: { menus: MenuEntry[] }) {
  const dateKeys = Array.from(
    new Set(menus.map((m) => format(new Date(m.date), "yyyy-MM-dd")))
  ).sort();
  const days = dateKeys.map((k) => new Date(`${k}T00:00:00`));
  const todayKey = format(new Date(), "yyyy-MM-dd");

  // Group menus by meal-type name → date, ordered breakfast→lunch→dinner→snack.
  const ORDER = ["breakfast", "lunch", "dinner", "snack"];
  const grouped: Record<string, Record<string, MenuEntry>> = {};
  for (const menu of menus) {
    const mtName = menu.mealType?.name ?? "Other";
    if (!grouped[mtName]) grouped[mtName] = {};
    grouped[mtName][format(new Date(menu.date), "yyyy-MM-dd")] = menu;
  }
  const mealTypeOrder = Object.keys(grouped).sort(
    (a, b) =>
      ((ORDER.indexOf(a.toLowerCase()) + 1) || 99) - ((ORDER.indexOf(b.toLowerCase()) + 1) || 99)
  );

  if (menus.length === 0) {
    return (
      <div className="text-center py-16 px-6">
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[700px]">
        <thead>
          <tr>
            <th className="w-24 text-left py-2 px-3 text-[#848181] text-xs font-semibold uppercase tracking-wide">
              Meal
            </th>
            {days.map((day) => {
              const isToday = format(day, "yyyy-MM-dd") === todayKey;
              return (
                <th key={day.toISOString()} className="text-center py-2 px-2">
                  <span
                    className="inline-flex flex-col items-center justify-center w-10 py-1 rounded-lg"
                    style={
                      isToday
                        ? { background: "rgba(129,37,73,0.12)", border: "1px solid rgba(129,37,73,0.3)" }
                        : undefined
                    }
                  >
                    <span
                      className="block text-[10px] font-semibold uppercase"
                      style={{ color: isToday ? "#812549" : "#848181" }}
                    >
                      {format(day, "EEE")}
                    </span>
                    <span
                      className="block font-bold text-sm"
                      style={{ color: isToday ? "#812549" : "#1E1A1A" }}
                    >
                      {format(day, "d")}
                    </span>
                  </span>
                </th>
              );
            })}
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
                        <p className="text-navy text-xs font-medium line-clamp-2">
                          {menu.recipe.name}
                        </p>
                        {menu.recipe.ethnic?.name && (
                          <span className="mt-1 px-1.5 py-0.5 rounded-full bg-[#F5F1DD] text-primary text-[10px] font-medium">
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
        </tbody>
      </table>
    </div>
  );
}
