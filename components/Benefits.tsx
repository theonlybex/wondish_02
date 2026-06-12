import { getTranslations } from "next-intl/server";

export default async function Benefits() {
  const t = await getTranslations("benefits");

  return (
    <section id="benefits" className="pb-24">
      <div className="max-w-[1180px] mx-auto px-7">
        <div className="reveal max-w-[640px]">
          <span
            className="inline-flex items-center gap-[9px] text-xs font-bold uppercase tracking-[0.14em]"
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

        <div className="grid grid-cols-12 gap-[18px] mt-14">
          {/* No calorie counting — crimson feature tile */}
          <div
            className="reveal col-span-12 lg:col-span-7 rounded-[26px] p-8 min-h-[230px] flex flex-col text-white transition-transform duration-300 hover:-translate-y-1"
            style={{ background: "linear-gradient(150deg, #812549, #5F1C35)" }}
          >
            <div
              className="w-[50px] h-[50px] rounded-[15px] flex items-center justify-center text-2xl mb-[18px]"
              style={{ background: "rgba(255,255,255,0.16)" }}
            >
              ✨
            </div>
            <h3 className="text-[22px] font-bold mb-2" style={{ letterSpacing: "-0.02em" }}>{t("b1Title")}</h3>
            <p className="text-[15px]" style={{ color: "rgba(255,255,255,0.82)" }}>{t("b1Desc")}</p>
            <div className="mt-auto flex gap-2.5 flex-wrap pt-[18px]">
              {[`🔥 ${t("b1Pill1")}`, `🥗 ${t("b1Pill2")}`, `⚖️ ${t("b1Pill3")}`].map((pill) => (
                <span
                  key={pill}
                  className="rounded-full px-[13px] py-1.5 text-[12.5px] font-semibold"
                  style={{ background: "rgba(255,255,255,0.14)" }}
                >
                  {pill}
                </span>
              ))}
            </div>
          </div>

          {/* Food you crave — apricot tile */}
          <div
            className="reveal d1 col-span-12 lg:col-span-5 rounded-[26px] p-8 min-h-[230px] flex flex-col transition-transform duration-300 hover:-translate-y-1"
            style={{ background: "#FFE9AE" }}
          >
            <div
              className="w-[50px] h-[50px] rounded-[15px] flex items-center justify-center text-2xl mb-[18px]"
              style={{ background: "rgba(255,255,255,0.6)" }}
            >
              🍽️
            </div>
            <h3 className="text-[22px] font-bold mb-2" style={{ letterSpacing: "-0.02em" }}>{t("b2Title")}</h3>
            <p className="text-[15px]" style={{ color: "#7a4a10" }}>{t("b2Desc")}</p>
          </div>

          {/* Groceries — mint tile */}
          <div
            className="reveal col-span-12 lg:col-span-4 rounded-[26px] p-8 min-h-[230px] flex flex-col transition-transform duration-300 hover:-translate-y-1"
            style={{ background: "#F5F1DD" }}
          >
            <div
              className="w-[50px] h-[50px] rounded-[15px] flex items-center justify-center text-2xl mb-[18px]"
              style={{ background: "rgba(255,255,255,0.6)" }}
            >
              🛒
            </div>
            <h3 className="text-[22px] font-bold mb-2" style={{ letterSpacing: "-0.02em" }}>{t("b3Title")}</h3>
            <p className="text-[15px]" style={{ color: "rgba(95,28,53,0.85)" }}>{t("b3Desc")}</p>
          </div>

          {/* Swaps & regenerate — paper tile */}
          <div
            className="reveal d1 col-span-12 lg:col-span-8 rounded-[26px] p-8 min-h-[230px] flex flex-col bg-white border transition-transform duration-300 hover:-translate-y-1"
            style={{ borderColor: "#EAE4CA" }}
          >
            <div
              className="w-[50px] h-[50px] rounded-[15px] flex items-center justify-center text-2xl mb-[18px]"
              style={{ background: "#F9F7ED" }}
            >
              🔄
            </div>
            <h3 className="text-[22px] font-bold mb-2" style={{ letterSpacing: "-0.02em" }}>{t("b4Title")}</h3>
            <p className="text-[15px]" style={{ color: "#4F4A4A" }}>{t("b4Desc")}</p>
            <div className="mt-auto flex gap-2.5 flex-wrap pt-[18px]">
              {[
                { text: `🥑 ${t("b4Pill1")}`, bg: "#F5F1DD" },
                { text: `🍲 ${t("b4Pill2")}`, bg: "#FFE9AE" },
                { text: `↻ ${t("b4Pill3")}`, bg: "#8DCEBD" },
              ].map((pill) => (
                <span
                  key={pill.text}
                  className="rounded-full px-[13px] py-1.5 text-[12.5px] font-semibold"
                  style={{ background: pill.bg }}
                >
                  {pill.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
