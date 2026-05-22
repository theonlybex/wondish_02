"use client";

import { useEffect, useState } from "react";
import PublicDishTinder from "@/components/taste/PublicDishTinder";

interface Dish {
  id: string;
  name: string;
  emoji?: string | null;
  description?: string | null;
  calories?: number | null;
  tags: string[];
  mealType?: { name: string } | null;
  ethnic?: { name: string } | null;
}

export default function DishTinderPromo() {
  // Prefetch dishes immediately on page load so they're ready by the time user scrolls here
  const [dishes, setDishes] = useState<Dish[]>([]);

  useEffect(() => {
    fetch("/api/taste/public-dishes")
      .then((r) => r.json())
      .then((data) => setDishes(data.dishes ?? []))
      .catch(() => {});
  }, []);

  return (
    <section className="relative bg-[#0a1509] min-h-[110vh] py-20 px-5 sm:px-8 overflow-hidden flex items-center">
      <style>{`
        @keyframes floatEmoji { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
      `}</style>

      {/* Atmospheric split halos */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-y-0 left-0 w-1/2"
          style={{ background: "radial-gradient(ellipse at 10% 50%, rgba(220,50,50,0.07) 0%, transparent 65%)" }} />
        <div className="absolute inset-y-0 right-0 w-1/2"
          style={{ background: "radial-gradient(ellipse at 90% 50%, rgba(74,222,128,0.09) 0%, transparent 65%)" }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.06) 0%, transparent 70%)" }} />
      </div>

      {/* Floating emojis */}
      {[
        { emoji: "🥑", top: "12%", left: "4%",   size: "2rem",   opacity: 0.35, delay: "0s",    dur: "5.2s"  },
        { emoji: "🍋", top: "70%", left: "6%",   size: "1.6rem", opacity: 0.25, delay: "1.4s",  dur: "6s"    },
        { emoji: "🫐", top: "20%", right: "5%",  size: "1.8rem", opacity: 0.30, delay: "0.6s",  dur: "4.8s"  },
        { emoji: "🍅", top: "75%", right: "7%",  size: "1.6rem", opacity: 0.25, delay: "2s",    dur: "5.6s"  },
        { emoji: "🥦", top: "45%", left: "2%",   size: "1.5rem", opacity: 0.20, delay: "0.9s",  dur: "7s"    },
        { emoji: "🧄", top: "38%", right: "3%",  size: "1.5rem", opacity: 0.20, delay: "1.8s",  dur: "5.8s"  },
      ].map(({ emoji, top, left, right, size, opacity, delay, dur }, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{ top, left, right, fontSize: size, opacity, animation: `floatEmoji ${dur} ease-in-out ${delay} infinite` }}
        >
          {emoji}
        </span>
      ))}

      {/* Content */}
      <div className="relative z-10 w-full max-w-6xl mx-auto flex flex-col items-center text-center">

        {/* Eyebrow */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-10 bg-[#4ade80]/30" />
          <span className="text-[#4ade80]/60 text-[11px] font-semibold uppercase tracking-[0.22em]">
            Taste Profile
          </span>
          <div className="h-px w-10 bg-[#4ade80]/30" />
        </div>

        <h2 className="text-4xl sm:text-5xl font-bold leading-[1.07] mb-4">
          <span className="text-white">Easy Start!</span>
          <br />
          <span className="text-[#4ade80]" style={{ textShadow: "0 0 60px rgba(74,222,128,0.3)" }}>
            Let us learn your preferences
          </span>
        </h2>
        <p className="text-white/35 text-base sm:text-lg max-w-md leading-relaxed mb-8">
          Rate dishes in minutes. Your meal plan instantly reflects your taste — no guessing, no foods you hate.
        </p>

        {/* Embedded swiper — dishes are prefetched */}
        <PublicDishTinder prefetchedDishes={dishes} />

      </div>
    </section>
  );
}
