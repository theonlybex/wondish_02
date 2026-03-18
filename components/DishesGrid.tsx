"use client";

import { useState } from "react";
import DishCard from "@/components/DishCard";
import type { Dish, MealTypeKey } from "@/types";

const filters: { label: string; value: MealTypeKey | "all" }[] = [
  { label: "All", value: "all" },
  { label: "🌅 Breakfast", value: "breakfast" },
  { label: "☀️ Lunch", value: "lunch" },
  { label: "🌙 Dinner", value: "dinner" },
  { label: "🍎 Snack", value: "snack" },
];

export default function DishesGrid({ dishes }: { dishes: Dish[] }) {
  const [activeFilter, setActiveFilter] = useState<MealTypeKey | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = dishes.filter((d) => {
    const matchesType = activeFilter === "all" || d.mealType === activeFilter;
    const matchesSearch =
      search.trim() === "" ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    return matchesType && matchesSearch;
  });

  return (
    <>
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1 max-w-sm">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A8D93]"
            width="16" height="16" viewBox="0 0 16 16" fill="none"
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search dishes or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E8E7EA] rounded-xl text-sm text-[#25293C] placeholder:text-[#BDBDBD] focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setActiveFilter(value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                activeFilter === value
                  ? "bg-primary text-white shadow-lg shadow-primary/25"
                  : "bg-white text-[#8A8D93] border border-[#E8E7EA] hover:border-primary/20 hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <p className="text-[#8A8D93] text-sm mb-6">
        {filtered.length} {filtered.length === 1 ? "dish" : "dishes"} found
      </p>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((dish) => (
            <DishCard key={dish.id} dish={dish} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <span className="text-5xl block mb-4">🍽️</span>
          <p className="text-[#25293C] font-semibold text-lg mb-2">No dishes found</p>
          <p className="text-[#8A8D93] text-sm">Try adjusting your search or filter.</p>
        </div>
      )}
    </>
  );
}
