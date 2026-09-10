"use client";

import { useEffect, useState } from "react";

// Stripe-backed promo codes (Coupon + Promotion Code). Lives above the legacy
// DB coupon table on /admin/coupons; nothing here touches our database.
interface PromoCode {
  id: string;
  code: string;
  active: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: string | null;
  coupon: { percentOff: number | null; amountOffCents: number | null; duration: "once" | "repeating" | "forever"; durationInMonths: number | null; name: string | null };
}

const fieldClass =
  "w-full bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-2.5 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelClass = "block text-[9px] tracking-[0.22em] uppercase font-bold mb-2";
const CARD_SHADOW = { boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" };

function describe(c: PromoCode["coupon"]) {
  const amount = c.percentOff != null ? `${c.percentOff}% off` : `$${((c.amountOffCents ?? 0) / 100).toFixed(2)} off`;
  const when = c.duration === "once" ? "first payment" : c.duration === "forever" ? "every payment" : `${c.durationInMonths} months`;
  return `${amount} · ${when}`;
}

export default function PromoCodesAdmin() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    code: "",
    kind: "percent" as "percent" | "amount",
    value: "20",
    duration: "once" as "once" | "repeating" | "forever",
    durationInMonths: "3",
    maxRedemptions: "",
    expiresAt: "",
    firstTimeOnly: true,
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/promo-codes");
      if (res.ok) setCodes((await res.json()).codes);
      else setError((await res.json()).error ?? "Couldn't load promo codes.");
    } catch {
      setError("Couldn't load promo codes.");
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    const body = {
      code: form.code,
      ...(form.kind === "percent" ? { percentOff: Number(form.value) } : { amountOffCents: Math.round(Number(form.value) * 100) }),
      duration: form.duration,
      ...(form.duration === "repeating" ? { durationInMonths: Number(form.durationInMonths) } : {}),
      ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}),
      ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
      firstTimeOnly: form.firstTimeOnly,
    };
    const res = await fetch("/api/admin/promo-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Couldn't create the promo code.");
    else { setForm({ ...form, code: "" }); void load(); }
    setCreating(false);
  }

  async function toggle(id: string, active: boolean) {
    await fetch("/api/admin/promo-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active: !active }) });
    void load();
  }

  return (
    <>
      <div className="ov bg-white rounded-2xl p-7 mb-6" style={{ animationDelay: "70ms", ...CARD_SHADOW }}>
        <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ABA6A6" }}>New promo code (Stripe)</p>
        <p className="text-xs mb-6" style={{ color: "#848181" }}>Customers enter it on the pricing page; the discount applies at checkout.</p>
        <form onSubmit={handleCreate} className="grid sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="promo-code" className={labelClass} style={{ color: "#ABA6A6" }}>Code</label>
            <input
              id="promo-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="SAVE20"
              className={`${fieldClass} font-mono uppercase tracking-widest`}
              required
            />
          </div>
          <div>
            <label htmlFor="promo-kind" className={labelClass} style={{ color: "#ABA6A6" }}>Discount</label>
            <div className="flex gap-2">
              <select id="promo-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "percent" | "amount" })} className={fieldClass}>
                <option value="percent">% off</option>
                <option value="amount">$ off</option>
              </select>
              <input aria-label={form.kind === "percent" ? "Percent off" : "Dollars off"} type="number" min="0.01" step={form.kind === "percent" ? "1" : "0.01"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={fieldClass} required />
            </div>
          </div>
          <div>
            <label htmlFor="promo-duration" className={labelClass} style={{ color: "#ABA6A6" }}>Applies to</label>
            <div className="flex gap-2">
              <select id="promo-duration" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value as "once" | "repeating" | "forever" })} className={fieldClass}>
                <option value="once">First payment only</option>
                <option value="repeating">A number of months</option>
                <option value="forever">Every payment</option>
              </select>
              {form.duration === "repeating" && (
                <input aria-label="Months" type="number" min="1" value={form.durationInMonths} onChange={(e) => setForm({ ...form, durationInMonths: e.target.value })} className={fieldClass} required />
              )}
            </div>
          </div>
          <div>
            <label htmlFor="promo-max" className={labelClass} style={{ color: "#ABA6A6" }}>Max redemptions (blank = unlimited)</label>
            <input id="promo-max" type="number" min="1" value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="promo-expires" className={labelClass} style={{ color: "#ABA6A6" }}>Expires (optional)</label>
            <input id="promo-expires" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={fieldClass} />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#1E1A1A] self-end min-h-[44px]">
            <input type="checkbox" checked={form.firstTimeOnly} onChange={(e) => setForm({ ...form, firstTimeOnly: e.target.checked })} />
            First purchase only
          </label>
          {error && <p role="alert" className="sm:col-span-2 text-sm" style={{ color: "#EA5455" }}>{error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={creating} className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50" style={{ boxShadow: "0 4px 16px rgba(129,37,73,0.2)" }}>
              {creating ? "Creating…" : "Create promo code"}
            </button>
          </div>
        </form>
      </div>

      <div className="ov bg-white rounded-2xl overflow-hidden mb-6" style={{ animationDelay: "100ms", ...CARD_SHADOW }}>
        <div className="px-6 py-4 border-b border-[#EAE4CA]" style={{ background: "#F9F7ED" }}>
          <p className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>Promo codes · {codes.length}</p>
        </div>
        {loading ? (
          <p className="px-6 py-8 text-sm text-center" style={{ color: "#ABA6A6" }}>Loading…</p>
        ) : codes.length === 0 ? (
          <p className="px-6 py-8 text-sm text-center" style={{ color: "#ABA6A6" }}>No promo codes yet.</p>
        ) : (
          <div className="divide-y divide-[#F5F1DD]">
            {codes.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-6 py-4 hover:bg-[#F9F7ED] transition-colors">
                <div className="w-0.5 h-10 rounded-full flex-shrink-0" style={{ background: c.active ? "#812549" : "#848181" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono font-black text-[#1E1A1A] text-sm tracking-widest">{c.code}</span>
                    {!c.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#F5F1DD", color: "#848181" }}>INACTIVE</span>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: "#ABA6A6" }}>
                    <span>{describe(c.coupon)}</span>
                    <span>· {c.timesRedeemed}/{c.maxRedemptions ?? "∞"} uses</span>
                    {c.expiresAt && <span>· Expires {new Date(c.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(c.id, c.active)}
                  className="text-xs font-bold px-4 py-1.5 rounded-xl border transition-colors flex-shrink-0 min-h-[44px]"
                  style={c.active
                    ? { borderColor: "rgba(234,84,85,0.3)", color: "#EA5455", background: "rgba(234,84,85,0.04)" }
                    : { borderColor: "rgba(129,37,73,0.3)", color: "#5F1C35", background: "rgba(129,37,73,0.04)" }}
                >
                  {c.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
