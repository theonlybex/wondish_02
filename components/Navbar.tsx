"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const t = useTranslations("navbar");

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-forest-deeper/95 backdrop-blur-md border-b border-white/[0.07]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5ZM8 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7.5a5.25 5.25 0 0 1-4.5-2.55c.02-1.5 3-2.325 4.5-2.325s4.48.825 4.5 2.325A5.25 5.25 0 0 1 8 12.5Z"
                  fill="white"
                />
              </svg>
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">Wondish</span>
          </Link>

          {/* Center nav */}
          <nav className="hidden md:flex items-center gap-1">
            <Link href="/dishes" className="text-white/60 hover:text-white px-4 py-2 rounded-lg hover:bg-white/[0.06] transition-all duration-150 text-sm font-medium">
              {t("dishes")}
            </Link>
            <Link href="/pricing" className="text-white/60 hover:text-white px-4 py-2 rounded-lg hover:bg-white/[0.06] transition-all duration-150 text-sm font-medium">
              {t("pricing")}
            </Link>
          </nav>

          {/* Right actions */}
          <div className="hidden md:flex items-center gap-2">
            <LanguageSwitcher />
            {isSignedIn ? (
              <>
                <Link href="/overview" className="bg-primary hover:bg-primary-dark text-forest-deeper px-4 py-2 rounded-lg transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20">
                  {t("dashboard")}
                </Link>
                <button
                  onClick={() => signOut({ redirectUrl: "/" })}
                  className="text-white/60 hover:text-white px-4 py-2 rounded-lg hover:bg-white/[0.06] transition-all duration-150 text-sm font-medium"
                >
                  {t("signOut")}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-white/60 hover:text-white px-4 py-2 rounded-lg hover:bg-white/[0.06] transition-all duration-150 text-sm font-medium">
                  {t("login")}
                </Link>
                <Link href="/register" className="bg-primary hover:bg-primary-dark text-forest-deeper px-4 py-2 rounded-lg transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20">
                  {t("getStarted")}
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button onClick={() => setOpen(!open)} className="md:hidden p-2 text-white/60 hover:text-white" aria-label="Toggle menu">
            {open ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/[0.06] bg-forest-deeper">
          <div className="max-w-6xl mx-auto px-5 py-4 flex flex-col gap-1">
            <Link href="/dishes" onClick={() => setOpen(false)} className="text-white/60 hover:text-white px-3 py-2.5 rounded-lg hover:bg-white/[0.06] text-sm font-medium">
              {t("dishes")}
            </Link>
            <Link href="/pricing" onClick={() => setOpen(false)} className="text-white/60 hover:text-white px-3 py-2.5 rounded-lg hover:bg-white/[0.06] text-sm font-medium">
              {t("pricing")}
            </Link>
            <div className="border-t border-white/[0.06] mt-2 pt-2 flex flex-col gap-2">
              {isSignedIn ? (
                <>
                  <Link href="/overview" onClick={() => setOpen(false)} className="bg-primary text-forest-deeper px-3 py-2.5 rounded-lg text-sm font-semibold text-center">
                    {t("dashboard")}
                  </Link>
                  <button
                    onClick={() => { setOpen(false); signOut({ redirectUrl: "/" }); }}
                    className="text-white/60 hover:text-white px-3 py-2.5 rounded-lg hover:bg-white/[0.06] text-sm font-medium text-left"
                  >
                    {t("signOut")}
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login" onClick={() => setOpen(false)} className="text-white/60 hover:text-white px-3 py-2.5 rounded-lg hover:bg-white/[0.06] text-sm font-medium">
                    {t("login")}
                  </Link>
                  <Link href="/register" onClick={() => setOpen(false)} className="bg-primary text-forest-deeper px-3 py-2.5 rounded-lg text-sm font-semibold text-center">
                    {t("getStarted")}
                  </Link>
                </>
              )}
              <div className="pt-1">
                <LanguageSwitcher />
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
