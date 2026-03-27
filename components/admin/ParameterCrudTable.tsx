"use client";

import { useState, useEffect, useRef } from "react";
import Button from "@/components/ui/Button";

interface ParameterItem {
  id: string;
  name: string;
}

interface BannedItem {
  id: string;
  name: string;
}

interface RecipeItem {
  id: string;
  name: string;
  emoji?: string | null;
  mealType?: { name: string } | null;
}

interface ParameterCrudTableProps {
  type: string;
  initialItems: ParameterItem[];
}

const SUPPORTS_BANNED = ["health-condition", "food-preference", "food-allergy", "motivation"];
const SUPPORTS_MEALS = ["ethnic"];

// ─── Banned Ingredients Panel ────────────────────────────────────────────────

function BannedIngredientsPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [items, setItems] = useState<BannedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/banned-ingredients/${entityType}/${entityId}`)
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []))
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/banned-ingredients/${entityType}/${entityId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const item = await res.json();
        setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName("");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (itemId: string) => {
    setDeletingId(itemId);
    try {
      await fetch(`/api/admin/banned-ingredients/${entityType}/${entityId}?itemId=${itemId}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-3 pl-4 border-l-2 border-primary/20">
      <p className="text-xs font-semibold text-[#8A8D93] uppercase tracking-wide mb-2">
        Banned Ingredients
      </p>
      {loading ? (
        <p className="text-xs text-[#8A8D93]">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
            {items.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700"
              >
                {item.name}
                <button
                  onClick={() => handleDelete(item.id)}
                  disabled={deletingId === item.id}
                  className="ml-0.5 hover:text-red-900 disabled:opacity-40"
                >
                  ×
                </button>
              </span>
            ))}
            {items.length === 0 && <span className="text-xs text-[#8A8D93]">None set</span>}
          </div>
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add ingredient to ban…"
              className="flex-1 px-2.5 py-1 rounded-lg border border-[#E8E7EA] text-xs text-navy outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
            <Button type="submit" loading={adding} size="sm">Add</Button>
          </form>
        </>
      )}
    </div>
  );
}

// ─── Ethnic Meals Panel ───────────────────────────────────────────────────────

function EthnicMealsPanel({ ethnicId }: { ethnicId: string }) {
  const [assigned, setAssigned] = useState<RecipeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<RecipeItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/admin/ethnic/${ethnicId}/recipes`)
      .then((r) => r.json())
      .then((data) => setAssigned(data.recipes ?? []))
      .finally(() => setLoading(false));
  }, [ethnicId]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/recipes?search=${encodeURIComponent(value)}&limit=8`);
        const data = await res.json();
        const assignedIds = new Set(assigned.map((r) => r.id));
        setSearchResults((data.items ?? []).filter((r: RecipeItem) => !assignedIds.has(r.id)));
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const handleAdd = async (recipe: RecipeItem) => {
    setAddingId(recipe.id);
    try {
      const res = await fetch(`/api/admin/ethnic/${ethnicId}/recipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: recipe.id }),
      });
      if (res.ok) {
        setAssigned((prev) => [...prev, recipe].sort((a, b) => a.name.localeCompare(b.name)));
        setSearchResults((prev) => prev.filter((r) => r.id !== recipe.id));
      }
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (recipeId: string) => {
    setRemovingId(recipeId);
    try {
      await fetch(`/api/admin/ethnic/${ethnicId}/recipes?recipeId=${recipeId}`, {
        method: "DELETE",
      });
      setAssigned((prev) => prev.filter((r) => r.id !== recipeId));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="mt-3 pl-4 border-l-2 border-primary/20">
      <p className="text-xs font-semibold text-[#8A8D93] uppercase tracking-wide mb-2">
        Meals in this cuisine ({loading ? "…" : assigned.length})
      </p>

      {/* Search to add */}
      <div className="relative mb-3">
        <input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search recipes to add…"
          className="w-full px-2.5 py-1 rounded-lg border border-[#E8E7EA] text-xs text-navy outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        {(searching || searchResults.length > 0) && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-[#E8E7EA] rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {searching && <p className="text-xs text-[#8A8D93] px-3 py-2">Searching…</p>}
            {!searching && searchResults.length === 0 && search.trim() && (
              <p className="text-xs text-[#8A8D93] px-3 py-2">No results</p>
            )}
            {searchResults.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2 hover:bg-[#FAFAFA] border-b border-[#F0EFF5] last:border-0">
                <div className="flex items-center gap-2">
                  <span>{r.emoji ?? "🍽"}</span>
                  <div>
                    <p className="text-xs text-navy font-medium">{r.name}</p>
                    {r.mealType && <p className="text-[10px] text-[#8A8D93]">{r.mealType.name}</p>}
                  </div>
                </div>
                <Button size="sm" loading={addingId === r.id} onClick={() => handleAdd(r)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assigned recipes */}
      {loading ? (
        <p className="text-xs text-[#8A8D93]">Loading…</p>
      ) : assigned.length === 0 ? (
        <p className="text-xs text-[#8A8D93]">No meals assigned yet.</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {assigned.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#F8F7FA]">
              <div className="flex items-center gap-2">
                <span className="text-base">{r.emoji ?? "🍽"}</span>
                <div>
                  <p className="text-xs text-navy font-medium">{r.name}</p>
                  {r.mealType && <p className="text-[10px] text-[#8A8D93]">{r.mealType.name}</p>}
                </div>
              </div>
              <button
                onClick={() => handleRemove(r.id)}
                disabled={removingId === r.id}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 px-2"
              >
                {removingId === r.id ? "…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────

export default function ParameterCrudTable({ type, initialItems }: ParameterCrudTableProps) {
  const [items, setItems] = useState(initialItems);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const supportsBanned = SUPPORTS_BANNED.includes(type);
  const supportsMeals = SUPPORTS_MEALS.includes(type);

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
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name: editName } : i)));
    setEditId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/admin/parameters/${type}?id=${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (expandedId === id) setExpandedId(null);
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
        <Button type="submit" loading={creating} size="sm">Add</Button>
      </form>

      <div className="bg-white border border-[#E8E7EA] rounded-2xl divide-y divide-[#E8E7EA]">
        {items.map((item) => (
          <div key={item.id} className="px-5 py-3 hover:bg-[#FAFAFA]">
            <div className="flex items-center gap-3">
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
                  <Button size="sm" onClick={() => handleEdit(item.id)}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  {(supportsBanned || supportsMeals) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                    >
                      {expandedId === item.id
                        ? "Hide"
                        : supportsMeals
                        ? "Edit Meals"
                        : "Banned Ingredients"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setEditId(item.id); setEditName(item.name); }}
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

            {expandedId === item.id && supportsBanned && (
              <BannedIngredientsPanel entityType={type} entityId={item.id} />
            )}
            {expandedId === item.id && supportsMeals && (
              <EthnicMealsPanel ethnicId={item.id} />
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-8 text-[#8A8D93] text-sm">No items yet. Add one above.</div>
        )}
      </div>
    </div>
  );
}
