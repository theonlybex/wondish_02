"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { parseClaimNotice, type ClaimNoticeKind } from "@/lib/pending-coupon";

// One-time notice for a coupon code entered on the pricing page BEFORE sign-up
// and redeemed by /r/claim (lib/pending-coupon.ts). Lives in the dashboard
// layout rather than on /profile because a returning user (Google sign-up on
// an existing account) is bounced from onboarding to /overview. Reads
// `?coupon=` after mount (no useSearchParams → no Suspense boundary needed)
// and strips it, so a reload or a shared URL doesn't replay the message.
export default function CouponClaimNotice() {
  const t = useTranslations("couponClaim");
  const locale = useLocale();
  const [notice, setNotice] = useState<{ kind: ClaimNoticeKind; until: string | null } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const parsed = parseClaimNotice(url.searchParams.get("coupon") ?? undefined);
    if (!url.searchParams.has("coupon")) return;
    url.searchParams.delete("coupon");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setNotice(parsed);
  }, []);

  if (!notice) return null;

  const ok = notice.kind === "activated" || notice.kind === "paid" || notice.kind === "stripe";
  const message =
    notice.kind === "activated"
      ? notice.until
        ? t("activatedUntil", {
            date: new Date(`${notice.until}T00:00:00Z`).toLocaleDateString(locale, {
              timeZone: "UTC",
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
          })
        : t("activated")
      : t(notice.kind);

  return (
    <div
      role={ok ? "status" : "alert"}
      className="flex items-center justify-center gap-3 px-5 py-1 text-sm"
      style={ok ? { background: "#E3F6F3", color: "#00332D" } : { background: "#F5F1DD", color: "#5F1C35" }}
    >
      <span className="py-1.5">{message}</span>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label={t("dismiss")}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
