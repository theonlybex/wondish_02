"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Hero() {
  const t = useTranslations("hero");

  return (
    <div className="relative bg-[#0a1509] min-h-screen px-6 flex flex-col items-center justify-center text-center overflow-hidden">

      {/* Atmosphere — large green glow behind heading */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(ellipse, rgba(74,222,128,0.12) 0%, rgba(74,222,128,0.04) 40%, transparent 70%)" }}
        />
        <div
          className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] rounded-full"
          style={{ background: "radial-gradient(ellipse, rgba(74,222,128,0.08) 0%, transparent 65%)" }}
        />
        {/* Subtle corner accents */}
        <div
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.04) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(74,222,128,0.03) 0%, transparent 70%)" }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center">

        {/* Eyebrow */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-px w-10 bg-[#4ade80]/30" />
          <span className="text-[#4ade80]/60 text-[11px] font-semibold uppercase tracking-[0.22em]">
            {t("eyebrow")}
          </span>
          <div className="h-px w-10 bg-[#4ade80]/30" />
        </div>

        {/* Headline */}
        <h1 className="text-[clamp(3rem,8vw,6.5rem)] font-extrabold text-white leading-[1.02] tracking-tight">
          {t("headline1")}
          <br />
          <span
            className="text-[#4ade80]"
            style={{ textShadow: "0 0 100px rgba(74,222,128,0.4), 0 0 40px rgba(74,222,128,0.15)" }}
          >
            {t("headline2")}
          </span>
        </h1>

        {/* Subheadline */}
        <p className="mt-7 text-base sm:text-lg text-white/40 max-w-lg leading-relaxed">
          {t("subheadline")}
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          {/* Primary: Get Started */}
          <Link
            href="/register"
            className="group relative inline-flex items-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0a1509] px-8 py-4 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg shadow-[#4ade80]/20 hover:shadow-[#4ade80]/30"
          >
            <span className="absolute inset-0 rounded-xl border border-[#4ade80]/30" />
            {t("getStarted")} →
          </Link>

          {/* Secondary: See How It Works */}
          <Link
            href="#how-it-works"
            className="inline-flex items-center gap-2 bg-white/[0.04] hover:bg-white/[0.08] text-white/80 hover:text-white px-8 py-4 rounded-xl font-semibold text-sm transition-all duration-200 border border-white/[0.10] hover:border-white/[0.18]"
          >
            {t("seeHowItWorks")}
          </Link>
        </div>

      </div>
    </div>
  );
}
