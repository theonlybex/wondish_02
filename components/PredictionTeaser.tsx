"use client";

import { useTranslations } from "next-intl";
import PredictionQuiz from "./PredictionQuiz";

export default function PredictionTeaser() {
  const t = useTranslations("predictionTeaser");
  return (
    <section className="bg-[#0d1a10] py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 items-center">

        <div>
          <p className="text-[#4ade80] text-sm font-semibold uppercase tracking-widest mb-4">
            {t("eyebrow")}
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] mb-6">
            {t("headline")}
          </h2>
          <p className="text-white/40 text-lg leading-relaxed max-w-md">
            {t("subheadline")}
          </p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <div className="relative w-full max-w-sm">
            <div className="absolute inset-0 rounded-3xl bg-[#4ade80]/10 blur-[60px] pointer-events-none" />
            <PredictionQuiz />
          </div>
        </div>

      </div>
    </section>
  );
}
