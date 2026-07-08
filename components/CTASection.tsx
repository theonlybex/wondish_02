import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function CTASection() {
  const t = await getTranslations("cta");

  const trustBadges = [t("secureBilling"), t("cancelAnytime"), t("setupIn3min")];

  return (
    <section
      className="relative text-center py-24 px-7 overflow-hidden"
      style={{ background: "radial-gradient(ellipse 70% 90% at 50% 0%, #F5F1DD, #F9F7ED 70%)" }}
    >
      <div className="reveal max-w-[1180px] mx-auto">
        <span
          className="inline-flex items-center justify-center gap-[9px] text-xs font-bold uppercase tracking-[0.14em]"
          style={{ color: "#812549" }}
        >
          <span className="w-[22px] h-0.5 rounded-sm" style={{ background: "#FDC221" }} />
          {t("eyebrow")}
        </span>
        <h2
          className="font-extrabold max-w-[760px] mx-auto mt-4 mb-[18px]"
          style={{ fontSize: "clamp(36px, 5.5vw, 68px)", letterSpacing: "-0.02em", lineHeight: 1.05 }}
        >
          {t("headline")}
        </h2>
        <p className="text-[19px] max-w-[480px] mx-auto mb-8" style={{ color: "#4F4A4A" }}>
          {t("subheadline")}
        </p>
        <div className="flex flex-wrap justify-center items-center gap-3.5">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full font-semibold text-[15px] text-white transition-all hover:-translate-y-0.5"
            style={{ background: "#812549" }}
          >
            {t("getStarted")} →
          </Link>
          <Link
            href="/dishes"
            className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full font-semibold text-[15px] border transition-all hover:-translate-y-0.5 hover:text-white hover:bg-[#B75E78] hover:border-[#B75E78]"
            style={{ color: "#812549", borderColor: "#812549" }}
          >
            {t("browseMenu")}
          </Link>
        </div>
        <div className="mt-[18px] text-[13px]" style={{ color: "#848181" }}>
          {trustBadges.join(" · ")}
        </div>
      </div>
    </section>
  );
}
