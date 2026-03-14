"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

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
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: editName } : c))
    );
    setEditId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this company?")) return;
    await fetch(`/api/admin/companies?id=${id}`, { method: "DELETE" });
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Companies</h1>
      </div>

      <form onSubmit={handleCreate} className="flex gap-3 mb-6">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Company name…"
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#25293C] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          required
        />
        <Button type="submit" loading={creating}>Add</Button>
      </form>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl divide-y divide-[#E8E7EA]">
        {loading ? (
          <div className="text-center py-12 text-[#8A8D93]">Loading…</div>
        ) : companies.map((c) => {
          const company = c as Record<string, unknown>;
          return (
            <div key={company.id as string} className="flex items-center gap-3 px-5 py-3.5">
              {editId === company.id ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-primary text-sm text-navy outline-none"
                  autoFocus
                />
              ) : (
                <p className="flex-1 text-navy font-medium text-sm">{company.name as string}</p>
              )}
              <span className="text-[#8A8D93] text-xs">
                {((company._count as Record<string, unknown>)?.accounts as number) ?? 0} users
              </span>
              {editId === company.id ? (
                <>
                  <Button size="sm" onClick={() => handleEdit(company.id as string)}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => { setEditId(company.id as string); setEditName(company.name as string); }}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(company.id as string)}>Delete</Button>
                </>
              )}
            </div>
          );
        })}
        {!loading && companies.length === 0 && (
          <div className="text-center py-12 text-[#8A8D93]">No companies yet.</div>
        )}
      </div>
    </div>
  );
}
