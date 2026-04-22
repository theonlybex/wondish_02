import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function CTASection() {
  const t = await getTranslations("cta");

  // statHighlight must appear verbatim inside stat for correct rendering
  const statParts = t("stat").split(t("statHighlight"));

  const trustBadges = [
    { icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/></svg>), label: t("secureBilling") },
    { icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/></svg>), label: t("cancelAnytime") },
    { icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" strokeLinecap="round" strokeLinejoin="round"/></svg>), label: t("setupIn3min") },
  ];

  return (
    <section className="relative py-24 px-5 sm:px-8 overflow-hidden" style={{ background: "linear-gradient(135deg, #0d1a10 0%, #0f172a 50%, #0a1628 100%)" }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] rounded-full blur-[100px] pointer-events-none" style={{ background: "rgba(74, 222, 128, 0.12)" }} />
      <div className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full blur-[80px] pointer-events-none" style={{ background: "rgba(74, 222, 128, 0.07)" }} />
      <div className="absolute bottom-0 right-1/4 w-48 h-48 rounded-full blur-[80px] pointer-events-none" style={{ background: "rgba(99, 102, 241, 0.08)" }} />

      <div className="relative max-w-3xl mx-auto text-center">
        <p className="text-[#4ade80] text-sm font-semibold uppercase tracking-widest mb-4">{t("eyebrow")}</p>
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-4">{t("headline")}</h2>
        <p className="text-white/40 text-base mb-2">
          {statParts[0]}<span className="text-white/70 font-semibold">{t("statHighlight")}</span>{statParts[1] ?? ""}
        </p>
        <p className="text-white/40 text-lg mb-10 max-w-xl mx-auto">{t("subheadline")}</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Link href="/register" className="inline-flex items-center justify-center gap-2 bg-[#4ade80] hover:bg-[#22c55e] text-[#0d1a10] px-8 py-4 rounded-xl font-semibold text-base transition-colors shadow-xl shadow-[#4ade80]/25">
            {t("getStarted")}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <Link href="/dishes" className="inline-flex items-center justify-center gap-2 text-white/60 hover:text-white px-8 py-4 rounded-xl font-semibold text-base transition-colors border border-white/10 hover:border-white/20">
            {t("browseMenu")}
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5">
          {trustBadges.map(({ icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-white/30">
              <span className="text-[#4ade80]">{icon}</span>
              <span className="text-sm">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
