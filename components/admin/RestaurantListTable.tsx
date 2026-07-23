"use client";

import { useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import RestaurantForm from "@/components/admin/RestaurantForm";

export interface RestaurantRow {
  id: string;
  name: string;
  slug: string;
  neighborhood: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  ethnic: { id: string; name: string } | null;
  ethnicId: string | null;
  description: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  website: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
  _count: { dishes: number };
}

const STATUS_VARIANT: Record<RestaurantRow["status"], "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

interface RestaurantListTableProps {
  restaurants: RestaurantRow[];
  ethnics: { id: string; name: string }[];
}

export default function RestaurantListTable({ restaurants, ethnics }: RestaurantListTableProps) {
  const [items, setItems] = useState<RestaurantRow[]>(restaurants);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RestaurantRow | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (r: RestaurantRow) => {
    setEditing(r);
    setModalOpen(true);
  };

  const handleSaved = () => {
    setModalOpen(false);
    setEditing(null);
    // Full reload keeps this in lock-step with the server list (create needs
    // the new row + its dish count; edit needs the refreshed ethnic join) —
    // mirrors the recipes admin page's router.refresh()-after-save posture,
    // adapted for a modal that doesn't navigate.
    window.location.reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this restaurant and all of its dishes?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/admin/restaurants/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}>+ New Restaurant</Button>
      </div>

      <div className="overflow-x-auto bg-white rounded-2xl" style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#EAE4CA]">
              <th className="text-left py-3 px-4 text-[#848181] font-semibold">Restaurant</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold hidden md:table-cell">Neighborhood</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold hidden md:table-cell">Cuisine</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-[#848181] font-semibold hidden lg:table-cell">Dishes</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[#EAE4CA] hover:bg-[#FAFAFA]">
                <td className="py-3 px-4">
                  <p className="font-medium text-navy">{r.name}</p>
                  <p className="text-[#848181] text-xs">{r.slug}</p>
                </td>
                <td className="py-3 px-4 hidden md:table-cell text-[#848181]">{r.neighborhood}</td>
                <td className="py-3 px-4 hidden md:table-cell text-[#848181]">{r.ethnic?.name ?? "—"}</td>
                <td className="py-3 px-4">
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                </td>
                <td className="py-3 px-4 hidden lg:table-cell text-[#848181]">{r._count.dishes}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 justify-end">
                    <Link href={`/admin/restaurants/${r.id}`}>
                      <Button variant="secondary" size="sm">Manage Dishes</Button>
                    </Link>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(r)}>Edit</Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingId === r.id}
                      onClick={() => handleDelete(r.id)}
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
          <div className="text-center py-12 text-[#848181]">No restaurants yet. Add one to get started.</div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : "New Restaurant"}
        size="lg"
      >
        <RestaurantForm
          mode={editing ? "edit" : "create"}
          initial={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  slug: editing.slug,
                  neighborhood: editing.neighborhood,
                  description: editing.description ?? "",
                  ethnicId: editing.ethnicId ?? "",
                  status: editing.status,
                  addressLine: editing.addressLine ?? "",
                  city: editing.city ?? "",
                  state: editing.state ?? "",
                  postalCode: editing.postalCode ?? "",
                  phone: editing.phone ?? "",
                  website: editing.website ?? "",
                  imageUrl: editing.imageUrl ?? "",
                  logoUrl: editing.logoUrl ?? "",
                }
              : undefined
          }
          ethnics={ethnics}
          onSaved={handleSaved}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
