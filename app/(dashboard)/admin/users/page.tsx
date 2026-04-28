"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const ANIM = `
  @keyframes ov-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
`;

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(" ");
  const letters = parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`
    : name.slice(0, 2);
  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-black uppercase"
      style={{ background: "rgba(74,222,128,0.12)", color: "#22c55e" }}
    >
      {letters.toUpperCase()}
    </div>
  );
}

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
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isEnabled: !isEnabled } : u)));
    setTogglingId(null);
  };

  return (
    <>
      <style>{ANIM}</style>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#7DB87D" }}>
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[#0d1f10]">Users</h1>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px w-12 bg-primary/40" />
            <p className="text-xs" style={{ color: "#9EA8A0" }}>All registered accounts</p>
          </div>
        </div>

        {/* Search */}
        <div className="ov mb-5" style={{ animationDelay: "70ms" }}>
          <div className="relative max-w-sm">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ADBDAD]"
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadUsers(search)}
              placeholder="Search by name or email…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#0d1f10] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* User list */}
        <div
          className="ov bg-white rounded-2xl overflow-hidden"
          style={{
            animationDelay: "130ms",
            boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
          }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "#F0F4F0" }}
              >
                <svg className="animate-spin text-primary" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: "#ADBDAD" }}>Loading users…</p>
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="text-4xl mb-4">👥</div>
              <p className="text-[#0d1f10] font-semibold mb-1">No users found</p>
              <p className="text-sm" style={{ color: "#ADBDAD" }}>Try a different search term.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0F4F0]">
              {users.map((user) => {
                const u = user as Record<string, unknown>;
                const sub = u.subscription as Record<string, unknown> | null;
                const fullName = `${u.firstName} ${u.lastName}`;
                return (
                  <div
                    key={u.id as string}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-[#FAFCFA] transition-colors"
                  >
                    <Initials name={fullName} />

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#0d1f10] leading-snug">{fullName}</p>
                      <p className="text-[10px] font-medium mt-0.5 leading-snug" style={{ color: "#ADBDAD" }}>
                        {u.email as string}
                      </p>
                    </div>

                    <div className="hidden md:block">
                      <Badge variant={sub?.plan === "PREMIUM" ? "primary" : "neutral"}>
                        {(sub?.plan as string) ?? "FREE"}
                      </Badge>
                    </div>

                    <div>
                      <Badge variant={u.isEnabled ? "success" : "error"}>
                        {u.isEnabled ? "Active" : "Disabled"}
                      </Badge>
                    </div>

                    <div className="flex-shrink-0">
                      <Button
                        variant={u.isEnabled ? "danger" : "secondary"}
                        size="sm"
                        loading={togglingId === u.id}
                        onClick={() => handleToggle(u.id as string, u.isEnabled as boolean)}
                      >
                        {u.isEnabled ? "Disable" : "Enable"}
                      </Button>
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
