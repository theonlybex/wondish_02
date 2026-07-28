import { getTranslations } from "next-intl/server";

// Cancer, Fibromyalgia, Diabetes & pre-diabetes, Heart & blood pressure, Gluten & allergies, Gut & digestion
const ICONS = ["🎗️", "🌿", "🩸", "❤️", "🌾", "🫧"];

export default async function Conditions() {
  const t = await getTranslations("conditions");

  const cards = ICONS.map((icon, i) => ({
    icon,
    title: t(`c${i + 1}Title`),
    desc: t(`c${i + 1}Desc`),
  }));

  return (
    <section id="conditions" className="pb-24">
      <div className="max-w-[1180px] mx-auto px-7">
        <div
          className="reveal relative overflow-hidden rounded-[28px] sm:rounded-[40px] py-12 px-7 sm:py-16 sm:px-14 text-white"
          style={{ background: "#5F1C35" }}
        >
          <div className="relative z-[2] max-w-[620px]">
            <span
              className="inline-flex items-center text-xs font-bold uppercase tracking-[0.14em]"
              style={{ color: "#FDC221" }}
            >
              {t("eyebrow")}
            </span>
            <h2
              className="font-bold mt-3.5 mb-4"
              style={{ fontSize: "clamp(30px, 4vw, 46px)", letterSpacing: "-0.02em", lineHeight: 1.05 }}
            >
              {t("headline")}
            </h2>
            <p className="text-lg" style={{ color: "rgba(255,255,255,0.78)" }}>{t("subheadline")}</p>
          </div>

          <div className="relative z-[2] grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-11">
            {cards.map((card) => (
              <div
                key={card.title}
                className="rounded-[20px] p-6 border transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.12]"
                style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", backdropFilter: "blur(4px)" }}
              >
                <div
                  className="w-11 h-11 rounded-[13px] flex items-center justify-center text-[22px] mb-4"
                  style={{ background: "rgba(255,255,255,0.12)" }}
                >
                  {card.icon}
                </div>
                <h4 className="text-lg font-bold mb-1.5" style={{ letterSpacing: "-0.02em" }}>{card.title}</h4>
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>{card.desc}</p>
              </div>
            ))}
          </div>

          <div className="relative z-[2] mt-9">
            {/* TODO: set Learn more destination */}
            <a
              href="#"
              className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full font-semibold text-[15px] text-white border transition-all hover:-translate-y-0.5 hover:bg-white/10"
              style={{ borderColor: "rgba(255,255,255,0.4)" }}
            >
              {t("learnMore")}
            </a>
          </div>

          <div className="relative z-[2] mt-[34px] flex flex-wrap items-center gap-3 text-sm" style={{ color: "rgba(255,255,255,0.66)" }}>
            <span className="rounded-full px-3.5 py-1.5 font-semibold text-white" style={{ background: "rgba(255,255,255,0.12)" }}>
              {t("noteBadge")}
            </span>
            {t("note")}
          </div>
        </div>
      </div>
    </section>
  );
}
