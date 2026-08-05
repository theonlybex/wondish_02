"use client";

import { useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import RestaurantDishForm, { DishFormValues } from "@/components/admin/RestaurantDishForm";

export interface DishRow {
  id: string;
  name: string;
  description: string | null;
  price: string | null; // formatted as "9.00" server-side, or null
  currency: string;
  section: string;
  sortOrder: number;
  dishTypeId: string | null;
  mealTypeId: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  isRecommended: boolean;
  available: boolean;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED";
  ingredients: { name: string; quantity: number | null; unit: string | null }[];
}

interface RestaurantDishManagerProps {
  restaurantId: string;
  dishes: DishRow[];
  dishTypes: { id: string; name: string }[];
  mealTypes: { id: string; name: string }[];
}

export default function RestaurantDishManager({
  restaurantId,
  dishes,
  dishTypes,
  mealTypes,
}: RestaurantDishManagerProps) {
  const [items, setItems] = useState<DishRow[]>(dishes);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DishRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (d: DishRow) => {
    setEditing(d);
    setModalOpen(true);
  };

  const handleSaved = () => {
    setModalOpen(false);
    setEditing(null);
    window.location.reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this dish?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/admin/restaurants/${restaurantId}/dishes/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  // Publish/unpublish toggle straight from the table row. A 400 here means
  // the spec-mandated publish gate blocked it (dish has zero ingredients) —
  // surfaced inline rather than silently failing.
  const handleTogglePublish = async (d: DishRow) => {
    const nextStatus = d.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    setTogglingId(d.id);
    setToggleError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${restaurantId}/dishes/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToggleError(`${d.name}: ${body.error ?? "Failed to update status"}`);
        return;
      }
      setItems((prev) => prev.map((r) => (r.id === d.id ? { ...r, status: nextStatus } : r)));
    } finally {
      setTogglingId(null);
    }
  };

  const initialForEdit = (d: DishRow): Partial<DishFormValues> => ({
    id: d.id,
    name: d.name,
    description: d.description ?? "",
    price: d.price ?? "",
    currency: d.currency,
    section: d.section,
    sortOrder: String(d.sortOrder),
    dishTypeId: d.dishTypeId ?? "",
    mealTypeId: d.mealTypeId ?? "",
    calories: d.calories != null ? String(d.calories) : "",
    protein: d.protein != null ? String(d.protein) : "",
    carbs: d.carbs != null ? String(d.carbs) : "",
    fat: d.fat != null ? String(d.fat) : "",
    fiber: d.fiber != null ? String(d.fiber) : "",
    isRecommended: d.isRecommended,
    available: d.available,
    // The admin form's status select offers DRAFT/PUBLISHED only; an
    // in-review dish (Phase 6a M3) edits as DRAFT here — the review queue,
    // not this form, is the surface that resolves PENDING_REVIEW.
    status: d.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    ingredients: d.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity != null ? String(i.quantity) : "",
      unit: i.unit ?? "",
    })),
  });

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}>+ New Dish</Button>
      </div>

      {toggleError && (
        <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mb-4 flex items-start justify-between gap-3">
          <span>{toggleError}</span>
          <button onClick={() => setToggleError(null)} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="overflow-x-auto bg-white rounded-2xl" style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#EAE4CA]">
              <th className="text-left py-3 px-4 text-[#848181] font-semibold">Dish</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold hidden md:table-cell">Section</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold hidden md:table-cell">Price</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold hidden lg:table-cell">Ingredients</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold">Status</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="border-b border-[#EAE4CA] hover:bg-[#FAFAFA]">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-navy">{d.name}</p>
                    {d.isRecommended && <Badge variant="primary">Recommended</Badge>}
                    {!d.available && <Badge variant="neutral">Unavailable</Badge>}
                  </div>
                </td>
                <td className="py-3 px-4 hidden md:table-cell text-[#848181]">{d.section}</td>
                <td className="py-3 px-4 hidden md:table-cell text-[#848181]">
                  {d.price ? `${d.price} ${d.currency}` : "—"}
                </td>
                <td className="py-3 px-4 hidden lg:table-cell text-[#848181]">{d.ingredients.length}</td>
                <td className="py-3 px-4">
                  <Badge variant={d.status === "PUBLISHED" ? "success" : d.status === "PENDING_REVIEW" ? "warning" : "neutral"}>{d.status === "PENDING_REVIEW" ? "IN REVIEW" : d.status}</Badge>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={togglingId === d.id}
                      onClick={() => handleTogglePublish(d)}
                    >
                      {d.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(d)}>Edit</Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingId === d.id}
                      onClick={() => handleDelete(d.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {items.length === 0 && (
          <div className="text-center py-12 text-[#848181]">No dishes yet. Add one to build the menu.</div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : "New Dish"}
        size="lg"
      >
        <RestaurantDishForm
          restaurantId={restaurantId}
          mode={editing ? "edit" : "create"}
          initial={editing ? initialForEdit(editing) : undefined}
          dishTypes={dishTypes}
          mealTypes={mealTypes}
          onSaved={handleSaved}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
