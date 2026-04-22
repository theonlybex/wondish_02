import { getTranslations } from "next-intl/server";

export default async function HowItWorks() {
  const t = await getTranslations("howItWorks");

  const steps = [
    { number: "01", emoji: "👤", title: t("step1Title"), description: t("step1Desc") },
    { number: "02", emoji: "🥗", title: t("step2Title"), description: t("step2Desc") },
    { number: "03", emoji: "📈", title: t("step3Title"), description: t("step3Desc") },
  ];

  return (
    <section className="bg-[#F8F7FA] py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-xl mb-16">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-4">{t("eyebrow")}</p>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#25293C] leading-tight">{t("headline")}</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={step.number} className="relative">
              {i < steps.length - 1 && (
                <div className="hidden sm:block absolute top-7 left-[calc(100%+1rem)] right-[-1rem] h-px bg-primary/25" />
              )}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-full border-2 border-primary/30 bg-primary/10 flex items-center justify-center">
                  <span className="text-primary font-bold text-sm">{step.number}</span>
                </div>
                <span className="text-2xl">{step.emoji}</span>
              </div>
              <h3 className="text-[#25293C] font-semibold text-xl mb-3">{step.title}</h3>
              <p className="text-[#8A8D93] text-sm leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
