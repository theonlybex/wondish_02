"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import BrandLogo from "@/components/BrandLogo";

export default function DashboardSidebar({
  isAdmin,
  isRestaurantStaff = false,
}: {
  isAdmin: boolean;
  isRestaurantStaff?: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");

  const navItems = [
    { href: "/overview", label: t("overview") },
    { href: "/meal-plan", label: t("mealPlan") },
    { href: "/dish-checker", label: t("dishChecker") },
    // Phase 2 web — the consumer directory. Distinct i18n key from the admin
    // "restaurants" entry below, which manages them rather than browsing.
    // Eat Out is a mobile-app surface; hidden on web (2026-09-06). The
    // /restaurants routes stay live — the QR flow (/r/claim) still lands there.
    // { href: "/restaurants", label: t("eatOut") },
    { href: "/pantry", label: t("myFridge") },
    { href: "/journal", label: t("myJournal") },
    { href: "/journey", label: t("myJourney") },
    { href: "/taste", label: t("myTaste") },
    // Grocery List merged into the Ingredients screen as a "What to buy" tab
    // (2026-09-07) — standalone nav entry removed.
    // { href: "/grocery-list", label: t("groceryList") },
  ];

  const adminItems = [
    { href: "/admin/recipes", label: t("recipes") },
    { href: "/admin/users", label: t("users") },
    { href: "/admin/companies", label: t("companies") },
    { href: "/admin/restaurants", label: t("restaurants") },
    { href: "/admin/referrals", label: t("referrals") },
    { href: "/admin/review-queue", label: t("reviewQueue") },
    { href: "/admin/ingredient-requests", label: t("ingredientRequests") },
    { href: "/admin/parameters/gender", label: t("parameters") },
    { href: "/admin/coupons", label: t("coupons") },
    { href: "/admin/clara-gaps", label: t("claraGaps") },
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
          {navItems.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  active
                    ? "bg-white/[0.12] text-white"
                    : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#FDC221] rounded-r-full" />
                )}
                {label}
              </Link>
            );
          })}
        </div>

        {/* Phase 6a — portal entry for accounts that are restaurant staff
            AND patients: without it, only staff-only accounts (redirected
            at sign-in) would ever find /restaurant. */}
        {isRestaurantStaff && (
          <>
            <div className="mx-3 my-4 h-px bg-white/[0.06]" />
            {/* No active-state: /restaurant renders its own portal layout,
                never this sidebar. */}
            <div className="space-y-0.5">
              <Link
                href="/restaurant"
                className="relative flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
              >
                {t("myRestaurant")}
              </Link>
            </div>
          </>
        )}

        {isAdmin && (
          <>
            <div className="mx-3 my-4 h-px bg-white/[0.06]" />
            <p className="text-white/25 text-[10px] font-bold uppercase tracking-[0.18em] px-3 mb-2">{t("admin")}</p>
            <div className="space-y-0.5">
              {adminItems.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`relative flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                      active
                        ? "bg-white/[0.12] text-white"
                        : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#FDC221] rounded-r-full" />
                    )}
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
