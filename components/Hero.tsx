"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Hero() {
  const t = useTranslations("hero");

  return (
    <div className="bg-[#0d1a10] py-28 px-6 flex flex-col items-center justify-center text-center">
      <h1 className="text-[clamp(2.8rem,8vw,6rem)] font-bold text-white leading-[1.05] tracking-tight">
        {t("headline1")}
        <br />
        <span className="text-[#4ade80]">{t("headline2")}</span>
      </h1>
      <p className="mt-6 text-base sm:text-lg text-white/35 max-w-lg leading-relaxed">
        {t("subheadline")}
      </p>

      <div className="grid grid-cols-2 gap-8 mt-10 mb-8">
        {[
          { value: "500+", label: t("statsRecipes") },
          { value: "$15", label: t("statsPerMonth") },
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
          {t("getStarted")}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
        <Link
          href="/dishes"
          className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 px-7 py-3.5 rounded-xl font-semibold text-sm transition-colors duration-150 border border-white/[0.08] hover:border-white/15"
        >
          {t("browseDishes")}
        </Link>
      </div>
    </div>
  );
}
