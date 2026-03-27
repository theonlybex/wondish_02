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

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

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
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy mb-1">Coupon Management</h1>
        <p className="text-[#8A8D93] text-sm">Create and manage coupon codes for admin or premium access.</p>
      </div>

      {/* Create form */}
      <div className="bg-white border border-[#E8E7EA] rounded-2xl p-6 mb-8">
        <h2 className="text-navy font-semibold mb-5">Create new coupon</h2>
        <form onSubmit={handleCreate} className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-1.5">Code</label>
            <div className="flex gap-2">
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="flex-1 bg-[#F8F7FA] border border-[#E8E7EA] rounded-xl px-3 py-2.5 text-sm font-mono text-navy uppercase tracking-widest focus:outline-none focus:border-primary/50"
                required
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, code: randomCode() })}
                className="px-3 py-2.5 text-xs text-[#8A8D93] border border-[#E8E7EA] rounded-xl hover:border-primary/30 hover:text-primary transition-colors"
              >
                ↺
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-1.5">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as "ADMIN" | "PREMIUM" })}
              className="w-full bg-[#F8F7FA] border border-[#E8E7EA] rounded-xl px-3 py-2.5 text-sm text-navy focus:outline-none focus:border-primary/50"
            >
              <option value="PREMIUM">Premium — activates subscription for free</option>
              <option value="ADMIN">Admin — full unlimited access (SUPER role)</option>
            </select>
          </div>

          <div>
            <label className="block text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-1.5">Max uses (−1 = unlimited)</label>
            <input
              type="number"
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              className="w-full bg-[#F8F7FA] border border-[#E8E7EA] rounded-xl px-3 py-2.5 text-sm text-navy focus:outline-none focus:border-primary/50"
              min="-1"
              required
            />
          </div>

          <div>
            <label className="block text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-1.5">Expires (optional)</label>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className="w-full bg-[#F8F7FA] border border-[#E8E7EA] rounded-xl px-3 py-2.5 text-sm text-navy focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[#8A8D93] text-xs font-medium uppercase tracking-wider mb-1.5">Internal note (optional)</label>
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="e.g. For team members"
              className="w-full bg-[#F8F7FA] border border-[#E8E7EA] rounded-xl px-3 py-2.5 text-sm text-navy placeholder:text-[#C0C0C4] focus:outline-none focus:border-primary/50"
            />
          </div>

          {error && (
            <p className="sm:col-span-2 text-red-500 text-sm">{error}</p>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="bg-primary hover:bg-primary-dark text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create coupon"}
            </button>
          </div>
        </form>
      </div>

      {/* Coupons list */}
      <div className="bg-white border border-[#E8E7EA] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E8E7EA]">
          <h2 className="text-navy font-semibold">All coupons</h2>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-[#8A8D93] text-sm">Loading…</div>
        ) : coupons.length === 0 ? (
          <div className="px-6 py-8 text-center text-[#8A8D93] text-sm">No coupons yet.</div>
        ) : (
          <div className="divide-y divide-[#F0F0F2]">
            {coupons.map((c) => (
              <div key={c.id} className="px-6 py-4 flex items-center gap-4">
                {/* Code */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono font-bold text-navy text-sm tracking-widest">{c.code}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        c.type === "ADMIN"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {c.type}
                    </span>
                    {!c.isActive && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        INACTIVE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[#8A8D93] text-xs">
                    <span>{c._count.redemptions}/{c.maxUses === -1 ? "∞" : c.maxUses} uses</span>
                    {c.note && <span>· {c.note}</span>}
                    {c.expiresAt && (
                      <span>· Expires {new Date(c.expiresAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggleActive(c.id, c.isActive)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                    c.isActive
                      ? "border-red-200 text-red-500 hover:bg-red-50"
                      : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                  }`}
                >
                  {c.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
