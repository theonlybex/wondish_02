import Link from "next/link";
import DishCard from "./DishCard";
import { dishes } from "@/data/dishes";

export default function DishesPreview() {
  // Duplicate for seamless infinite loop
  const row1 = [...dishes, ...dishes];
  const row2 = [...dishes.slice(Math.floor(dishes.length / 2)), ...dishes, ...dishes.slice(0, Math.floor(dishes.length / 2)), ...dishes];

  return (
    <section className="bg-white py-24 overflow-hidden">
      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-row {
          display: flex;
          width: max-content;
          gap: 16px;
        }
        .marquee-row-1 {
          animation: marquee 40s linear infinite;
        }
        .marquee-row-2 {
          animation: marquee 28s linear infinite;
        }
        .marquee-wrap:hover .marquee-row {
          animation-play-state: paused;
        }
      `}</style>

      {/* Header */}
      <div className="px-5 sm:px-8 max-w-6xl mx-auto mb-12">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
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
      </div>

      {/* Scrolling tray */}
      <div className="marquee-wrap flex flex-col gap-4">
        {/* Row 1 */}
        <div className="overflow-hidden">
          <div className="marquee-row marquee-row-1">
            {row1.map((dish, i) => (
              <div key={`r1-${dish.id}-${i}`} className="w-64 flex-shrink-0">
                <DishCard dish={dish} compact />
              </div>
            ))}
          </div>
        </div>

        {/* Row 2 — offset start, faster */}
        <div className="overflow-hidden">
          <div className="marquee-row marquee-row-2">
            {row2.map((dish, i) => (
              <div key={`r2-${dish.id}-${i}`} className="w-64 flex-shrink-0">
                <DishCard dish={dish} compact />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
