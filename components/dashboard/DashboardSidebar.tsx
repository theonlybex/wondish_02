"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const navItems = [
  { href: "/overview", label: "Overview", icon: "▦" },
  { href: "/meal-plan", label: "Meal Plan", icon: "🍽" },
  { href: "/meal-plan/weekly", label: "Weekly Plan", icon: "📅" },
  { href: "/grocery-list", label: "Grocery List", icon: "🛒" },
  { href: "/journal", label: "My Journal", icon: "📓" },
  { href: "/journey", label: "My Journey", icon: "📈" },
  { href: "/orders", label: "My Orders", icon: "📦" },
  { href: "/profile", label: "My Profile", icon: "👤" },
];

const adminItems = [
  { href: "/admin/recipes", label: "Recipes", icon: "🧑‍🍳" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/companies", label: "Companies", icon: "🏢" },
  { href: "/admin/parameters/gender", label: "Parameters", icon: "⚙️" },
];

export default function DashboardSidebar({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-64 bg-navy-dark flex flex-col border-r border-white/[0.06]">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/[0.06]">
        <Link href="/overview" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5ZM8 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7.5a5.25 5.25 0 0 1-4.5-2.55c.02-1.5 3-2.325 4.5-2.325s4.48.825 4.5 2.325A5.25 5.25 0 0 1 8 12.5Z"
                fill="white"
              />
            </svg>
          </div>
          <span className="text-white font-semibold text-lg">Wondish</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 scrollbar-hide">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-primary/20 text-primary"
                    : "text-white/60 hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <span className="text-base w-5 text-center">{icon}</span>
                {label}
              </Link>
            );
          })}
        </div>

        {isAdmin && (
          <>
            <p className="text-white/30 text-xs font-semibold uppercase tracking-wider px-3 mt-6 mb-2">
              Admin
            </p>
            <div className="space-y-0.5">
              {adminItems.map(({ href, label, icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      active
                        ? "bg-primary/20 text-primary"
                        : "text-white/60 hover:text-white hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="text-base w-5 text-center">{icon}</span>
                    {label}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </nav>

      {/* Sign out */}
      <div className="p-3 border-t border-white/[0.06]">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.06] w-full transition-all"
        >
          <span className="text-base w-5 text-center">↩</span>
          Sign out
        </button>
      </div>
    </aside>
  );
}
