import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="bg-navy-deeper border-t border-white/[0.06] px-5 sm:px-8 py-14">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="flex items-center mb-4">
              <span className="text-xl font-bold tracking-tight leading-none">
                <span className="text-white">won</span>
                <span className="text-primary">dish</span>
              </span>
            </Link>
            <p className="text-white/40 text-sm leading-relaxed">{t("tagline")}</p>
          </div>

          <div>
            <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-4">{t("product")}</p>
            <ul className="space-y-3">
              {([["dishes", "/dishes"], ["pricing", "/pricing"], ["features", "/#features"]] as const).map(([key, href]) => (
                <li key={key}>
                  <Link href={href} className="text-white/40 hover:text-white/80 text-sm transition-colors">{t(key)}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-4">{t("account")}</p>
            <ul className="space-y-3">
              <li><Link href="/login" className="text-white/40 hover:text-white/80 text-sm transition-colors">{t("login")}</Link></li>
              <li><Link href="/register" className="text-white/40 hover:text-white/80 text-sm transition-colors">{t("getStarted")}</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-4">{t("legal")}</p>
            <ul className="space-y-3">
              <li><Link href="/privacy" className="text-white/40 hover:text-white/80 text-sm transition-colors">{t("privacyPolicy")}</Link></li>
              <li><Link href="/terms" className="text-white/40 hover:text-white/80 text-sm transition-colors">{t("terms")}</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/[0.06] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-sm">© {new Date().getFullYear()} Wondish. {t("rights")}</p>
          <p className="text-white/30 text-sm">{t("securedBy")} <span className="text-white/50 font-medium">Stripe</span></p>
        </div>
      </div>
    </footer>
  );
}
