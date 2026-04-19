"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef } from "react";
import { useScroll, useTransform, motion } from "framer-motion";

const INGREDIENTS = [
  { src: "/dish/tomato.png",   label: "Tomato",   x: -320, y: -200, delay: 0 },
  { src: "/dish/salmon.png",   label: "Salmon",   x:  320, y: -180, delay: 0.05 },
  { src: "/dish/dill.png",     label: "Dill",     x:    0, y: -280, delay: 0.1 },
  { src: "/dish/quinoa.png",   label: "Quinoa",   x: -280, y:  160, delay: 0.08 },
  { src: "/dish/avocado.png",  label: "Avocado",  x:  280, y:  180, delay: 0.12 },
  { src: "/dish/cucumber.png", label: "Cucumber", x: -380, y:   20, delay: 0.04 },
  { src: "/dish/lemon.png",    label: "Lemon",    x:  380, y:   10, delay: 0.06 },
  { src: "/dish/quinoa.png",   label: "Quinoa2",  x:  160, y: -260, delay: 0.09 },
];

export default function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // Headline fades out as we start scrolling into the animation
  const headlineOpacity = useTransform(scrollYProgress, [0, 0.18], [1, 0]);
  const headlineY = useTransform(scrollYProgress, [0, 0.18], [0, -40]);

  // Plate scale + opacity
  const plateOpacity = useTransform(scrollYProgress, [0.15, 0.35], [0, 1]);
  const plateScale = useTransform(scrollYProgress, [0.15, 0.35], [0.4, 1]);

  // Assembled glow
  const glowOpacity = useTransform(scrollYProgress, [0.65, 0.8], [0, 1]);

  // CTA fades in after assembly
  const ctaOpacity = useTransform(scrollYProgress, [0.75, 0.9], [0, 1]);
  const ctaY = useTransform(scrollYProgress, [0.75, 0.9], [30, 0]);

  // Dish label
  const dishLabelOpacity = useTransform(scrollYProgress, [0.65, 0.8], [0, 1]);

  return (
    <>
      {/* ─── Scroll container — 380vh gives room for the animation ─── */}
      <div ref={containerRef} style={{ height: "380vh" }}>
        <div className="sticky top-0 h-screen overflow-hidden bg-[#0d1a10] flex flex-col items-center justify-center">

          {/* ── Headline (fades as scroll begins) ── */}
          <motion.div
            style={{ opacity: headlineOpacity, y: headlineY }}
            className="absolute top-0 left-0 right-0 flex flex-col items-center justify-center h-full px-6 text-center pointer-events-none z-10"
          >
            <div className="flex items-center gap-2 mb-8 bg-white/5 border border-white/10 rounded-full px-4 py-2">
              <span className="text-yellow-400 text-sm">★★★★★</span>
              <span className="text-white/60 text-xs font-medium">Rated 4.9/5 by 10,000+ members</span>
            </div>
            <h1 className="text-[clamp(2.8rem,8vw,6rem)] font-bold text-white leading-[1.05] tracking-tight">
              Every great meal
              <br />
              <span className="text-[#4ade80]">starts here.</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-white/35 max-w-lg leading-relaxed">
              AI-powered meal plans built around your body, goals, and taste —
              scroll to see how it comes together.
            </p>
            <div className="mt-3 flex flex-col items-center gap-1 animate-bounce">
              <span className="text-xs text-white/20 tracking-widest uppercase">scroll</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M4 9l4 4 4-4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </motion.div>

          {/* ── Assembly stage ── */}
          <div className="relative flex items-center justify-center w-full h-full">

            {/* Glow behind plate when assembled */}
            <motion.div
              style={{ opacity: glowOpacity }}
              className="absolute w-64 h-64 rounded-full bg-[#4ade80]/15 blur-[90px] pointer-events-none"
            />

            {/* Plate — shows dish image when assembled */}
            <motion.div
              style={{ opacity: plateOpacity, scale: plateScale }}
              className="relative z-10 w-36 h-36 rounded-full overflow-hidden border border-white/[0.08] shadow-2xl shadow-black/60"
            >
              <Image src="/dish/dish.png" alt="Mediterranean Salmon Bowl" fill className="object-cover" />
            </motion.div>

            {/* Ingredients */}
            {INGREDIENTS.map(({ src, label, x, y, delay }) => (
              <Ingredient
                key={label}
                src={src}
                startX={x}
                startY={y}
                scrollProgress={scrollYProgress}
                delay={delay}
              />
            ))}

            {/* Dish name after assembly */}
            <motion.div
              style={{ opacity: dishLabelOpacity }}
              className="absolute bottom-[calc(50%-90px)] left-0 right-0 text-center pointer-events-none"
            >
              <span className="text-xs uppercase tracking-[0.3em] text-white/25 font-medium">
                assembled
              </span>
            </motion.div>
          </div>

          {/* ── CTA after dish is built ── */}
          <motion.div
            style={{ opacity: ctaOpacity, y: ctaY }}
            className="absolute bottom-16 left-0 right-0 flex flex-col items-center gap-5 px-6 z-20"
          >
            <div className="grid grid-cols-3 gap-8 mb-2">
              {[
                { value: "500+", label: "Recipes" },
                { value: "10k+", label: "Members" },
                { value: "$15", label: "Per month" },
              ].map(({ value, label }) => (
                <div key={label} className="text-center">
                  <p className="text-xl font-bold text-white">{value}</p>
                  <p className="text-xs text-white/30 mt-0.5 uppercase tracking-wider">{label}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0d1a10] px-7 py-3.5 rounded-xl font-semibold text-sm transition-colors duration-150 shadow-lg shadow-[#4ade80]/20"
              >
                Get started free
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
              <Link
                href="/dishes"
                className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 px-7 py-3.5 rounded-xl font-semibold text-sm transition-colors duration-150 border border-white/[0.08] hover:border-white/15"
              >
                Browse dishes
              </Link>
            </div>
          </motion.div>

        </div>
      </div>
    </>
  );
}

// ─── Individual ingredient that flies toward center ───────────────────────────

function Ingredient({
  src,
  startX,
  startY,
  scrollProgress,
  delay,
}: {
  src: string;
  startX: number;
  startY: number;
  scrollProgress: ReturnType<typeof useScroll>["scrollYProgress"];
  delay: number;
}) {
  const start = 0.2 + delay;
  const end   = 0.65 + delay * 0.3;

  const x       = useTransform(scrollProgress, [start, end], [startX, 0]);
  const y       = useTransform(scrollProgress, [start, end], [startY, 0]);
  const opacity = useTransform(scrollProgress, [start, end, end + 0.08], [0, 1, 0]);
  const scale   = useTransform(scrollProgress, [start, end - 0.1, end], [0.6, 1.1, 0.85]);

  return (
    <motion.div
      style={{ x, y, opacity, scale }}
      className="absolute w-16 h-16 rounded-full overflow-hidden pointer-events-none shadow-lg shadow-black/40"
    >
      <Image src={src} alt="ingredient" fill className="object-cover" />
    </motion.div>
  );
}
