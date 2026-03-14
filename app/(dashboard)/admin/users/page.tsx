"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadUsers = async (q?: string) => {
    setLoading(true);
    const url = `/api/admin/users?${q ? `search=${q}&` : ""}limit=50`;
    const res = await fetch(url);
    const data = await res.json();
    setUsers(data.items ?? []);
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const handleToggle = async (id: string, isEnabled: boolean) => {
    setTogglingId(id);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isEnabled: !isEnabled }),
    });
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, isEnabled: !isEnabled } : u))
    );
    setTogglingId(null);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Users</h1>
        <p className="text-[#8A8D93] text-sm mt-1">All registered accounts</p>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadUsers(search)}
          placeholder="Search by name or email…"
          className="w-full max-w-sm px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#25293C] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E8E7EA]">
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Name</th>
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold hidden md:table-cell">Plan</th>
              <th className="text-left py-3 px-4 text-[#8A8D93] font-semibold">Status</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-12 text-[#8A8D93]">Loading…</td></tr>
            ) : users.map((user) => {
              const u = user as Record<string, unknown>;
              const sub = u.subscription as Record<string, unknown> | null;
              return (
                <tr key={u.id as string} className="border-b border-[#E8E7EA] hover:bg-[#FAFAFA]">
                  <td className="py-3 px-4">
                    <p className="font-medium text-navy">{`${u.firstName} ${u.lastName}`}</p>
                    <p className="text-[#8A8D93] text-xs">{u.email as string}</p>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <Badge variant={sub?.plan === "PREMIUM" ? "primary" : "neutral"}>
                      {(sub?.plan as string) ?? "FREE"}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={u.isEnabled ? "success" : "error"}>
                      {u.isEnabled ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      variant={u.isEnabled ? "danger" : "secondary"}
                      size="sm"
                      loading={togglingId === u.id}
                      onClick={() => handleToggle(u.id as string, u.isEnabled as boolean)}
                    >
                      {u.isEnabled ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!loading && users.length === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-[#8A8D93]">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
