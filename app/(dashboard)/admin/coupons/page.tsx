"use client";

import { useEffect, useState } from "react";

interface Coupon {
  id: string;
  code: string;
  type: "ADMIN" | "PREMIUM";
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  _count: { redemptions: number };
}

const ANIM = `
  @keyframes ov-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
`;

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

const fieldClass =
  "w-full bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-2.5 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";

const labelClass =
  "block text-[9px] tracking-[0.22em] uppercase font-bold mb-2";

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    code: randomCode(),
    type: "PREMIUM" as "ADMIN" | "PREMIUM",
    maxUses: "1",
    expiresAt: "",
    note: "",
  });
  const [error, setError] = useState("");

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
        note: form.note || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
    } else {
      setForm({ code: randomCode(), type: "PREMIUM", maxUses: "1", expiresAt: "", note: "" });
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
              Create and manage coupon codes for admin or premium access
            </p>
          </div>
        </div>

        {/* Create form */}
        <div
          className="ov bg-white rounded-2xl p-7 mb-6"
          style={{
            animationDelay: "70ms",
            boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)",
          }}
        >
          <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-6" style={{ color: "#ABA6A6" }}>
            New Coupon
          </p>
          <form onSubmit={handleCreate} className="grid sm:grid-cols-2 gap-5">
            {/* Code */}
            <div>
              <label className={labelClass} style={{ color: "#ABA6A6" }}>Code</label>
              <div className="flex gap-2">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="flex-1 bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-2.5 text-sm font-mono text-[#1E1A1A] uppercase tracking-widest outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  required
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, code: randomCode() })}
                  className="px-3 py-2.5 text-sm border border-[#EAE4CA] rounded-xl hover:border-primary/30 hover:text-primary transition-colors"
                  style={{ color: "#ABA6A6" }}
                  title="Generate new code"
                >
                  ↺
                </button>
              </div>
            </div>

            {/* Type */}
            <div>
              <label className={labelClass} style={{ color: "#ABA6A6" }}>Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "ADMIN" | "PREMIUM" })}
                className={fieldClass}
              >
                <option value="PREMIUM">Premium — activates subscription for free</option>
                <option value="ADMIN">Admin — full unlimited access (SUPER role)</option>
              </select>
            </div>

            {/* Max uses */}
            <div>
              <label className={labelClass} style={{ color: "#ABA6A6" }}>Max Uses (−1 = unlimited)</label>
              <input
                type="number"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                className={fieldClass}
                min="-1"
                required
              />
            </div>

            {/* Expires */}
            <div>
              <label className={labelClass} style={{ color: "#ABA6A6" }}>Expires (optional)</label>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className={fieldClass}
              />
            </div>

            {/* Note */}
            <div className="sm:col-span-2">
              <label className={labelClass} style={{ color: "#ABA6A6" }}>Internal Note (optional)</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. For team members"
                className={fieldClass}
              />
            </div>

            {error && (
              <p className="sm:col-span-2 text-sm" style={{ color: "#EA5455" }}>{error}</p>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                style={{ boxShadow: "0 4px 16px rgba(129,37,73,0.2)" }}
              >
                {creating ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#F5F1DD" }}>
                <svg className="animate-spin text-primary" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: "#ABA6A6" }}>Loading…</p>
            </div>
          ) : coupons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="text-4xl mb-4">🎟</div>
              <p className="text-[#1E1A1A] font-semibold mb-1">No coupons yet</p>
              <p className="text-sm" style={{ color: "#ABA6A6" }}>Create one above to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F5F1DD]">
              {coupons.map((c) => (
                <div key={c.id} className="flex items-center gap-4 px-6 py-4 hover:bg-[#F9F7ED] transition-colors">
                  {/* Status accent */}
                  <div
                    className="w-0.5 h-10 rounded-full flex-shrink-0"
                    style={{ background: c.isActive ? "#812549" : "#848181" }}
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
                    <div className="flex items-center gap-3 flex-wrap" style={{ color: "#ABA6A6" }}>
                      <span className="text-xs">
                        {c._count.redemptions}/{c.maxUses === -1 ? "∞" : c.maxUses} uses
                      </span>
                      {c.note && <span className="text-xs">· {c.note}</span>}
                      {c.expiresAt && (
                        <span className="text-xs">
                          · Expires {new Date(c.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => toggleActive(c.id, c.isActive)}
                    className="text-xs font-bold px-4 py-1.5 rounded-xl border transition-colors flex-shrink-0"
                    style={
                      c.isActive
                        ? { borderColor: "rgba(234,84,85,0.3)", color: "#EA5455", background: "rgba(234,84,85,0.04)" }
                        : { borderColor: "rgba(129,37,73,0.3)", color: "#5F1C35", background: "rgba(129,37,73,0.04)" }
                    }
                  >
                    {c.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
