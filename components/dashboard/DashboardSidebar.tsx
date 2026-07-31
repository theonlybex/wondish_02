"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import BrandLogo from "@/components/BrandLogo";

export default function DashboardSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");

  const navItems = [
    { href: "/overview", label: t("overview"), icon: "▦" },
    { href: "/meal-plan", label: t("mealPlan"), icon: "🍽" },
    { href: "/dish-checker", label: t("dishChecker"), icon: "🍴" },
    { href: "/journal", label: t("myJournal"), icon: "📓" },
    { href: "/journey", label: t("myJourney"), icon: "📈" },
    { href: "/taste", label: t("myTaste"), icon: "❤️" },
    { href: "/grocery-list", label: t("groceryList"), icon: "🛒" },
  ];

  const adminItems = [
    { href: "/admin/recipes", label: t("recipes"), icon: "🧑‍🍳" },
    { href: "/admin/users", label: t("users"), icon: "👥" },
    { href: "/admin/companies", label: t("companies"), icon: "🏢" },
    { href: "/admin/restaurants", label: t("restaurants"), icon: "🍜" },
    { href: "/admin/parameters/gender", label: t("parameters"), icon: "⚙️" },
    { href: "/admin/coupons", label: t("coupons"), icon: "🎟️" },
    { href: "/admin/clara-gaps", label: t("claraGaps"), icon: "📊" },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-64 flex flex-col border-r border-white/[0.06]" style={{ background: "linear-gradient(180deg, #5F1C35 0%, #3D1122 60%, #5F1C35 100%)" }}>
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/[0.06]">
        <Link href="/overview" className="flex items-center group text-white" aria-label="Wondish overview">
          <BrandLogo className="h-5 w-auto" />
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
                    ? "bg-white/[0.12] text-white"
                    : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#FDC221] rounded-r-full" />
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
                        ? "bg-white/[0.12] text-white"
                        : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#FDC221] rounded-r-full" />
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

    </aside>
  );
}
