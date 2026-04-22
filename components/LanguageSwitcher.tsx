"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";

const LOCALES = [
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "ru", flag: "🇷🇺", label: "RU" },
  { code: "es", flag: "🇪🇸", label: "ES" },
];

type LocaleCode = (typeof LOCALES)[number]["code"];

export default function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onMouse = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [open]);

  async function handleSelect(code: LocaleCode) {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/set-locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      setOpen(false);
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-white/60 hover:text-white px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-all duration-150 text-sm font-medium"
      >
        <span>{current.flag}</span>
        <span>{current.label}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-11 w-28 bg-forest-deeper border border-white/10 rounded-xl shadow-xl overflow-hidden z-50">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              role="menuitem"
              disabled={pending}
              onClick={() => handleSelect(l.code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                l.code === locale
                  ? "text-primary bg-primary/10"
                  : "text-white/60 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              <span>{l.flag}</span>
              <span className="font-medium">{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
