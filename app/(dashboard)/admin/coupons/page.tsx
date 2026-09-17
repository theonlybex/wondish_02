"use client";

import { useEffect, useState } from "react";
import PromoCodesAdmin from "@/components/admin/PromoCodesAdmin";

interface Coupon {
  id: string;
  code: string;
  type: "ADMIN" | "PREMIUM";
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  accessUntil: string | null;
  note: string | null;
  createdAt: string;
  _count: { redemptions: number };
  redemptions: { redeemedAt: string; account: { email: string } }[];
}

const ANIM = `
  @keyframes ov-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
  @media (prefers-reduced-motion: reduce) { .ov { animation: none; } }
`;

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Default access end for a new premium code: 90 days out, as YYYY-MM-DD for
// <input type="date">. The server reads date-only values as end of day UTC.
function plusDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const fieldClass =
  "w-full bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-2.5 min-h-[44px] text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";

const labelClass =
  "block text-[9px] tracking-[0.22em] uppercase font-bold mb-2";

const emptyForm = () => ({
  code: randomCode(),
  type: "PREMIUM" as "ADMIN" | "PREMIUM",
  maxUses: "50",
  expiresAt: "",
  accessUntil: plusDays(90),
  note: "",
});

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendMsg, setExtendMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/coupons");
    if (res.ok) setCoupons(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        type: form.type,
        maxUses: form.maxUses === "-1" ? -1 : Number(form.maxUses),
        expiresAt: form.expiresAt || null,
        accessUntil: form.type === "PREMIUM" ? form.accessUntil || null : null,
        note: form.note || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
    } else {
      setForm(emptyForm());
      load();
    }
    setCreating(false);
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive: !current }),
    });
    load();
  }

  async function extendAccess(id: string) {
    setExtendBusy(true);
    setExtendMsg(null);
    const res = await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, accessUntil: extendDate }),
    });
    const data = await res.json();
    setExtendBusy(false);
    if (!res.ok) {
      setExtendMsg({ id, text: data.error, ok: false });
      return;
    }
    const n = data.extendedGrants as number;
    setExtendMsg({ id, text: `Extended. ${n} account${n === 1 ? "" : "s"} lifted to the new date.`, ok: true });
    setExtendId(null);
    setExtendDate("");
    load();
  }

  return (
    <>
      <style>{ANIM}</style>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[#1E1A1A]">Coupons</h1>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px w-12 bg-primary/40" />
            <p className="text-xs" style={{ color: "#848181" }}>
              Premium-type codes grant beta access (about half of Plus&apos;s allowances) until a date you set. Admin codes grant the SUPER role. Stripe promo codes (above) discount paid checkout.
            </p>
          </div>
        </div>

        <PromoCodesAdmin />

        {/* Create form */}
        <div
          className="ov bg-white rounded-2xl p-7 mb-6"
          style={{
            animationDelay: "70ms",
            boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
          }}
        >
          <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-6" style={{ color: "#ABA6A6" }}>
            New Code
          </p>
          <form onSubmit={handleCreate} className="grid sm:grid-cols-2 gap-5">
            {/* Code */}
            <div>
              <label htmlFor="coupon-code" className={labelClass} style={{ color: "#ABA6A6" }}>Code</label>
              <div className="flex gap-2">
                <input
                  id="coupon-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="flex-1 min-w-0 bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-2.5 min-h-[44px] text-sm font-mono text-[#1E1A1A] uppercase tracking-widest outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  required
                  minLength={4}
                  maxLength={24}
                  pattern="[A-Za-z0-9_-]+"
                  title="4–24 letters, digits, _ or -"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, code: randomCode() })}
                  className="px-3 min-h-[44px] min-w-[44px] text-sm border border-[#EAE4CA] rounded-xl hover:border-primary/30 hover:text-primary transition-colors"
                  style={{ color: "#ABA6A6" }}
                  aria-label="Generate a new random code"
                  title="Generate new code"
                >
                  ↺
                </button>
              </div>
            </div>

            {/* Type */}
            <div>
              <label htmlFor="coupon-type" className={labelClass} style={{ color: "#ABA6A6" }}>Type</label>
              <select
                id="coupon-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "ADMIN" | "PREMIUM" })}
                className={fieldClass}
              >
                <option value="PREMIUM">Beta access — half of Plus&apos;s limits until a date</option>
                <option value="ADMIN">Admin — full unlimited access (SUPER role)</option>
              </select>
            </div>

            {/* Max uses */}
            <div>
              <label htmlFor="coupon-max" className={labelClass} style={{ color: "#ABA6A6" }}>Max Uses (−1 = unlimited)</label>
              <input
                id="coupon-max"
                type="number"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                className={fieldClass}
                min="-1"
                step="1"
                required
              />
              <p className="mt-1.5 text-[11px]" style={{ color: "#ABA6A6" }}>
                How many different accounts can redeem it. Each account can use a code once.
              </p>
            </div>

            {/* Redeem by */}
            <div>
              <label htmlFor="coupon-expires" className={labelClass} style={{ color: "#ABA6A6" }}>Redeem by (optional)</label>
              <input
                id="coupon-expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className={fieldClass}
              />
              <p className="mt-1.5 text-[11px]" style={{ color: "#ABA6A6" }}>
                After this day the code stops working for new redemptions.
              </p>
            </div>

            {/* Access until (PREMIUM only) */}
            {form.type === "PREMIUM" && (
              <div>
                <label htmlFor="coupon-access" className={labelClass} style={{ color: "#ABA6A6" }}>Access until (required)</label>
                <input
                  id="coupon-access"
                  type="date"
                  value={form.accessUntil}
                  onChange={(e) => setForm({ ...form, accessUntil: e.target.value })}
                  className={fieldClass}
                  required
                />
                <p className="mt-1.5 text-[11px]" style={{ color: "#ABA6A6" }}>
                  Beta access switches off at the end of this day for everyone who used the code.
                </p>
              </div>
            )}

            {/* Note */}
            <div className="sm:col-span-2">
              <label htmlFor="coupon-note" className={labelClass} style={{ color: "#ABA6A6" }}>Internal Note (optional)</label>
              <input
                id="coupon-note"
                type="text"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. Beta cohort 1"
                maxLength={200}
                className={fieldClass}
              />
            </div>

            {error && (
              <p role="alert" className="sm:col-span-2 text-sm" style={{ color: "#EA5455" }}>{error}</p>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 min-h-[44px] rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ boxShadow: "0 4px 16px rgba(129,37,73,0.2)" }}
              >
                {creating ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                    </svg>
                    Creating…
                  </>
                ) : "Create Coupon"}
              </button>
            </div>
          </form>
        </div>

        {/* Coupons list */}
        <div
          className="ov bg-white rounded-2xl overflow-hidden"
          style={{
            animationDelay: "130ms",
            boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
          }}
        >
          <div className="px-6 py-4 border-b border-[#EAE4CA]" style={{ background: "#F9F7ED" }}>
            <p className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
              All Coupons · {coupons.length}
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3" aria-busy="true">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#F5F1DD" }}>
                <svg className="animate-spin text-primary" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: "#ABA6A6" }}>Loading…</p>
            </div>
          ) : coupons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-[#1E1A1A] font-semibold mb-1">No coupons yet</p>
              <p className="text-sm" style={{ color: "#ABA6A6" }}>Create one above to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F5F1DD]">
              {coupons.map((c) => {
                const redeemersOpen = openId === c.id;
                const extending = extendId === c.id;
                return (
                  <div key={c.id} className="px-6 py-4 hover:bg-[#F9F7ED] transition-colors">
                    <div className="flex items-start gap-4">
                      {/* Status accent */}
                      <div
                        className="w-0.5 h-10 rounded-full flex-shrink-0 mt-1"
                        style={{ background: c.isActive ? "#812549" : "#848181" }}
                        aria-hidden="true"
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-mono font-black text-[#1E1A1A] text-sm tracking-widest">
                            {c.code}
                          </span>
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={
                              c.type === "ADMIN"
                                ? { background: "rgba(124,58,237,0.1)", color: "#7c3aed" }
                                : { background: "rgba(129,37,73,0.1)", color: "#5F1C35" }
                            }
                          >
                            {c.type}
                          </span>
                          {!c.isActive && (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "#F5F1DD", color: "#848181" }}
                            >
                              INACTIVE
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs" style={{ color: "#848181" }}>
                          {/* usedCount is the cap that matters; redemption rows cascade away
                              when an account is deleted, so _count can lag behind it. */}
                          <span className="tabular-nums">
                            {c.usedCount}/{c.maxUses === -1 ? "∞" : c.maxUses} uses
                          </span>
                          {c.expiresAt && <span>· Redeem by {fmtDate(c.expiresAt)}</span>}
                          {c.accessUntil && <span>· Access until {fmtDate(c.accessUntil)}</span>}
                          {c.note && <span>· {c.note}</span>}
                          {c.redemptions.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setOpenId(redeemersOpen ? null : c.id)}
                              aria-expanded={redeemersOpen}
                              aria-controls={`redeemers-${c.id}`}
                              className="underline underline-offset-2 min-h-[44px] sm:min-h-0 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
                              style={{ color: "#812549" }}
                            >
                              {redeemersOpen ? "Hide who used it" : `Who used it (${c.redemptions.length})`}
                            </button>
                          )}
                        </div>

                        {redeemersOpen && (
                          <ul id={`redeemers-${c.id}`} className="mt-2 space-y-1">
                            {c.redemptions.map((r) => (
                              <li key={`${r.account.email}-${r.redeemedAt}`} className="text-xs font-mono" style={{ color: "#4A4E5C" }}>
                                {r.account.email} · {fmtDate(r.redeemedAt)}
                              </li>
                            ))}
                          </ul>
                        )}

                        {extending && (
                          <form
                            onSubmit={(e) => { e.preventDefault(); void extendAccess(c.id); }}
                            className="mt-3 flex flex-wrap items-end gap-2"
                          >
                            <div>
                              <label htmlFor={`extend-${c.id}`} className={labelClass} style={{ color: "#ABA6A6" }}>
                                New access end
                              </label>
                              <input
                                id={`extend-${c.id}`}
                                type="date"
                                value={extendDate}
                                onChange={(e) => setExtendDate(e.target.value)}
                                min={c.accessUntil ? c.accessUntil.slice(0, 10) : undefined}
                                className={fieldClass + " max-w-[200px]"}
                                required
                                autoFocus
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={extendBusy || !extendDate}
                              className="bg-primary text-white text-xs font-bold px-4 min-h-[44px] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {extendBusy ? "Extending…" : "Move access end"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setExtendId(null); setExtendDate(""); setExtendMsg(null); }}
                              className="text-xs font-semibold px-3 min-h-[44px] rounded-xl"
                              style={{ color: "#848181" }}
                            >
                              Cancel
                            </button>
                            <p className="basis-full text-[11px]" style={{ color: "#ABA6A6" }}>
                              Lifts everyone who used this code to the new date. Never shortens anyone.
                            </p>
                          </form>
                        )}

                        {extendMsg && extendMsg.id === c.id && (
                          <p role={extendMsg.ok ? "status" : "alert"} className="mt-2 text-xs" style={{ color: extendMsg.ok ? "#5F1C35" : "#EA5455" }}>
                            {extendMsg.text}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
                        {c.type === "PREMIUM" && (
                          <button
                            type="button"
                            onClick={() => { setExtendId(extending ? null : c.id); setExtendDate(""); setExtendMsg(null); }}
                            aria-expanded={extending}
                            className="text-xs font-bold px-4 min-h-[44px] rounded-xl border transition-colors"
                            style={{ borderColor: "rgba(129,37,73,0.3)", color: "#5F1C35", background: "rgba(129,37,73,0.04)" }}
                          >
                            Extend access
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleActive(c.id, c.isActive)}
                          className="text-xs font-bold px-4 min-h-[44px] rounded-xl border transition-colors"
                          style={
                            c.isActive
                              ? { borderColor: "rgba(234,84,85,0.3)", color: "#EA5455", background: "rgba(234,84,85,0.04)" }
                              : { borderColor: "rgba(129,37,73,0.3)", color: "#5F1C35", background: "rgba(129,37,73,0.04)" }
                          }
                        >
                          {c.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
