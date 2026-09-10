"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Runs the sync as soon as the page mounts so the user is Premium before the
// confirmation renders. If Stripe hasn't attached the subscription yet
// (409), retry a few times; the webhook is the eventual backstop either way.
export default function CheckoutSuccess({ sessionId }: { sessionId: string | null }) {
  const [state, setState] = useState<"syncing" | "premium" | "pending" | "error">("syncing");

  useEffect(() => {
    if (!sessionId) { setState("error"); return; }
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch("/api/billing/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          if (res.ok) {
            const data = await res.json();
            if (!cancelled) setState(data.isPremium ? "premium" : "pending");
            return;
          }
          if (res.status !== 409) break;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setState("pending");
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const cta = "inline-flex min-h-[48px] items-center px-8 rounded-2xl bg-primary text-white font-bold text-sm";

  return (
    <div className="max-w-md mx-auto text-center py-16" aria-live="polite">
      {state === "syncing" && (
        <>
          <div className="w-10 h-10 mx-auto mb-4 rounded-full border-4 border-primary/20 border-t-primary animate-spin" aria-hidden="true" />
          <p className="text-navy font-semibold">Confirming your subscription…</p>
        </>
      )}
      {state === "premium" && (
        <>
          <h1 className="text-2xl font-bold text-navy mb-2">You&apos;re Premium</h1>
          <p className="text-sm mb-8" style={{ color: "#848181" }}>Everything is unlocked. A receipt is on its way to your email.</p>
          <Link href="/meal-plan" className={cta}>Go to my meal plan →</Link>
          <p className="mt-4 text-xs"><Link href="/membership" className="underline" style={{ color: "#848181" }}>Manage billing</Link></p>
        </>
      )}
      {state === "pending" && (
        <>
          <h1 className="text-2xl font-bold text-navy mb-2">Payment received</h1>
          <p className="text-sm mb-8" style={{ color: "#848181" }}>Your Premium access will switch on within a minute. You can keep using Wondish meanwhile.</p>
          <Link href="/overview" className={cta}>Continue →</Link>
        </>
      )}
      {state === "error" && (
        <>
          <h1 className="text-2xl font-bold text-navy mb-2">We couldn&apos;t confirm that session</h1>
          <p className="text-sm mb-8" style={{ color: "#848181" }}>If you were charged, your access will activate automatically. Otherwise, try again.</p>
          <Link href="/pricing" className={cta}>Back to pricing</Link>
        </>
      )}
    </div>
  );
}
