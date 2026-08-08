"use client";

// Phase 6a M1 — admin Staff tab (design §4A/§4D/§5.7): roster of staff
// members and invites for one restaurant, with add-staff (direct-assign or
// invite fallback) / revoke / remove actions.
// Conventions follow RestaurantDishManager: client component, fetch + local
// state, dismissible inline error banner, ui/* primitives.

import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

interface StaffRow {
  id: string;
  role: "OWNER" | "MANAGER";
  createdAt: string;
  account: { id: string; email: string; firstName: string; lastName: string };
}

interface InviteRow {
  id: string;
  email: string;
  role: "OWNER" | "MANAGER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  createdAt: string;
}

const INVITE_BADGE: Record<InviteRow["status"], "success" | "warning" | "neutral" | "error"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REVOKED: "neutral",
  EXPIRED: "error",
};

export default function RestaurantStaffPanel({ restaurantId }: { restaurantId: string }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "MANAGER">("OWNER");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [staffRes, invitesRes] = await Promise.all([
        fetch(`/api/admin/restaurants/${restaurantId}/staff`),
        fetch(`/api/admin/restaurants/${restaurantId}/invites`),
      ]);
      const staffBody = await staffRes.json();
      const invitesBody = await invitesRes.json();
      if (!staffRes.ok) throw new Error(staffBody.error ?? "Failed to load staff");
      if (!invitesRes.ok) throw new Error(invitesBody.error ?? "Failed to load invites");
      setStaff(staffBody.staff ?? []);
      setInvites(invitesBody.invites ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    void load();
  }, [load]);

  // §4D: one "Add staff" action — the server direct-assigns when the email
  // already has an account, falls back to an invite when it doesn't, and
  // `mode` says which path happened.
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${restaurantId}/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to add staff");
        return;
      }
      const addr = email.trim().toLowerCase();
      setNotice(
        body.mode === "assigned"
          ? `${addr} added as ${body.staff.role} — they can open the portal now.`
          : body.mode === "promoted"
            ? `${addr} promoted to ${body.staff.role}.`
            : body.emailSent
              ? `No account for ${addr} yet — invite emailed instead.`
              : `No account for ${addr} yet — invite created; they can accept it in-app after signing up.`
      );
      setEmail("");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (invite: InviteRow) => {
    if (!confirm(`Revoke the invite for ${invite.email}?`)) return;
    setBusyId(invite.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${restaurantId}/invites/${invite.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to revoke invite");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveStaff = async (row: StaffRow) => {
    if (!confirm(`Remove ${row.account.email} from this restaurant's staff?`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${restaurantId}/staff/${row.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to remove staff member");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white border border-[#EAE4CA] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-[#1E1A1A]">Staff</h2>
          <p className="text-xs mt-0.5" style={{ color: "#848181" }}>
            People who can manage this restaurant&apos;s menu in the portal
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 bg-error/10 border border-error/20 rounded-xl px-3 py-2 mb-3 text-xs text-error">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="font-bold">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-start justify-between gap-3 bg-success/10 border border-success/20 rounded-xl px-3 py-2 mb-3 text-xs text-success">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss notice" className="font-bold">
            ×
          </button>
        </div>
      )}

      {/* Add-staff form (§4D): direct-assign for existing accounts, invite fallback */}
      <form onSubmit={handleAddStaff} className="flex flex-wrap items-end gap-2 mb-5">
        <label className="flex-1 min-w-[220px]">
          <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
            Email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@restaurant.com"
            className="w-full border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
            Role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "OWNER" | "MANAGER")}
            className="border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="OWNER">Owner</option>
            <option value="MANAGER">Manager</option>
          </select>
        </label>
        <Button type="submit" size="sm" loading={submitting}>
          Add staff
        </Button>
      </form>

      {loading ? (
        <p className="text-xs" style={{ color: "#848181" }}>Loading…</p>
      ) : (
        <>
          {/* Staff roster */}
          {staff.length === 0 ? (
            <p className="text-xs mb-4" style={{ color: "#848181" }}>
              No staff yet — invite the owner to get them into the portal.
            </p>
          ) : (
            <ul className="divide-y divide-[#F5F1DD] mb-4">
              {staff.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1E1A1A] truncate">
                      {row.account.firstName || row.account.lastName
                        ? `${row.account.firstName} ${row.account.lastName}`.trim()
                        : row.account.email}
                    </p>
                    <p className="text-xs truncate" style={{ color: "#848181" }}>{row.account.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={row.role === "OWNER" ? "primary" : "info"}>{row.role}</Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busyId === row.id}
                      onClick={() => handleRemoveStaff(row)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Invites */}
          {invites.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#848181" }}>
                Invites
              </p>
              <ul className="divide-y divide-[#F5F1DD]">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-[#1E1A1A] truncate">{invite.email}</p>
                      <p className="text-xs" style={{ color: "#848181" }}>
                        {invite.role} · invited {new Date(invite.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={INVITE_BADGE[invite.status]}>{invite.status}</Badge>
                      {invite.status === "PENDING" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busyId === invite.id}
                          onClick={() => handleRevoke(invite)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
