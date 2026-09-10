"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, formatCents, perMonthCents, savingsPct, type PlanKey } from "@/lib/billing/plans";

export interface PlanPickerLabels {
  monthly: string;
  sixMonth: string;
  perMonth: string;
  save: string;
  havePromo: string;
  promoPlaceholder: string;
  apply: string;
  invalidPromo: string;
  today: string;
  then: string;
  cta: string;
  cancelAnytime: string;
  billedEvery6: string;
}

type Preview = { valid: true; label: string; firstCharge: string; recurring: string } | { valid: false };

// Monthly / 6-month toggle, the price, an in-app promo code with a live
// preview, and the checkout CTA. Amounts come from the catalog; the server
// verifies them against Stripe before any session is created.
export default function PlanPicker({ defaultPlan = "sixmonth", labels }: { defaultPlan?: PlanKey; labels: PlanPickerLabels }) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanKey>(defaultPlan);
  const [promoOpen, setPromoOpen] = useState(false);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthly = PLANS.find((p) => p.key === "monthly")!;
  const selected = PLANS.find((p) => p.key === plan)!;
  const pct = savingsPct(selected, monthly);
  const period = selected.months === 1 ? "/ month" : "/ 6 months";

  async function checkPromo(nextPlan: PlanKey = plan) {
    if (!code.trim()) { setPreview(null); return; }
    setChecking(true);
    try {
      const res = await fetch("/api/billing/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, plan: nextPlan }),
      });
      setPreview(res.ok ? await res.json() : { valid: false });
    } catch {
      setPreview({ valid: false });
    } finally {
      setChecking(false);
    }
  }

  function choose(next: PlanKey) {
    setPlan(next);
    if (preview?.valid) void checkPromo(next);
  }

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, promoCode: preview?.valid ? code.trim() : undefined }),
      });
      if (res.status === 401) { router.push(`/register?plan=${plan}`); return; }
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? data.error ?? "Something went wrong. Please try again."); return; }
      window.location.href = data.alreadySubscribed ? data.portalUrl : data.url;
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Interval toggle */}
      <div role="radiogroup" aria-label="Billing interval" className="grid grid-cols-2 rounded-full p-1" style={{ background: "rgba(255,255,255,0.12)" }}>
        {PLANS.map((p) => {
          const active = p.key === plan;
          const s = savingsPct(p, monthly);
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(p.key)}
              className="min-h-[44px] rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              style={active ? { background: "#fff", color: "#5F1C35" } : { color: "rgba(255,255,255,0.85)" }}
            >
              {p.key === "monthly" ? labels.monthly : labels.sixMonth}
              {s > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FDC221", color: "#4a2c05" }}>
                  {labels.save.replace("{pct}", String(s))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Price */}
      <div>
        <div className="font-extrabold" style={{ fontSize: 52, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
          {formatCents(perMonthCents(selected)).replace(/\.00$/, "")}
          <span className="text-[17px] font-semibold ml-1" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: 0 }}>{labels.perMonth}</span>
        </div>
        <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
          {selected.months === 1 ? labels.cancelAnytime : labels.billedEvery6.replace("{amount}", formatCents(selected.amountCents))}
          {pct > 0 && selected.months > 1 ? ` · ${labels.save.replace("{pct}", String(pct))}` : ""}
        </p>
      </div>

      {/* Promo code */}
      <div>
        {!promoOpen ? (
          <button type="button" onClick={() => setPromoOpen(true)} className="text-xs underline underline-offset-2 min-h-[44px]" style={{ color: "rgba(255,255,255,0.8)" }}>
            {labels.havePromo}
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="promo" className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>{labels.havePromo}</label>
            <div className="flex gap-2">
              <input
                id="promo"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); }}
                onBlur={() => void checkPromo()}
                placeholder={labels.promoPlaceholder}
                autoCapitalize="characters"
                autoComplete="off"
                className="flex-1 min-w-0 min-h-[44px] rounded-xl px-3 text-sm text-[#1E1A1A] bg-white"
              />
              <button type="button" onClick={() => void checkPromo()} disabled={checking || !code.trim()} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-white/15 disabled:opacity-50">
                {checking ? "…" : labels.apply}
              </button>
            </div>
            {preview && (
              <p role="status" aria-live="polite" className="text-xs" style={{ color: preview.valid ? "#FDC221" : "#FFB4B4" }}>
                {preview.valid
                  ? `✓ ${preview.label} — ${labels.today.replace("{amount}", preview.firstCharge)}, ${labels.then.replace("{amount}", preview.recurring).replace("{period}", period)}`
                  : `✗ ${labels.invalidPromo}`}
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void checkout()}
        disabled={loading}
        className="w-full min-h-[48px] text-center px-7 py-[15px] rounded-full font-semibold text-[15px] bg-[#00B9A6] hover:bg-[#75C6BC] disabled:opacity-60 disabled:cursor-not-allowed text-[#00332D] transition-all hover:-translate-y-0.5"
      >
        {loading ? "Redirecting…" : labels.cta}
      </button>
      {error && <p role="alert" className="text-xs text-center" style={{ color: "#FFB4B4" }}>{error}</p>}
    </div>
  );
}
