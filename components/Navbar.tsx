"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";
import BrandLogo from "./BrandLogo";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const t = useTranslations("navbar");

  const navLinks = [
    { label: t("howItWorks"), href: "#how-it-works" },
    { label: t("whyItWorks"), href: "#benefits" },
    { label: t("healthNeeds"), href: "#conditions" },
    { label: t("pricing"), href: "#pricing" },
  ];

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#")) {
      e.preventDefault();
      const el = document.querySelector(href);
      if (el) el.scrollIntoView({ behavior: "smooth" });
      setOpen(false);
    }
  };

  return (
    <header className="sticky top-3.5 z-50 px-3.5">
      <div
        className="max-w-[1180px] mx-auto flex items-center justify-between py-3 pl-5 pr-3.5 rounded-full border"
        style={{
          background: "rgba(249,247,237,0.82)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          borderColor: "#EAE4CA",
        }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0" style={{ color: "#812549" }} aria-label="Wondish home">
          <BrandLogo />
        </Link>

        {/* Center nav */}
        <nav className="hidden md:flex items-center gap-7">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => handleAnchorClick(e, link.href)}
              className="text-sm font-medium transition-colors hover:text-[#1E1A1A]"
              style={{ color: "#4F4A4A" }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right actions */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          <LanguageSwitcher />
          {isSignedIn ? (
            <>
              <button
                onClick={() => signOut({ redirectUrl: "/" })}
                className="text-sm font-semibold transition-colors hover:text-[#1E1A1A]"
                style={{ color: "#4F4A4A" }}
              >
                {t("signOut")}
              </button>
              <Link
                href="/overview"
                className="px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                style={{ background: "#812549" }}
              >
                {t("dashboard")}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm font-semibold text-[#1E1A1A]">
                {t("login")}
              </Link>
              <Link
                href="/register"
                className="px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                style={{ background: "#812549" }}
              >
                {t("getStarted")}
              </Link>
            </>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden p-2 transition-colors hover:text-[#1E1A1A]"
          style={{ color: "#4F4A4A" }}
          aria-label="Toggle menu"
        >
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
        <div
          className="md:hidden max-w-[1180px] mx-auto mt-2 rounded-3xl border overflow-hidden"
          style={{ background: "#F9F7ED", borderColor: "#EAE4CA" }}
        >
          <div className="px-6 py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleAnchorClick(e, link.href)}
                className="px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-black/[0.04] hover:text-[#1E1A1A]"
                style={{ color: "#4F4A4A" }}
              >
                {link.label}
              </a>
            ))}
            <div className="border-t mt-2 pt-3 flex flex-col gap-2" style={{ borderColor: "#EAE4CA" }}>
              {isSignedIn ? (
                <>
                  <Link
                    href="/overview"
                    onClick={() => setOpen(false)}
                    className="px-3 py-2.5 rounded-full text-sm font-semibold text-white text-center"
                    style={{ background: "#812549" }}
                  >
                    {t("dashboard")}
                  </Link>
                  <button
                    onClick={() => { setOpen(false); signOut({ redirectUrl: "/" }); }}
                    className="px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors hover:bg-black/[0.04]"
                    style={{ color: "#4F4A4A" }}
                  >
                    {t("signOut")}
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="px-3 py-2.5 rounded-full text-sm font-semibold text-white text-center"
                    style={{ background: "#812549" }}
                  >
                    {t("getStarted")}
                  </Link>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-black/[0.04]"
                    style={{ color: "#4F4A4A" }}
                  >
                    {t("login")}
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
