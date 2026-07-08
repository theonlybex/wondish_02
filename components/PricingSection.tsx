import Link from "next/link";
import CheckoutButton from "./CheckoutButton";
import IncludedFoodSection from "./IncludedFoodSection";
import { getTranslations } from "next-intl/server";

function Check({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className="w-[21px] h-[21px] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
      style={dark ? { background: "rgba(255,255,255,0.18)", color: "#fff" } : { background: "#F5F1DD", color: "#5F1C35" }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default async function PricingSection({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const t = await getTranslations("pricing");

  const freeFeatures = [t("freeF1"), t("freeF2"), t("freeF3"), t("freeF4")];
  const premiumFeatures = [t("premiumF1"), t("premiumF2"), t("premiumF3"), t("premiumF4"), t("premiumF5"), t("premiumF6"), t("premiumF7"), t("premiumF8"), t("premiumF9")];

  return (
    <section id="pricing" className="pb-24">
      <div className="max-w-[1180px] mx-auto px-7">
        <div className="reveal max-w-[640px] mx-auto text-center">
          <span
            className="inline-flex items-center justify-center gap-[9px] text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "#812549" }}
          >
            <span className="w-[22px] h-0.5 rounded-sm" style={{ background: "#FDC221" }} />
            {t("eyebrow")}
          </span>
          <h2
            className="font-extrabold mt-4 mb-4"
            style={{ fontSize: "clamp(32px, 4.4vw, 52px)", letterSpacing: "-0.02em", lineHeight: 1.05 }}
          >
            {t("headline")}
          </h2>
          <p className="text-lg" style={{ color: "#4F4A4A" }}>{t("subheadline")}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 max-w-[880px] mx-auto mt-[54px]">
          {/* Free */}
          <div className="reveal bg-white rounded-[28px] py-[38px] px-[34px] border flex flex-col" style={{ borderColor: "#EAE4CA" }}>
            <div className="text-[15px] font-bold uppercase tracking-[0.1em]" style={{ color: "#812549" }}>
              {t("freeName")}
            </div>
            <div className="font-extrabold mt-3.5" style={{ fontSize: 52, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              {t("freePrice")}
              <span className="text-[17px] font-semibold ml-1" style={{ color: "#848181", letterSpacing: 0 }}>{t("perMonth")}</span>
            </div>
            <p className="text-[15px] mb-6 mt-2" style={{ color: "#4F4A4A" }}>{t("freeTagline")}</p>
            <ul className="flex flex-col gap-[13px] mb-[30px] flex-1">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-[11px] text-[14.5px]" style={{ color: "#4F4A4A" }}>
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={isLoggedIn ? "/overview" : "/register"}
              className="w-full text-center px-7 py-[15px] rounded-full font-semibold text-[15px] border transition-all hover:-translate-y-0.5 hover:text-white hover:bg-[#B75E78] hover:border-[#B75E78]"
              style={{ color: "#812549", borderColor: "#812549" }}
            >
              {isLoggedIn ? t("freeCtaLoggedIn") : t("freeCta")}
            </Link>
          </div>

          {/* Premium */}
          <div
            className="reveal d1 relative rounded-[28px] py-[38px] px-[34px] flex flex-col text-white"
            style={{ background: "linear-gradient(165deg, #812549, #5F1C35)" }}
          >
            <span
              className="absolute top-6 right-6 text-xs font-bold px-3.5 py-1.5 rounded-full"
              style={{ background: "#FDC221", color: "#4a2c05" }}
            >
              {t("mostPopular")}
            </span>
            <div className="text-[15px] font-bold uppercase tracking-[0.1em]" style={{ color: "#FDC221" }}>
              {t("premiumName")}
            </div>
            <div className="font-extrabold mt-3.5" style={{ fontSize: 52, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              {t("premiumPrice")}
              <span className="text-[17px] font-semibold ml-1" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: 0 }}>{t("perMonth")}</span>
            </div>
            <p className="text-[15px] mb-1 mt-2" style={{ color: "rgba(255,255,255,0.8)" }}>{t("premiumTagline")}</p>
            <p className="text-xs mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>{t("premiumCancelAnytime")}</p>
            <ul className="flex flex-col gap-[13px] mb-[30px] flex-1">
              {premiumFeatures.map((f) => (
                <li key={f} className="flex items-start gap-[11px] text-[14.5px]" style={{ color: "rgba(255,255,255,0.9)" }}>
                  <Check dark />
                  {f}
                </li>
              ))}
            </ul>
            <CheckoutButton className="w-full text-center px-7 py-[15px] rounded-full font-semibold text-[15px] bg-[#00B9A6] hover:bg-[#75C6BC] disabled:opacity-60 disabled:cursor-not-allowed text-black transition-all hover:-translate-y-0.5">
              {t("premiumCta")}
            </CheckoutButton>
          </div>
        </div>

        <p className="text-center text-sm font-semibold mt-8" style={{ color: "#4F4A4A" }}>{t("foodNotIncluded")}</p>
        <p className="text-center text-sm mt-2" style={{ color: "#848181" }}>{t("footer")}</p>

        <IncludedFoodSection />
      </div>
    </section>
  );
}
