"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

const EMOJIS = [
  { emoji: "🥑", top: "8%",  left: "5%",  size: "2.6rem", opacity: 0.85, initRotate: -15, speed: 0.12, dir:  1, glow: "74,222,128",  floatDelay: 0    },
  { emoji: "🍋", top: "12%", left: "17%", size: "2rem",   opacity: 0.75, initRotate:  12, speed: 0.09, dir:  1, glow: "250,204,21",  floatDelay: 0.8  },
  { emoji: "🥗", top: "4%",  left: "37%", size: "2.4rem", opacity: 0.70, initRotate:  -8, speed: 0.07, dir: -1, glow: "74,222,128",  floatDelay: 1.6  },
  { emoji: "🍅", top: "9%",  left: "61%", size: "2.2rem", opacity: 0.80, initRotate:  20, speed: 0.10, dir: -1, glow: "248,113,113", floatDelay: 0.4  },
  { emoji: "🫐", top: "5%",  left: "80%", size: "2.6rem", opacity: 0.75, initRotate:  -5, speed: 0.11, dir: -1, glow: "129,140,248", floatDelay: 2.0  },
  { emoji: "🧄", top: "19%", left: "91%", size: "2rem",   opacity: 0.70, initRotate:  10, speed: 0.08, dir: -1, glow: "253,230,138", floatDelay: 1.2  },
  { emoji: "🥦", top: "41%", left: "2%",  size: "2.4rem", opacity: 0.70, initRotate:   8, speed: 0.09, dir:  1, glow: "74,222,128",  floatDelay: 0.6  },
  { emoji: "🫒", top: "54%", left: "87%", size: "2.2rem", opacity: 0.75, initRotate: -12, speed: 0.10, dir: -1, glow: "163,230,53",  floatDelay: 1.4  },
  { emoji: "🍳", top: "69%", left: "6%",  size: "2.6rem", opacity: 0.70, initRotate: -20, speed: 0.08, dir:  1, glow: "251,146,60",  floatDelay: 1.8  },
  { emoji: "🥕", top: "74%", left: "21%", size: "2rem",   opacity: 0.75, initRotate:  15, speed: 0.11, dir:  1, glow: "251,146,60",  floatDelay: 0.2  },
  { emoji: "🌿", top: "79%", left: "57%", size: "2.4rem", opacity: 0.70, initRotate: -10, speed: 0.07, dir: -1, glow: "74,222,128",  floatDelay: 1.0  },
  { emoji: "🍇", top: "71%", left: "77%", size: "2.2rem", opacity: 0.80, initRotate:  18, speed: 0.09, dir: -1, glow: "192,132,252", floatDelay: 2.2  },
  { emoji: "🧅", top: "87%", left: "89%", size: "2rem",   opacity: 0.70, initRotate:  -8, speed: 0.10, dir: -1, glow: "253,230,138", floatDelay: 0.9  },
  { emoji: "🥩", top: "89%", left: "41%", size: "2.6rem", opacity: 0.70, initRotate:  12, speed: 0.08, dir:  1, glow: "248,113,113", floatDelay: 1.7  },
  { emoji: "🫚", top: "34%", left: "94%", size: "2rem",   opacity: 0.65, initRotate:  -6, speed: 0.09, dir: -1, glow: "253,230,138", floatDelay: 0.5  },
];

export default function Hero() {
  const t = useTranslations("hero");
  const orbRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      orbRefs.current.forEach((el, i) => {
        if (!el) return;
        const { initRotate, speed, dir } = EMOJIS[i];
        el.style.transform = `rotate(${initRotate + scrollY * speed * dir}deg)`;
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="relative bg-[#0a1509] min-h-screen px-6 flex flex-col items-center justify-center text-center overflow-hidden">

      <style>{`
        @keyframes floatOrb {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-12px); }
        }
        @keyframes ctaRing {
          0%   { opacity: 0.7; transform: scale(1); }
          100% { opacity: 0;   transform: scale(1.7); }
        }
      `}</style>

      {/* Atmosphere */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(ellipse, rgba(74,222,128,0.07) 0%, transparent 68%)" }} />
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.05) 0%, transparent 70%)" }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.04) 0%, transparent 70%)" }} />
      </div>

      {/* Emoji orbs — outer div floats, inner div rolls on scroll */}
      {EMOJIS.map(({ emoji, top, left, size, opacity, initRotate, glow, floatDelay }, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            top,
            left,
            opacity,
            animation: `floatOrb ${3.8 + floatDelay * 0.35}s ease-in-out ${floatDelay}s infinite`,
          }}
        >
          <div
            ref={(el) => { orbRefs.current[i] = el; }}
            className="flex items-center justify-center rounded-full"
            style={{
              width:  `calc(${size} + 1.8rem)`,
              height: `calc(${size} + 1.8rem)`,
              transform: `rotate(${initRotate}deg)`,
              background: `radial-gradient(circle at 35% 32%, rgba(${glow},0.18) 0%, rgba(10,21,9,0.72) 100%)`,
              boxShadow: `0 0 0 1px rgba(${glow},0.22), 0 0 24px rgba(${glow},0.09), inset 0 1px 0 rgba(255,255,255,0.09)`,
              willChange: "transform",
            }}
          >
            <span style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>
          </div>
        </div>
      ))}

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center">

        {/* Eyebrow */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-px w-10 bg-[#4ade80]/30" />
          <span className="text-[#4ade80]/60 text-[11px] font-semibold uppercase tracking-[0.22em]">
            AI-Powered Meal Planning
          </span>
          <div className="h-px w-10 bg-[#4ade80]/30" />
        </div>

        <h1 className="text-[clamp(2.8rem,8vw,6rem)] font-bold text-white leading-[1.05] tracking-tight">
          {t("headline1")}
          <br />
          <span
            className="text-[#4ade80]"
            style={{ textShadow: "0 0 80px rgba(74,222,128,0.35)" }}
          >
            {t("headline2")}
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-white/35 max-w-lg leading-relaxed">
          {t("subheadline")}
        </p>

        <div className="mt-10">
          <div className="relative inline-flex">
            {/* Pulsing ring */}
            <div
              className="absolute inset-0 rounded-xl bg-[#4ade80]"
              style={{ animation: "ctaRing 2.2s ease-out infinite" }}
            />
            <Link
              href="/register"
              className="relative inline-flex items-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0a1509] px-8 py-4 rounded-xl font-bold text-sm transition-colors duration-150 shadow-lg shadow-[#4ade80]/20"
            >
              {t("getStarted")}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
