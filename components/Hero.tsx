import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

const LINE_SOFT = "#EAE4CA";

export default async function Hero() {
  const t = await getTranslations("hero");

  const chips = [
    { icon: "🎯", icBg: "#F5F1DD", title: t("chip1"), sub: t("chip1Sub"), pos: "top-[26px] -left-[26px]", delay: "0s" },
    // TODO(confirm): reviewer questioned the "−5.8/−6 kg" badge; replaced with "Wondish will guide you through." Confirm whether to keep any number.
    { icon: "🧭", icBg: "#FFE9AE", title: t("chip2"), sub: null, pos: "bottom-[70px] -right-[22px]", delay: "1.4s" },
    { icon: "🛒", icBg: "#8DCEBD", title: t("chip3"), sub: t("chip3Sub"), pos: "-bottom-4 left-[30px]", delay: "2.6s" },
  ];

  const macros = [
    { value: "520", label: t("kcal") },
    { value: "42g", label: t("protein") },
    { value: "38g", label: t("carbs") },
    { value: "18g", label: t("fat") },
  ];

  const assure = [t("assure1"), t("assure2"), t("assure3"), t("assure4")];

  return (
    <header className="relative pt-[60px] pb-0 overflow-hidden">
      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
      `}</style>

      <div className="relative z-[2] max-w-[1180px] mx-auto px-7">
        <div className="grid lg:grid-cols-[1.18fr_0.82fr] gap-12 lg:gap-12 items-center">
          {/* Copy */}
          <div>
            <h1
              className="reveal d1 font-extrabold"
              style={{ fontSize: "clamp(36px, 5.5vw, 68px)", letterSpacing: "-0.02em", lineHeight: 1.05 }}
            >
              <span className="block">{t("headline1")}</span>
              <span className="block">
                {t("headline2")}{" "}
                <span className="relative italic font-semibold whitespace-nowrap" style={{ color: "#812549", zIndex: 0 }}>
                  {t("headlineSwash")}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 -right-0.5 bottom-[0.08em] h-[0.28em] rounded-lg"
                    style={{ background: "#FFE9AE", zIndex: -1, transform: "rotate(-1.2deg)" }}
                  />
                </span>
              </span>
            </h1>
            <p className="reveal d2 text-xl italic font-semibold mt-4" style={{ color: "#812549" }}>
              {t("tagline")}
            </p>
            <p className="reveal d2 text-lg leading-relaxed max-w-[460px] mt-4 mb-8" style={{ color: "#4F4A4A" }}>
              {t("subheadline")}
            </p>
            <div className="reveal d3 flex flex-wrap items-center gap-3.5">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full font-semibold text-[15px] text-white transition-all hover:-translate-y-0.5"
                style={{ background: "#812549" }}
              >
                {t("ctaPrimary")} →
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full font-semibold text-[15px] transition-all hover:-translate-y-0.5 hover:bg-[#F5F1DD]"
                style={{ background: "#FFFFFF", color: "#5F1C35" }}
              >
                {t("ctaSecondary")}
              </a>
            </div>
          </div>

          {/* Visual */}
          <div className="reveal d2 relative max-w-[440px] w-full mx-auto lg:max-w-none">
            {/* Floating ingredient cutouts */}
            <div
              className="absolute rounded-full overflow-hidden bg-white z-[3] border hidden sm:block"
              style={{ width: 78, height: 78, top: -10, right: 80, borderColor: LINE_SOFT, animation: "bob 6s ease-in-out infinite" }}
            >
              <Image src="/dish/avocado.png" alt="Fresh avocado" fill sizes="78px" className="object-cover" />
            </div>
            <div
              className="absolute rounded-full overflow-hidden bg-white z-[3] border hidden sm:block"
              style={{ width: 64, height: 64, bottom: 30, left: -34, borderColor: LINE_SOFT, animation: "bob 7s ease-in-out 0.8s infinite" }}
            >
              <Image src="/dish/tomato.png" alt="Cherry tomatoes" fill sizes="64px" className="object-cover" />
            </div>

            {/* Floating chips */}
            {chips.map((c) => (
              <div
                key={c.icon}
                className={`absolute z-[3] hidden sm:flex items-center gap-3 bg-white rounded-2xl py-[11px] px-[15px] text-[13px] font-semibold border ${c.pos}`}
                style={{ borderColor: LINE_SOFT, animation: `bob 5s ease-in-out ${c.delay} infinite` }}
              >
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-[17px]" style={{ background: c.icBg }}>
                  {c.icon}
                </div>
                <div>
                  {c.title}
                  {c.sub && (
                    <small className="block text-[11px] font-semibold" style={{ color: "#848181" }}>{c.sub}</small>
                  )}
                </div>
              </div>
            ))}

            {/* Plate card */}
            <div
              className="relative z-[2] bg-white rounded-[34px] p-[18px] border"
              style={{ borderColor: LINE_SOFT, transform: "rotate(1.4deg)" }}
            >
              <Image
                src="/dish/dish.png"
                alt={t("plateName")}
                width={800}
                height={600}
                priority
                className="w-full h-auto rounded-3xl block"
                style={{ background: "linear-gradient(160deg, #fff, #f3efe6)" }}
              />
              <div className="flex justify-between items-center pt-4 px-2 pb-1">
                <div>
                  <span className="text-xs font-semibold" style={{ color: "#812549" }}>{t("plateTag")}</span>
                  <h4 className="text-lg font-bold" style={{ letterSpacing: "-0.02em" }}>{t("plateName")}</h4>
                </div>
                <span
                  className="inline-block text-[11px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full"
                  style={{ background: "#F5F1DD", color: "#5F1C35" }}
                >
                  {t("plateTime")}
                </span>
              </div>
              <div className="flex gap-2 mt-3.5">
                {macros.map((m) => (
                  <div
                    key={m.label}
                    className="flex-1 rounded-[14px] py-2.5 px-3 text-center border"
                    style={{ background: "#F9F7ED", borderColor: LINE_SOFT }}
                  >
                    <b className="block text-lg" style={{ color: "#1E1A1A" }}>{m.value}</b>
                    <small className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#848181" }}>
                      {m.label}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reassurance strip */}
      <div className="relative z-[2] mt-9 py-[22px]" style={{ background: "#FFFFFF" }}>
        <div className="reveal max-w-[1180px] mx-auto px-7 flex flex-wrap gap-y-3.5 gap-x-9 justify-center items-center">
          {assure.map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#5F1C35" }}>
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "#00A090" }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3.5 8.4l3 3 6-6.4"
                    stroke="#FFFFFF"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {item}
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
