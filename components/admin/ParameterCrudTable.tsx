"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

interface ParameterItem {
  id: string;
  name: string;
}

interface ParameterCrudTableProps {
  type: string;
  initialItems: ParameterItem[];
}

export default function ParameterCrudTable({
  type,
  initialItems,
}: ParameterCrudTableProps) {
  const [items, setItems] = useState(initialItems);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/parameters/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const item = await res.json();
      setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async (id: string) => {
    await fetch(`/api/admin/parameters/${type}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editName }),
    });
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, name: editName } : i))
    );
    setEditId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/admin/parameters/${type}?id=${id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <form onSubmit={handleCreate} className="flex gap-3 mb-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add new item…"
          required
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#25293C] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <Button type="submit" loading={creating} size="sm">
          Add
        </Button>
      </form>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl divide-y divide-[#E8E7EA]">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 px-5 py-3 hover:bg-[#FAFAFA]"
          >
            {editId === item.id ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg border border-primary text-sm text-navy outline-none"
                autoFocus
              />
            ) : (
              <p className="flex-1 text-navy text-sm">{item.name}</p>
            )}

            {editId === item.id ? (
              <>
                <Button size="sm" onClick={() => handleEdit(item.id)}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditId(null)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditId(item.id);
                    setEditName(item.name);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={deletingId === item.id}
                  onClick={() => handleDelete(item.id)}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-8 text-[#8A8D93] text-sm">
            No items yet. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
