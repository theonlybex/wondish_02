"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function DashboardSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const { signOut } = useClerk();
  const router = useRouter();
  const t = useTranslations("sidebar");

  const navItems = [
    { href: "/overview", label: t("overview"), icon: "▦" },
    { href: "/meal-plan", label: t("mealPlan"), icon: "🍽" },
    { href: "/meal-plan/weekly", label: t("weeklyPlan"), icon: "📅" },
    { href: "/grocery-list", label: t("groceryList"), icon: "🛒" },
    { href: "/journal", label: t("myJournal"), icon: "📓" },
    { href: "/journey", label: t("myJourney"), icon: "📈" },
    { href: "/orders", label: t("myOrders"), icon: "📦" },
    { href: "/profile", label: t("myProfile"), icon: "👤" },
    { href: "/prediction", label: t("myPrediction"), icon: "🎯" },
    { href: "/taste", label: t("myTaste"), icon: "❤️" },
    { href: "/membership", label: t("myMembership"), icon: "⭐" },
  ];

  const adminItems = [
    { href: "/admin/recipes", label: t("recipes"), icon: "🧑‍🍳" },
    { href: "/admin/users", label: t("users"), icon: "👥" },
    { href: "/admin/companies", label: t("companies"), icon: "🏢" },
    { href: "/admin/parameters/gender", label: t("parameters"), icon: "⚙️" },
    { href: "/admin/coupons", label: t("coupons"), icon: "🎟️" },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-64 flex flex-col border-r border-white/[0.06]" style={{ background: "linear-gradient(180deg, #0d1f10 0%, #111e13 60%, #0d1f10 100%)" }}>
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/[0.06]">
        <Link href="/overview" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0 group-hover:shadow-primary/50 transition-shadow">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5ZM8 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7.5a5.25 5.25 0 0 1-4.5-2.55c.02-1.5 3-2.325 4.5-2.325s4.48.825 4.5 2.325A5.25 5.25 0 0 1 8 12.5Z" fill="white" />
            </svg>
          </div>
          <span className="text-white font-semibold text-lg tracking-tight">Wondish</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 scrollbar-hide">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                )}
                <span className="text-base w-5 text-center leading-none">{icon}</span>
                {label}
              </Link>
            );
          })}
        </div>

        {isAdmin && (
          <>
            <div className="mx-3 my-4 h-px bg-white/[0.06]" />
            <p className="text-white/25 text-[10px] font-bold uppercase tracking-[0.18em] px-3 mb-2">{t("admin")}</p>
            <div className="space-y-0.5">
              {adminItems.map(({ href, label, icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                    )}
                    <span className="text-base w-5 text-center leading-none">{icon}</span>
                    {label}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="p-3 border-t border-white/[0.06]">
        <button
          onClick={() => signOut(() => router.push("/"))}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/40 hover:text-white/80 hover:bg-white/[0.05] w-full transition-all duration-150"
        >
          <span className="text-base w-5 text-center">↩</span>
          {t("signOut")}
        </button>
      </div>
    </aside>
  );
}
