import { getTranslations } from "next-intl/server";

// One shared container colour across all four benefit tiles (designer revision 2026-07-28).
const TILE_BG = "#FFFFFF";
const TILE_BORDER = "#EAE4CA";
const PILL_BGS = ["#F5F1DD", "#FFE9AE", "#8DCEBD"];

export default async function Benefits() {
  const t = await getTranslations("benefits");

  const tiles = [
    {
      icon: "✨",
      title: t("b1Title"),
      desc: t("b1Desc"),
      span: "lg:col-span-7",
      reveal: "",
      pills: [`🔥 ${t("b1Pill1")}`, `🥗 ${t("b1Pill2")}`, `⚖️ ${t("b1Pill3")}`].map((text, i) => ({
        text,
        bg: PILL_BGS[i],
      })),
    },
    { icon: "🍽️", title: t("b2Title"), desc: t("b2Desc"), span: "lg:col-span-5", reveal: "d1", pills: null },
    { icon: "🛒", title: t("b3Title"), desc: t("b3Desc"), span: "lg:col-span-4", reveal: "", pills: null },
    {
      icon: "🔄",
      title: t("b4Title"),
      desc: t("b4Desc"),
      span: "lg:col-span-8",
      reveal: "d1",
      pills: [`🥑 ${t("b4Pill1")}`, `🍲 ${t("b4Pill2")}`, `↻ ${t("b4Pill3")}`].map((text, i) => ({
        text,
        bg: PILL_BGS[i],
      })),
    },
  ];

  return (
    <section id="benefits" className="pb-24">
      <div className="max-w-[1180px] mx-auto px-7">
        <div className="reveal max-w-[640px]">
          <span
            className="inline-flex items-center text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "#812549" }}
          >
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
          {tiles.map((tile) => (
            <div
              key={tile.title}
              className={`reveal ${tile.reveal} col-span-12 ${tile.span} rounded-[26px] p-8 min-h-[230px] flex flex-col border transition-transform duration-300 hover:-translate-y-1`}
              style={{ background: TILE_BG, borderColor: TILE_BORDER }}
            >
              <div
                className="w-[50px] h-[50px] rounded-[15px] flex items-center justify-center text-2xl mb-[18px]"
                style={{ background: "#F9F7ED" }}
              >
                {tile.icon}
              </div>
              <h3 className="text-[22px] font-bold mb-2" style={{ letterSpacing: "-0.02em" }}>{tile.title}</h3>
              <p className="text-[15px]" style={{ color: "#4F4A4A" }}>{tile.desc}</p>
              {tile.pills && (
                <div className="mt-auto flex gap-2.5 flex-wrap pt-[18px]">
                  {tile.pills.map((pill) => (
                    <span
                      key={pill.text}
                      className="rounded-full px-[13px] py-1.5 text-[12.5px] font-semibold"
                      style={{ background: pill.bg, color: "#5F1C35" }}
                    >
                      {pill.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
