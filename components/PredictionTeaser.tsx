"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

function SpinCount({ target }: { target: number }) {
  const [count, setCount] = useState(0);
  const spanRef = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          let step = 0;
          const steps = 55;
          const duration = 2000;
          const interval = duration / steps;

          const tick = () => {
            step++;
            const progress = 1 - Math.pow(1 - step / steps, 3);
            setCount(Math.round(progress * target));
            if (step < steps) {
              setTimeout(tick, interval);
            } else {
              setCount(target);
            }
          };

          setTimeout(tick, 500);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={spanRef} className="tabular-nums">
      {count}
    </span>
  );
}

export default function PredictionTeaser() {
  const t = useTranslations("predictionTeaser");
  return (
    <section className="bg-[#0d1a10] py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 items-center">

        {/* Left: copy */}
        <div>
          <p className="text-[#4ade80] text-sm font-semibold uppercase tracking-widest mb-4">
            {t("eyebrow")}
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] mb-6">
            {t("headline")}
          </h2>
          <p className="text-white/40 text-lg leading-relaxed mb-8 max-w-md">
            {t("subheadline")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0d1a10] px-7 py-3.5 rounded-xl font-semibold text-sm transition-colors shadow-lg shadow-[#4ade80]/20"
            >
              {t("getPrediction")}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>

        {/* Right: demo card */}
        <div className="flex justify-center lg:justify-end">
          <div className="relative w-full max-w-sm">
            {/* Glow */}
            <div className="absolute inset-0 rounded-3xl bg-[#4ade80]/10 blur-[60px] pointer-events-none" />

            {/* Card */}
            <div className="relative bg-white/[0.04] border border-white/10 rounded-3xl p-8 text-center backdrop-blur-sm">
              <p className="text-[#4ade80] text-xs font-semibold uppercase tracking-widest mb-6">
                {t("cardEyebrow")}
              </p>

              <div className="mb-2">
                <span className="text-[72px] font-black text-white leading-none">
                  <SpinCount target={47} />
                </span>
              </div>
              <p className="text-2xl font-bold text-white/50 mb-6">{t("days")}</p>

              <p className="text-white/30 text-sm mb-8">
                {t("cardSubtext")}
              </p>

              {/* Mini stats */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { label: t("current"), value: "85 kg" },
                  { label: t("goal"), value: "72 kg" },
                  { label: t("weekly"), value: "−0.5 kg" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white/[0.04] rounded-xl p-2.5">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
                    <p className="text-white text-sm font-bold">{value}</p>
                  </div>
                ))}
              </div>

              <div className="h-px bg-white/8 mb-4" />

              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
                <span className="text-white/30 text-xs">{t("sampleText")}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
