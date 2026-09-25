"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import RedeemCodeBox from "@/components/billing/RedeemCodeBox";

interface DashboardHeaderProps {
  email?: string | null;
  name?: string | null;
  plan: string;
  onMenuToggle?: () => void;
  // Account created today → "Welcome", not "Welcome back".
  isNew?: boolean;
}

function CouponInput({ onClose }: { onClose: () => void }) {
  const t = useTranslations("dashboardHeader");
  return (
    <div className="px-4 pb-4 pt-1">
      <p className="text-[#848181] text-xs mb-3">{t("enterCoupon")}</p>
      <RedeemCodeBox onDone={onClose} autoFocus compact />
    </div>
  );
}

export default function DashboardHeader({ email, name, plan, onMenuToggle, isNew = false }: DashboardHeaderProps) {
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
    <header className="relative z-10 h-16 bg-white/80 backdrop-blur-sm border-b border-[#EAE4CA]/80 flex items-center justify-between px-5 sm:px-8">
      <button className="lg:hidden flex flex-col gap-1.5 p-1 touch-target" onClick={onMenuToggle} aria-label="Toggle menu">
        <span className="w-5 h-0.5 bg-[#1E1A1A] block rounded-full" />
        <span className="w-5 h-0.5 bg-[#1E1A1A] block rounded-full" />
        <span className="w-5 h-0.5 bg-[#1E1A1A] block rounded-full" />
      </button>

      <div className="hidden lg:flex flex-col justify-center">
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono leading-none mb-0.5" style={{ color: "#B75E78" }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <p className="text-sm font-bold text-[#1E1A1A] leading-tight">
          {isNew ? "Welcome" : "Welcome back"}, {name?.split(" ")[0]}.
        </p>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {plan === "ADMIN" ? (
          <Link href="/membership" className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200/80 text-amber-700 hover:bg-amber-100 transition-colors">
            <span className="text-[10px]">★</span>{t("adminBadge")}
          </Link>
        ) : plan === "PREMIUM" ? (
          <Link href="/membership" className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#ffffff] border border-primary/20 text-primary hover:bg-primary/10 transition-colors">
            <span className="text-[10px]">✦</span>{t("premiumBadge")}
          </Link>
        ) : plan === "BETA" ? (
          // A coupon tester: its own pill — neither the muted Free outline nor
          // the Plus star — and it points at /pricing because the useful next
          // step for a tester is subscribing, not managing billing.
          <Link href="/pricing" className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#F9F7ED] border border-[#5F1C35]/25 text-[#5F1C35] hover:bg-[#F5F1DD] hover:border-[#5F1C35]/45 transition-colors">
            {t("betaBadge")}
          </Link>
        ) : (
          <Link href="/pricing" className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border border-[#EAE4CA] text-[#848181] hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-colors">
            {t("upgrade")}
          </Link>
        )}

        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => { setOpen((v) => !v); setShowCoupon(false); }}
            className="px-3 py-1.5 rounded-xl bg-[#ffffff] border border-primary/20 text-primary font-semibold text-xs hover:border-primary/40 hover:bg-primary/10 transition-all"
          >
            Settings
          </button>

          {open && (
            <div className="absolute right-0 top-11 w-56 bg-white border border-[#EAE4CA] rounded-2xl shadow-2xl shadow-black/10 z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#F0F0F2] bg-[#FAFAF9]">
                <p className="text-[#1E1A1A] font-semibold text-sm">Settings</p>
              </div>

              {!showCoupon ? (
                <>
                  <div className="py-1.5">
                    <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors">
                      <span className="text-base">👤</span> {t("myProfile")}
                    </Link>
                    <Link href="/orders" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors">
                      <span className="text-base">📦</span> {t("myOrders")}
                    </Link>
                    {/* Prediction removed (2026-09-07) — link hidden.
                    <Link href="/prediction" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors">
                      <span className="text-base">🎯</span> {t("myPrediction")}
                    </Link> */}
                    <Link href="/membership" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors">
                      <span className="text-base">⭐</span> {t("myMembership")}
                    </Link>
                    <button onClick={() => setShowCoupon(true)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#4A4E5C] hover:bg-[#F8F7FA] transition-colors text-left">
                      <span className="text-base">🎟️</span> {t("redeemCoupon")}
                    </button>
                  </div>
                  <div className="border-t border-[#F0F0F2] py-1.5">
                    <button onClick={() => signOut(() => router.push("/"))} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors text-left">
                      <span className="text-base">↩</span> {t("signOut")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                    <button onClick={() => setShowCoupon(false)} className="text-[#848181] hover:text-[#1E1A1A] transition-colors">←</button>
                    <p className="text-[#1E1A1A] font-semibold text-sm">{t("redeemCouponTitle")}</p>
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
