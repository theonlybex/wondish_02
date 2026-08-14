"use client";

// Phase 3 §5 — ops referral reporting. A scan is anonymous, so the screen is
// two halves: an aggregate strip (scans / sign-ups / conversion) and, below
// it, one row per referred ACCOUNT — which by definition only exists after a
// sign-up.

import { useEffect, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Select from "@/components/ui/Select";
import { formatConversionRate } from "@/lib/restaurant-referrals";

interface Row {
  id: string;
  accountId: string;
  email: string;
  name: string | null;
  restaurantId: string;
  restaurantName: string;
  qrLabel: string | null;
  status: "signed_up" | "profile_complete";
  signedUpAt: string;
}

interface Totals {
  scans: number;
  signups: number;
  conversion: number | null;
}

const ANIM = `
  @keyframes ov-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
`;

export default function AdminReferralsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Totals>({ scans: 0, signups: 0, conversion: null });
  const [truncated, setTruncated] = useState(false);
  const [restaurants, setRestaurants] = useState<{ id: string; name: string }[]>([]);
  const [restaurantId, setRestaurantId] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async (filters: { restaurantId: string; search: string }) => {
    setError(null);
    const qs = new URLSearchParams();
    if (filters.restaurantId) qs.set("restaurantId", filters.restaurantId);
    if (filters.search) qs.set("search", filters.search);
    try {
      const res = await fetch(`/api/admin/referrals?${qs.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Failed to load referrals.");
        setRows([]);
        return;
      }
      setRows(body.rows ?? []);
      setTotals(body.totals ?? { scans: 0, signups: 0, conversion: null });
      setTruncated(Boolean(body.truncated));
    } catch {
      setError("Network error — try again.");
      setRows([]);
    }
  };

  useEffect(() => {
    void load({ restaurantId: "", search: "" });
    void (async () => {
      const res = await fetch("/api/admin/restaurants?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      setRestaurants(
        (data.items as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
      );
    })();
  }, []);

  const stat = (label: string, value: string) => (
    <div className="bg-white border border-[#EAE4CA] rounded-2xl px-5 py-4">
      <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1.5" style={{ color: "#ABA6A6" }}>
        {label}
      </p>
      <p className="text-2xl font-bold text-[#1E1A1A] tabular-nums">{value}</p>
    </div>
  );

  return (
    <>
      <style>{ANIM}</style>
      <div className="max-w-6xl">
        <div className="ov mb-8">
          <h1 className="text-3xl font-bold text-[#1E1A1A] mb-2">Referrals</h1>
          <p className="text-sm" style={{ color: "#848181" }}>
            Which restaurant earned which sign-up. A scan is anonymous, so scans are counted per
            QR code — the table below is one row per account.
          </p>
        </div>

        <div className="ov grid gap-4 sm:grid-cols-3 mb-6" style={{ animationDelay: "60ms" }}>
          {stat("Scans", String(totals.scans))}
          {stat("Sign-ups", String(totals.signups))}
          {stat("Conversion", formatConversionRate(totals.conversion))}
        </div>

        <div className="ov flex flex-wrap items-end gap-3 mb-5" style={{ animationDelay: "120ms" }}>
          <div className="min-w-[220px]">
            <Select
              label="Restaurant"
              value={restaurantId}
              onChange={(e) => {
                setRestaurantId(e.target.value);
                void load({ restaurantId: e.target.value, search });
              }}
              placeholder="All restaurants"
              options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load({ restaurantId, search });
            }}
          >
            <div>
              <label htmlFor="ref-search" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">
                Email
              </label>
              <input
                id="ref-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="diner@example.com"
                className="min-h-[44px] px-3 rounded-xl border border-[#EAE4CA] focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center min-h-[44px] px-4 rounded-xl border border-[#EAE4CA] text-sm font-semibold text-[#5C5757] hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Search
            </button>
          </form>
        </div>

        {error && <p className="text-error text-sm mb-4">{error}</p>}

        <div className="ov" style={{ animationDelay: "180ms" }}>
          {rows === null ? (
            <p className="text-sm" style={{ color: "#ABA6A6" }}>
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <div className="bg-white border border-[#EAE4CA] rounded-2xl p-8 text-center">
              <p className="font-semibold text-[#1E1A1A] mb-1">No referrals yet</p>
              <p className="text-sm" style={{ color: "#848181" }}>
                Create a QR code on a restaurant&rsquo;s admin page and put it on a table.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-[#EAE4CA] rounded-2xl overflow-hidden">
              {/* Wide table scrolls inside its own container so the page never
                  scrolls horizontally on a narrow screen. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#F9F7ED" }}>
                      {["Customer", "Restaurant", "QR code", "Status", "Signed up"].map((h) => (
                        <th
                          key={h}
                          className="text-left px-5 py-3 text-[9px] tracking-[0.22em] uppercase font-bold whitespace-nowrap"
                          style={{ color: "#ABA6A6" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE4CA]">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-3.5">
                          {r.name && <p className="font-semibold text-[#1E1A1A]">{r.name}</p>}
                          <Link
                            href={`/admin/users?search=${encodeURIComponent(r.email)}`}
                            className="text-xs text-primary hover:underline break-all"
                          >
                            {r.email}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/admin/restaurants/${r.restaurantId}`}
                            className="text-primary hover:underline"
                          >
                            {r.restaurantName}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "#848181" }}>
                          {r.qrLabel ?? "—"}
                        </td>
                        <td className="px-5 py-3.5">
                          {r.status === "profile_complete" ? (
                            <Badge variant="success">Profile complete</Badge>
                          ) : (
                            <Badge variant="neutral">Signed up</Badge>
                          )}
                        </td>
                        <td
                          className="px-5 py-3.5 whitespace-nowrap tabular-nums"
                          style={{ color: "#848181" }}
                        >
                          {new Date(r.signedUpAt).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {truncated && (
                <p className="px-5 py-3 text-xs border-t border-[#EAE4CA]" style={{ color: "#ABA6A6" }}>
                  Showing the 200 most recent — narrow by restaurant or email to see older ones.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
