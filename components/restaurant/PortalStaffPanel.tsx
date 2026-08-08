"use client";

// Phase 6a M4 + §4D — owner-facing staff management (design §4B/§5.7):
// roster, email-free "add a manager" (direct assignment of an existing
// Wondish account, capped server-side), pending-invite revocation for any
// historical/ops-created invites. OWNER seats are granted and removed by
// Wondish ops only.

import { useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

export interface StaffRow {
  id: string;
  role: "OWNER" | "MANAGER";
  email: string;
  name: string;
  createdAt: string;
  isSelf: boolean;
}

export interface InviteRow {
  id: string;
  email: string;
  role: "OWNER" | "MANAGER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  createdAt: string;
}

const INVITE_BADGE: Record<InviteRow["status"], "warning" | "success" | "neutral" | "error"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REVOKED: "neutral",
  EXPIRED: "error",
};

export default function PortalStaffPanel({
  restaurantId,
  initialStaff,
  initialInvites,
}: {
  restaurantId: string;
  initialStaff: StaffRow[];
  initialInvites: InviteRow[];
}) {
  const [staff, setStaff] = useState(initialStaff);
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "add" | row id
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // §4D — email-free: attaches an existing Wondish account as MANAGER; the
  // server rejects unknown emails with a "ask them to sign up first" error.
  const addManager = async () => {
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/restaurant-portal/${restaurantId}/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't add that person.");
        return;
      }
      setNotice(
        `${email.trim().toLowerCase()} added as a manager — they can open the portal right away.`
      );
      setEmail("");
      await reloadStaff();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  const reloadStaff = async () => {
    const res = await fetch(`/api/restaurant-portal/${restaurantId}/staff`);
    if (res.ok) {
      const body = await res.json();
      setStaff(body.staff ?? []);
    }
  };

  const revoke = async (row: InviteRow) => {
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/restaurant-portal/${restaurantId}/invites/${row.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Revoke failed.");
        return;
      }
      setInvites((prev) => prev.map((i) => (i.id === row.id ? { ...i, status: "REVOKED" } : i)));
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: StaffRow) => {
    if (!confirm(`Remove ${row.name || row.email} from your staff? They lose portal access to this restaurant.`)) {
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/restaurant-portal/${restaurantId}/staff/${row.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Remove failed.");
        return;
      }
      setStaff((prev) => prev.filter((s) => s.id !== row.id));
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  };

  const visibleInvites = invites.filter((i) => i.status !== "ACCEPTED");

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="bg-error/10 border border-error/20 rounded-xl px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="bg-success/10 border border-success/20 rounded-xl px-4 py-3 text-sm text-[#1E1A1A]">
          {notice}
        </div>
      )}

      <section className="bg-white border border-[#EAE4CA] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EAE4CA]" style={{ background: "#F9F7ED" }}>
          <h2 className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
            Team
          </h2>
        </div>
        <div className="divide-y divide-[#F5F1DD]">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-[#1E1A1A] truncate">
                  {s.name || s.email}
                  {s.isSelf && <span className="font-normal text-[#ABA6A6]"> (you)</span>}
                </p>
                <p className="text-xs mt-0.5 truncate" style={{ color: "#848181" }}>
                  {s.email}
                </p>
              </div>
              <Badge variant={s.role === "OWNER" ? "primary" : "neutral"}>
                {s.role === "OWNER" ? "Owner" : "Manager"}
              </Badge>
              {s.role === "MANAGER" && (
                <Button variant="danger" size="sm" disabled={busy === s.id} onClick={() => void remove(s)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="px-5 py-3 text-[11px] border-t border-[#F5F1DD]" style={{ color: "#ABA6A6" }}>
          Owner seats are managed by your Wondish contact.
        </p>
      </section>

      <section className="bg-white border border-[#EAE4CA] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EAE4CA]" style={{ background: "#F9F7ED" }}>
          <h2 className="text-[9px] tracking-[0.22em] uppercase font-bold" style={{ color: "#ABA6A6" }}>
            Add a manager
          </h2>
        </div>
        <form
          className="px-5 py-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addManager();
          }}
        >
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="add-manager-email" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">
              Their Wondish account email
            </label>
            <input
              id="add-manager-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-3 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
              placeholder="chef@example.com"
            />
          </div>
          <Button type="submit" loading={busy === "add"} disabled={!email.trim()}>
            Add manager
          </Button>
          <p className="w-full text-[11px]" style={{ color: "#ABA6A6" }}>
            They need a Wondish account first — once they&rsquo;ve signed up, add their email here
            and they get access immediately. Managers can edit the menu and profile; they
            can&rsquo;t manage staff. Menu changes to live dishes still go through Wondish review.
          </p>
        </form>

        {visibleInvites.length > 0 && (
          <div className="border-t border-[#F5F1DD] divide-y divide-[#F5F1DD]">
            {visibleInvites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1E1A1A] truncate">{i.email}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#848181" }}>
                    invited {new Date(i.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={INVITE_BADGE[i.status]}>{i.status.toLowerCase()}</Badge>
                {i.status === "PENDING" && (
                  <Button variant="secondary" size="sm" disabled={busy === i.id} onClick={() => void revoke(i)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
