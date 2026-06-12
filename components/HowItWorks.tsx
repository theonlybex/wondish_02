import { getTranslations } from "next-intl/server";

const NUM_STYLES = [
  { background: "#F5F1DD", color: "#5F1C35" },
  { background: "#FFE9AE", color: "#DEA402" },
  { background: "#8DCEBD", color: "#2b6472" },
];

export default async function HowItWorks() {
  const t = await getTranslations("howItWorks");

  const steps = [
    { num: "01", title: t("step1Title"), desc: t("step1Desc") },
    { num: "02", title: t("step2Title"), desc: t("step2Desc") },
    { num: "03", title: t("step3Title"), desc: t("step3Desc") },
  ];

  return (
    <section id="how-it-works" className="py-24">
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

        <div className="grid md:grid-cols-3 gap-[22px] mt-14">
          {steps.map((step, i) => (
            <div
              key={step.num}
              className={`reveal ${i === 1 ? "d1" : i === 2 ? "d2" : ""} relative bg-white rounded-[26px] py-8 px-7 border transition-all duration-300 hover:-translate-y-1.5`}
              style={{ borderColor: "#EAE4CA" }}
            >
              <div
                className="w-10 h-10 rounded-[13px] flex items-center justify-center font-extrabold text-[15px] mb-[22px]"
                style={NUM_STYLES[i]}
              >
                {step.num}
              </div>
              <h3 className="text-[22px] font-bold mb-2.5" style={{ letterSpacing: "-0.02em" }}>{step.title}</h3>
              <p className="text-[15px]" style={{ color: "#4F4A4A" }}>{step.desc}</p>
              {i < steps.length - 1 && (
                <div
                  className="hidden md:block absolute top-[52px] -right-[13px] text-[22px] z-[4]"
                  style={{ color: "rgba(30,26,26,0.12)" }}
                >
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
