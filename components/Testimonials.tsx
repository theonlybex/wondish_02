import { getTranslations } from "next-intl/server";

export default async function Testimonials() {
  const t = await getTranslations("quotes");

  const quotes = [
    { text: t("q1"), name: t("q1Name"), meta: t("q1Meta"), avatar: "👩🏼", avBg: "#FFE9AE", feature: true },
    { text: t("q2"), name: t("q2Name"), meta: t("q2Meta"), avatar: "🧔🏾", avBg: "#EAE4CA", feature: false },
    { text: t("q3"), name: t("q3Name"), meta: t("q3Meta"), avatar: "👩🏻", avBg: "#8DCEBD", feature: false },
    { text: t("q4"), name: t("q4Name"), meta: t("q4Meta"), avatar: "👩🏽", avBg: "#F5F1DD", feature: false },
    { text: t("q5"), name: t("q5Name"), meta: t("q5Meta"), avatar: "👩🏿", avBg: "#FFE9AE", feature: false },
    { text: t("q6"), name: t("q6Name"), meta: t("q6Meta"), avatar: "👩🏻‍🦱", avBg: "#8DCEBD", feature: false },
    { text: t("q7"), name: t("q7Name"), meta: t("q7Meta"), avatar: "👨🏽", avBg: "#EAE4CA", feature: false },
  ];

  return (
    <section className="pb-24">
      <div className="max-w-[1180px] mx-auto px-7">
        <div className="reveal max-w-[640px] mx-auto text-center">
          <span
            className="inline-flex items-center justify-center text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "#812549" }}
          >
            {t("eyebrow")}
          </span>
          <h2
            className="font-extrabold mt-4"
            style={{ fontSize: "clamp(32px, 4.4vw, 52px)", letterSpacing: "-0.02em", lineHeight: 1.05 }}
          >
            {t("headline")}
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-[18px] mt-[54px]">
          {quotes.map((q, i) => (
            <div
              key={q.name}
              className={`reveal ${i % 3 === 1 ? "d1" : i % 3 === 2 ? "d2" : ""} flex flex-col rounded-3xl p-[30px] border`}
              style={{
                background: q.feature ? "linear-gradient(155deg, #FFE9AE, #fbeede)" : "#fff",
                borderColor: "#EAE4CA",
              }}
            >
              <div className="text-sm mb-4" style={{ color: "#DEA402", letterSpacing: 2 }}>★★★★★</div>
              <p className="flex-1 text-base leading-relaxed" style={{ color: "#1E1A1A" }}>&ldquo;{q.text}&rdquo;</p>
              <div className="flex items-center gap-3 mt-[22px] pt-5 border-t" style={{ borderColor: q.feature ? "rgba(30,26,26,0.1)" : "#EAE4CA" }}>
                <div
                  className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-[19px]"
                  style={{ background: q.avBg }}
                >
                  {q.avatar}
                </div>
                <div>
                  <b className="block text-sm">{q.name}</b>
                  <small className="text-[12.5px]" style={{ color: "#848181" }}>{q.meta}</small>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
