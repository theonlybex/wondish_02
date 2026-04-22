"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

interface DashboardHeaderProps {
  email?: string | null;
  name?: string | null;
  plan: string;
  onMenuToggle?: () => void;
}

function CouponInput({ onClose }: { onClose: () => void }) {
  const t = useTranslations("dashboardHeader");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/coupon/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ success: false, message: data.error });
      } else {
        setResult({ success: true, message: data.message });
        setCode("");
        setTimeout(() => { router.refresh(); onClose(); }, 1500);
      }
    } catch {
      setResult({ success: false, message: t("error") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 pb-4 pt-1">
      <p className="text-[#8A8D93] text-xs mb-3">{t("enterCoupon")}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          autoFocus
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t("enterCode")}
          disabled={loading}
          className="flex-1 min-w-0 bg-[#F8F7FA] border border-[#E8E7EA] rounded-lg px-3 py-2 text-xs font-mono text-[#25293C] placeholder:text-[#C0C0C4] uppercase tracking-widest focus:outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="bg-primary hover:bg-primary-dark text-white px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? "…" : t("apply")}
        </button>
      </form>
      {result && (
        <p className={`mt-2 text-xs font-medium ${result.success ? "text-emerald-600" : "text-red-500"}`}>
          {result.success ? "✓" : "✗"} {result.message}
        </p>
      )}
    </div>
  );
}

export default function DashboardHeader({ email, name, plan, onMenuToggle }: DashboardHeaderProps) {
  const t = useTranslations("dashboardHeader");
  const [open, setOpen] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { signOut } = useClerk();
  const router = useRouter();

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCoupon(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="h-16 bg-white border-b border-[#E8E7EA] flex items-center justify-between px-5 sm:px-8">
      <button className="lg:hidden flex flex-col gap-1.5 p-1" onClick={onMenuToggle} aria-label="Toggle menu">
        <span className="w-5 h-0.5 bg-[#25293C] block" />
        <span className="w-5 h-0.5 bg-[#25293C] block" />
        <span className="w-5 h-0.5 bg-[#25293C] block" />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <span className="text-[#8A8D93] text-sm hidden sm:block">{email}</span>
        {plan === "ADMIN" ? (
          <Link href="/membership" className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">{t("adminBadge")}</Link>
        ) : plan === "PREMIUM" ? (
          <Link href="/membership" className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">{t("premiumBadge")}</Link>
        ) : (
          <Link href="/pricing" className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#F3F2FF] text-[#8A8D93] hover:bg-primary/10 hover:text-primary transition-colors">
            {t("upgrade")}
          </Link>
        )}

        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => { setOpen((v) => !v); setShowCoupon(false); }}
            className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm hover:bg-primary/30 transition-colors"
          >
            {name?.charAt(0).toUpperCase() ?? "?"}
          </button>

          {open && (
            <div className="absolute right-0 top-10 w-56 bg-white border border-[#E8E7EA] rounded-2xl shadow-xl shadow-black/8 z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#F0F0F2]">
                <p className="text-[#25293C] font-semibold text-sm truncate">{name}</p>
                <p className="text-[#8A8D93] text-xs truncate">{email}</p>
              </div>

              {!showCoupon ? (
                <>
                  <div className="py-1.5">
                    <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors">
                      <span className="text-base">👤</span> {t("myProfile")}
                    </Link>
                    <button onClick={() => setShowCoupon(true)} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors text-left">
                      <span className="text-base">🎟️</span> {t("redeemCoupon")}
                    </button>
                  </div>
                  <div className="border-t border-[#F0F0F2] py-1.5">
                    <button onClick={() => signOut(() => router.push("/login"))} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors text-left">
                      <span className="text-base">↩</span> {t("signOut")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                    <button onClick={() => setShowCoupon(false)} className="text-[#8A8D93] hover:text-[#25293C] transition-colors">←</button>
                    <p className="text-[#25293C] font-semibold text-sm">{t("redeemCouponTitle")}</p>
                  </div>
                  <CouponInput onClose={() => { setOpen(false); setShowCoupon(false); }} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
