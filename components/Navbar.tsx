"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Menu", href: "#menu" },
  { label: "Pricing", href: "#pricing" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const t = useTranslations("navbar");

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#")) {
      e.preventDefault();
      const el = document.querySelector(href);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
      setOpen(false);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-forest-deeper/95 backdrop-blur-md border-b border-white/[0.07]">
      <div className="flex items-center justify-between h-16 px-6 sm:px-8">

        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0">
          <span className="text-xl font-bold tracking-tight leading-none">
            <span className="text-white">won</span>
            <span className="text-primary">dish</span>
          </span>
        </Link>

        {/* Center nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleAnchorClick(e, link.href)}
              className="text-white/60 hover:text-white px-4 py-2 rounded-lg hover:bg-white/[0.06] transition-all duration-150 text-sm font-medium"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right actions */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <LanguageSwitcher />
          {isSignedIn ? (
            <>
              <Link href="/overview" className="bg-primary hover:bg-primary-dark text-forest-deeper px-5 py-2 rounded-full transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20">
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
            <Link href="/register" className="bg-primary hover:bg-primary-dark text-forest-deeper px-5 py-2 rounded-full transition-all duration-150 text-sm font-semibold shadow-lg shadow-primary/20">
              {t("getStarted")}
            </Link>
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

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/[0.06] bg-forest-deeper">
          <div className="px-6 py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleAnchorClick(e, link.href)}
                className="text-white/60 hover:text-white px-3 py-2.5 rounded-lg hover:bg-white/[0.06] text-sm font-medium"
              >
                {link.label}
              </a>
            ))}
            <div className="border-t border-white/[0.06] mt-2 pt-2 flex flex-col gap-2">
              {isSignedIn ? (
                <>
                  <Link href="/overview" onClick={() => setOpen(false)} className="bg-primary text-forest-deeper px-3 py-2.5 rounded-full text-sm font-semibold text-center">
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
                <Link href="/register" onClick={() => setOpen(false)} className="bg-primary hover:bg-primary-dark text-forest-deeper px-3 py-2.5 rounded-full text-sm font-semibold text-center">
                  {t("getStarted")}
                </Link>
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
