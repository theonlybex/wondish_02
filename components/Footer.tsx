import Link from "next/link";
import { getTranslations } from "next-intl/server";
import BrandLogo from "./BrandLogo";

export default async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="px-7 py-16 pb-9" style={{ background: "#1E1A1A", color: "rgba(255,255,255,0.7)" }}>
      <div className="max-w-[1180px] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-[1.7fr_1fr_1fr_1fr] gap-10 mb-12">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="inline-flex items-center mb-3.5 text-white" aria-label="Wondish home">
              <BrandLogo />
            </Link>
            <p className="text-sm leading-[1.7] max-w-[280px]">{t("tagline")}</p>
          </div>

          <div>
            <p className="text-white text-[13px] font-bold uppercase tracking-[0.1em] mb-4">{t("product")}</p>
            <ul className="space-y-[11px]">
              {([["dishes", "/dishes"], ["pricing", "/pricing"], ["features", "/#benefits"]] as const).map(([key, href]) => (
                <li key={key}>
                  <Link href={href} className="text-sm transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.6)" }}>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-white text-[13px] font-bold uppercase tracking-[0.1em] mb-4">{t("account")}</p>
            <ul className="space-y-[11px]">
              <li>
                <Link href="/login" className="text-sm transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("login")}
                </Link>
              </li>
              <li>
                <Link href="/register" className="text-sm transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("getStarted")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-white text-[13px] font-bold uppercase tracking-[0.1em] mb-4">{t("legal")}</p>
            <ul className="space-y-[11px]">
              <li>
                <Link href="/privacy" className="text-sm transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("privacyPolicy")}
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-sm transition-colors hover:text-white" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {t("terms")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <p className="text-xs leading-[1.6] max-w-[720px]" style={{ color: "rgba(255,255,255,0.4)" }}>
          {t("disclaimer")}
        </p>

        <div
          className="border-t mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-[13px]"
          style={{ borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}
        >
          <span>© {new Date().getFullYear()} Wondish. {t("rights")}</span>
          <span>{t("securedBy")} <span className="font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>Stripe</span></span>
        </div>
      </div>
    </footer>
  );
}
