import Link from "next/link";
import DishCard from "./DishCard";
import { featuredDishes } from "@/data/dishes";

export default function DishesPreview() {
  return (
    <section className="bg-white py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12">
          <div className="max-w-xl">
            <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-4">
              The menu
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold text-[#25293C] leading-tight">
              Nutritious and delicious
            </h2>
          </div>
          <Link
            href="/dishes"
            className="inline-flex items-center gap-2 text-primary hover:text-primary-dark font-semibold text-sm transition-colors shrink-0"
          >
            View all dishes
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>

        {/* Dishes grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {featuredDishes.slice(0, 6).map((dish) => (
            <DishCard key={dish.id} dish={dish} />
          ))}
        </div>
      </div>
    </section>
  );
}
