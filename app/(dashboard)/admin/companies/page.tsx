"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

const ANIM = `
  @keyframes ov-rise {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ov { animation: ov-rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
`;

export default function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    fetch("/api/admin/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.companies ?? []))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/admin/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const company = await res.json();
    setCompanies((prev) => [company, ...prev]);
    setNewName("");
    setCreating(false);
  };

  const handleEdit = async (id: string) => {
    await fetch("/api/admin/companies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editName }),
    });
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, name: editName } : c)));
    setEditId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this company?")) return;
    await fetch(`/api/admin/companies?id=${id}`, { method: "DELETE" });
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <>
      <style>{ANIM}</style>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="ov mb-8" style={{ animationDelay: "0ms" }}>
          <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#7DB87D" }}>
            Admin
          </p>
          <h1 className="text-3xl font-bold text-[#0d1f10]">Companies</h1>
          <div className="flex items-center gap-3 mt-4">
            <div className="h-px w-12 bg-primary/40" />
            <p className="text-xs" style={{ color: "#9EA8A0" }}>
              {companies.length} {companies.length === 1 ? "company" : "companies"} registered
            </p>
          </div>
        </div>

        {/* Add form */}
        <div
          className="ov bg-white rounded-2xl p-6 mb-5"
          style={{
            animationDelay: "70ms",
            boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
          }}
        >
          <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-4" style={{ color: "#ADBDAD" }}>
            Add Company
          </p>
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Company name…"
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#0d1f10] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              required
            />
            <Button type="submit" loading={creating}>Add</Button>
          </form>
        </div>

        {/* List */}
        <div
          className="ov bg-white rounded-2xl overflow-hidden"
          style={{
            animationDelay: "130ms",
            boxShadow: "0 1px 3px rgba(13,31,16,0.07), 0 0 0 1px rgba(13,31,16,0.04)",
          }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#F0F4F0" }}>
                <svg className="animate-spin text-primary" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: "#ADBDAD" }}>Loading…</p>
            </div>
          ) : companies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="text-4xl mb-4">🏢</div>
              <p className="text-[#0d1f10] font-semibold mb-1">No companies yet</p>
              <p className="text-sm" style={{ color: "#ADBDAD" }}>Add one above to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0F4F0]">
              {companies.map((c) => {
                const company = c as Record<string, unknown>;
                const userCount = ((company._count as Record<string, unknown>)?.accounts as number) ?? 0;
                return (
                  <div
                    key={company.id as string}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-[#FAFCFA] transition-colors"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm"
                      style={{ background: "#F0F4F0" }}
                    >
                      🏢
                    </div>

                    {editId === company.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-primary text-sm text-[#0d1f10] outline-none focus:ring-2 focus:ring-primary/20"
                        autoFocus
                      />
                    ) : (
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#0d1f10]">{company.name as string}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "#ADBDAD" }}>
                          {userCount} {userCount === 1 ? "user" : "users"}
                        </p>
                      </div>
                    )}

                    {editId === company.id ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleEdit(company.id as string)}>Save</Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditId(company.id as string);
                            setEditName(company.name as string);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(company.id as string)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
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
