"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

// One redeem box for every surface that shows it: the Settings menu, the
// Premium gate, and the Free card on the billing page. Posts to
// /api/coupon/redeem and, on success, refreshes the server-rendered layout so
// PremiumGuard lets the user through without a reload.
export default function RedeemCodeBox({
  onDone,
  autoFocus = false,
  compact = false,
}: {
  onDone?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("dashboardHeader");
  // Two boxes can be on screen at once (Settings menu + Free card / gate).
  const inputId = useId();
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
        const until = data.accessUntil ? new Date(data.accessUntil).toLocaleDateString() : null;
        const message =
          data.type === "ADMIN"
            ? t("adminActivated")
            : until
              ? t("premiumActivatedUntil", { date: until })
              : t("premiumActivated");
        setResult({ success: true, message });
        setCode("");
        setTimeout(() => {
          router.refresh();
          onDone?.();
        }, 1500);
      }
    } catch {
      setResult({ success: false, message: t("error") });
    } finally {
      setLoading(false);
    }
  }

  const inputClass = compact
    ? "flex-1 min-w-0 bg-[#F8F7FA] border border-[#EAE4CA] rounded-lg px-3 py-2 min-h-[44px] text-xs font-mono text-[#1E1A1A] placeholder:text-[#C0C0C4] uppercase tracking-widest focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
    : "flex-1 min-w-0 bg-white border border-[#EAE4CA] rounded-xl px-4 py-2.5 min-h-[44px] text-sm font-mono text-[#1E1A1A] placeholder:text-[#C0C0C4] uppercase tracking-widest focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20";
  const buttonClass = compact
    ? "bg-primary hover:bg-primary-dark text-white px-3 min-h-[44px] rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    : "bg-primary hover:bg-primary-dark text-white px-5 min-h-[44px] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t("redeemCouponTitle")}
        </label>
        <input
          id={inputId}
          data-testid="redeem-code"
          autoFocus={autoFocus}
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t("enterCode")}
          disabled={loading}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={inputClass}
        />
        <button type="submit" disabled={loading || !code.trim()} className={buttonClass}>
          {loading ? "…" : t("apply")}
        </button>
      </form>
      {result && (
        <p
          role={result.success ? "status" : "alert"}
          className={`mt-2 text-xs font-medium ${result.success ? "text-emerald-600" : "text-red-500"}`}
        >
          {result.success ? "✓" : "✗"} {result.message}
        </p>
      )}
    </div>
  );
}
