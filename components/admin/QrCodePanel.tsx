"use client";

// Phase 3 §1 — ops mints, labels and retires the QR codes that go on tables,
// and sees what each one earned. The scan URL is the value that goes into the
// QR image, so copying it is the primary action here.

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { conversionRate, formatConversionRate } from "@/lib/restaurant-referrals";

interface QrCode {
  id: string;
  token: string;
  label: string;
  active: boolean;
  scans: number;
  signups: number;
  createdAt: string;
}

export default function QrCodePanel({ restaurantId }: { restaurantId: string }) {
  const [codes, setCodes] = useState<QrCode[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "mint" | row id
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/admin/restaurants/${restaurantId}/qr-codes`);
    if (res.ok) {
      const body = await res.json();
      setCodes(body.codes ?? []);
    } else {
      setCodes([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const scanUrl = (token: string) =>
    typeof window === "undefined" ? `/r/${token}` : `${window.location.origin}/r/${token}`;

  const mint = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("mint");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${restaurantId}/qr-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't create that code.");
        return;
      }
      setNotice(`"${body.code.label}" created — copy its link into a QR image.`);
      setLabel("");
      await load();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (code: QrCode) => {
    setBusy(code.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${restaurantId}/qr-codes/${code.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !code.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't update that code.");
        return;
      }
      setCodes((prev) =>
        (prev ?? []).map((c) => (c.id === code.id ? { ...c, active: !c.active } : c))
      );
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (code: QrCode) => {
    try {
      await navigator.clipboard.writeText(scanUrl(code.token));
      setCopied(code.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  };

  return (
    <section className="bg-white border border-[#EAE4CA] rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#EAE4CA]" style={{ background: "#F9F7ED" }}>
        <h2 className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
          QR codes
        </h2>
      </div>

      <form className="px-5 py-4 flex flex-wrap items-end gap-3 border-b border-[#EAE4CA]" onSubmit={mint}>
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="qr-label" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">
            Label
          </label>
          <input
            id="qr-label"
            type="text"
            required
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-[#EAE4CA] focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Table 7"
          />
        </div>
        <Button type="submit" loading={busy === "mint"} disabled={!label.trim()}>
          Create code
        </Button>
        <p className="w-full text-[11px]" style={{ color: "#ABA6A6" }}>
          Each code gets its own link. Put one per table to learn which placement works — the
          scan and sign-up counts below are per code.
        </p>
      </form>

      {error && <p className="px-5 pt-3 text-error text-xs">{error}</p>}
      {notice && <p className="px-5 pt-3 text-xs text-success">{notice}</p>}

      {codes === null ? (
        <p className="px-5 py-6 text-sm" style={{ color: "#ABA6A6" }}>
          Loading…
        </p>
      ) : codes.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="font-semibold text-[#1E1A1A] mb-1">No QR codes yet</p>
          <p className="text-sm" style={{ color: "#848181" }}>
            Create one above, turn its link into a QR image, and put it on a table.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#EAE4CA]">
          {codes.map((code) => (
            <li key={code.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[#1E1A1A]">{code.label}</p>
                    <Badge variant={code.active ? "success" : "neutral"}>
                      {code.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-xs mt-1 font-mono break-all" style={{ color: "#848181" }}>
                    {scanUrl(code.token)}
                  </p>
                  <p className="text-xs mt-1.5 tabular-nums" style={{ color: "#ABA6A6" }}>
                    {code.scans} scans · {code.signups} sign-ups ·{" "}
                    {formatConversionRate(conversionRate(code.scans, code.signups))} conversion
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copy(code)}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-xl border border-[#EAE4CA] text-xs font-semibold text-[#5C5757] hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {copied === code.id ? "Copied" : "Copy link"}
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === code.id}
                    onClick={() => void toggle(code)}
                  >
                    {code.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
