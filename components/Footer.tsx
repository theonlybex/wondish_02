import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="bg-navy-deeper border-t border-white/[0.06] px-5 sm:px-8 py-14">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5ZM8 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7.5a5.25 5.25 0 0 1-4.5-2.55c.02-1.5 3-2.325 4.5-2.325s4.48.825 4.5 2.325A5.25 5.25 0 0 1 8 12.5Z" fill="white" />
                </svg>
              </div>
              <span className="text-white font-semibold text-lg">Wondish</span>
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
