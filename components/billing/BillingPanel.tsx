"use client";

import { useState } from "react";
import Link from "next/link";
import type { SubscriptionView } from "@/lib/billing/subscription-view";
import { priceLabelFor } from "@/lib/billing/plans";

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
}

const CARD = "rounded-2xl p-5 bg-white";
const CARD_SHADOW = { boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" };

// The in-app billing page: plan + renewal, switch plan, cancel/resume, card,
// invoices. Every change goes through PATCH /api/billing/subscription, which
// re-syncs the row from Stripe and returns the fresh view.
export default function BillingPanel({ initial }: { initial: SubscriptionView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(action: "cancel" | "resume" | "switch" | "keep", plan?: string) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/billing/subscription", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, plan }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setView(data);
      setConfirmCancel(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal");
      const data = await res.json();
      if (res.ok) { window.location.href = data.url; return; }
      setError(data.error ?? "Couldn't open the billing portal.");
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(null);
  }

  if (!view.isPremium && view.source !== "STRIPE") {
    return (
      <div className={CARD} style={CARD_SHADOW}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>Current plan</p>
        <p className="text-navy font-bold text-lg mb-1">Free</p>
        <p className="text-sm mb-5" style={{ color: "#848181" }}>
          Upgrade to unlock the full meal planner, weekly generation and Clara without limits.
        </p>
        <Link href="/pricing" className="inline-flex min-h-[44px] items-center px-6 rounded-2xl bg-primary text-white font-bold text-sm">
          See plans →
        </Link>
      </div>
    );
  }

  const isStripe = view.source === "STRIPE";
  const ending = view.cancelAtPeriodEnd;
  const lapsed = isStripe && !view.isPremium;

  return (
    <div className="flex flex-col gap-4">
      {view.status === "PAST_DUE" && (
        <div role="alert" className="rounded-2xl px-5 py-4 text-sm flex flex-wrap items-center gap-3" style={{ background: "#FFF3E0", color: "#b45309" }}>
          <span>Your last payment failed. Update your card to keep Premium.</span>
          <button type="button" onClick={() => void openPortal()} disabled={busy !== null} className="underline font-semibold min-h-[44px] disabled:opacity-60">
            Update payment method
          </button>
        </div>
      )}

      {/* Plan card */}
      <div className="rounded-2xl px-6 py-6 text-white" style={{ background: "linear-gradient(140deg, #5F1C35 0%, #812549 60%, #5F1C35 100%)" }}>
        <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>
          {lapsed ? "Premium · ended" : view.source === "STRIPE" ? "Premium" : `Premium · ${view.source?.toLowerCase()}`}
        </p>
        <p className="font-bold text-lg">{view.priceLabel ?? "Full access"}</p>
        {isStripe && (
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.75)" }}>
            {lapsed
              ? `Ended on ${fmtDate(view.periodEnd)}`
              : ending
                ? `Ends on ${fmtDate(view.periodEnd)}`
                : view.pendingPlan
                  ? `Switches to ${priceLabelFor(view.pendingPlan)} on ${fmtDate(view.periodEnd)}`
                  : `Renews on ${fmtDate(view.periodEnd)}`}
            {view.card ? ` · ${view.card.brand.toUpperCase()} •••• ${view.card.last4}` : ""}
          </p>
        )}
        {isStripe && (
          <div className="flex flex-wrap gap-2 mt-5">
            {lapsed ? (
              <Link href="/pricing" className="min-h-[44px] px-5 rounded-xl bg-white text-[#5F1C35] font-semibold text-sm inline-flex items-center">
                Resubscribe
              </Link>
            ) : ending ? (
              <button type="button" onClick={() => void change("resume")} disabled={busy !== null} className="min-h-[44px] px-5 rounded-xl bg-white text-[#5F1C35] font-semibold text-sm disabled:opacity-60">
                {busy === "resume" ? "…" : "Resume subscription"}
              </button>
            ) : view.pendingPlan ? (
              <button type="button" onClick={() => void change("keep")} disabled={busy !== null} className="min-h-[44px] px-5 rounded-xl bg-white text-[#5F1C35] font-semibold text-sm disabled:opacity-60">
                {busy === "keep" ? "…" : `Keep ${view.priceLabel}`}
              </button>
            ) : (
              view.canSwitchTo && (
                <button type="button" onClick={() => void change("switch", view.canSwitchTo!)} disabled={busy !== null} className="min-h-[44px] px-5 rounded-xl bg-white text-[#5F1C35] font-semibold text-sm disabled:opacity-60">
                  {busy === "switch" ? "…" : `Switch to ${priceLabelFor(view.canSwitchTo)}`}
                </button>
              )
            )}
            {!lapsed && (
              <button type="button" onClick={() => void openPortal()} disabled={busy !== null} className="min-h-[44px] px-5 rounded-xl font-semibold text-sm disabled:opacity-60" style={{ background: "rgba(255,255,255,0.12)" }}>
                {busy === "portal" ? "…" : "Update payment method"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Invoices */}
      {view.invoices.length > 0 && (
        <div className={CARD} style={CARD_SHADOW}>
          <p className="text-[9px] tracking-[0.28em] uppercase font-bold mb-3" style={{ color: "#ABA6A6" }}>Invoices</p>
          <ul className="divide-y divide-[#EAE4CA]">
            {view.invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-navy">{fmtDate(inv.date)}</span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-navy tabular-nums">{inv.amount}</span>
                  <span className="text-xs capitalize" style={{ color: "#848181" }}>{inv.status}</span>
                  {inv.pdfUrl && (
                    <a href={inv.pdfUrl} className="text-xs underline text-primary min-h-[44px] inline-flex items-center" target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cancel */}
      {isStripe && !ending && !lapsed && (
        <div className="text-center">
          {confirmCancel ? (
            <div role="dialog" aria-label="Cancel subscription" className="rounded-2xl p-5 bg-white inline-flex flex-col gap-3 max-w-md" style={{ boxShadow: "0 0 0 1px rgba(30,26,26,0.06)" }}>
              <p className="text-sm text-navy">
                Cancel Premium? You keep access until {fmtDate(view.periodEnd)}, and you can resume any time before then.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button type="button" onClick={() => void change("cancel")} disabled={busy !== null} className="min-h-[44px] px-5 rounded-xl text-white text-sm font-semibold bg-error disabled:opacity-60">
                  {busy === "cancel" ? "…" : "Yes, cancel at period end"}
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="min-h-[44px] px-5 rounded-xl text-sm font-semibold border border-[#EAE4CA] text-navy">
                  Keep Premium
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmCancel(true)} className="text-xs underline min-h-[44px]" style={{ color: "#848181" }}>
              Cancel subscription
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-center text-error">{error}</p>}
    </div>
  );
}
