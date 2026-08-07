"use client";

// Phase 6a M2/M3 — staff menu manager (design §5.2): dishes grouped by
// section with status chips, availability toggle (the "86 it" switch), edit
// modal, submit-for-publishing, unpublish, and soft remove. M3: edits to a
// live dish's name/ingredients wait for ops review — the "Edits in review"
// chip shows while the previous list stays live.

import { useMemo, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import PortalDishForm from "@/components/restaurant/PortalDishForm";
import type { PortalDishDTO, DishRevisionDTO } from "@/lib/restaurant-portal-server";

const STATUS_BADGE: Record<string, { label: string; variant: "success" | "warning" | "neutral" }> = {
  PUBLISHED: { label: "Live", variant: "success" },
  PENDING_REVIEW: { label: "In review", variant: "warning" },
  DRAFT: { label: "Draft", variant: "neutral" },
};

type PortalDishWithReview = PortalDishDTO & { pendingRevision?: DishRevisionDTO | null };

// The editor must prefill from the staged-over-live view: the form resends
// name+ingredients on every save, so prefilling from live data would make a
// routine price tweak read as "revert my staged edits" and silently withdraw
// the pending revision (audit fix).
function withStagedOverlay(dish: PortalDishWithReview): PortalDishWithReview {
  const staged = dish.pendingRevision;
  if (!staged || staged.kind !== "EDIT") return dish;
  return {
    ...dish,
    name: staged.name ?? dish.name,
    ingredients: staged.ingredients ?? dish.ingredients,
  };
}

export default function PortalMenuManager({
  restaurantId,
  initialDishes,
}: {
  restaurantId: string;
  initialDishes: PortalDishWithReview[];
}) {
  const [dishes, setDishes] = useState<PortalDishWithReview[]>(initialDishes);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PortalDishWithReview | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => {
    const bySection = new Map<string, PortalDishWithReview[]>();
    for (const d of dishes) {
      const list = bySection.get(d.section) ?? [];
      list.push(d);
      bySection.set(d.section, list);
    }
    return Array.from(bySection.entries());
  }, [dishes]);

  const reload = async () => {
    const res = await fetch(`/api/restaurant-portal/${restaurantId}/dishes`);
    if (res.ok) {
      const body = await res.json();
      setDishes(body.dishes ?? []);
    }
  };

  const patch = async (dish: PortalDishWithReview, payload: Record<string, unknown>) => {
    setBusyId(dish.id);
    setError(null);
    try {
      const res = await fetch(`/api/restaurant-portal/${restaurantId}/dishes/${dish.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${dish.name}: ${body.error ?? "Update failed"}`);
        return;
      }
      setDishes((prev) =>
        prev.map((d) =>
          d.id === dish.id ? { ...body.dish, pendingRevision: body.pendingRevision ?? null } : d
        )
      );
    } catch {
      setError(`${dish.name}: network error — try again`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (dish: PortalDishWithReview) => {
    if (!confirm(`Remove "${dish.name}" from your menu? Wondish keeps a record, and ops can restore it.`)) return;
    setBusyId(dish.id);
    setError(null);
    try {
      const res = await fetch(`/api/restaurant-portal/${restaurantId}/dishes/${dish.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${dish.name}: ${body.error ?? "Remove failed"}`);
        return;
      }
      setDishes((prev) => prev.filter((d) => d.id !== dish.id));
    } catch {
      setError(`${dish.name}: network error — try again`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        {error ? (
          <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-xl px-3 py-2 text-xs text-error">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error" className="font-bold">
              ×
            </button>
          </div>
        ) : (
          <span />
        )}
        <Button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          + Add dish
        </Button>
      </div>

      {dishes.length === 0 ? (
        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-8 text-center">
          <p className="font-semibold text-[#1E1A1A] mb-1">No dishes yet</p>
          <p className="text-sm" style={{ color: "#848181" }}>
            Add your first dish — it stays a draft until you submit it for publishing.
          </p>
        </div>
      ) : (
        sections.map(([section, rows]) => (
          <div key={section} className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: "#848181" }}>
              {section}
            </p>
            <div className="bg-white border border-[#EAE4CA] rounded-2xl divide-y divide-[#F5F1DD]">
              {rows.map((dish) => {
                const badge = STATUS_BADGE[dish.status] ?? STATUS_BADGE.DRAFT;
                const busy = busyId === dish.id;
                return (
                  <div key={dish.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-[#1E1A1A] truncate">{dish.name}</p>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {dish.pendingRevision?.kind === "EDIT" && (
                          <Badge variant="warning">Edits in review</Badge>
                        )}
                        {!dish.available && <Badge variant="error">86&apos;d</Badge>}
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "#848181" }}>
                        {[
                          dish.price ? `$${dish.price}` : null,
                          dish.calories != null ? `${Math.round(dish.calories)} kcal` : "no nutrition",
                          `${dish.ingredients.length} ingredient${dish.ingredients.length === 1 ? "" : "s"}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => patch(dish, { available: !dish.available })}
                      >
                        {dish.available ? "86 it" : "Restore"}
                      </Button>
                      {dish.status === "DRAFT" ? (
                        <Button
                          size="sm"
                          loading={busy}
                          onClick={() => patch(dish, { action: "submit" })}
                        >
                          Submit to publish
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() => patch(dish, { action: "unpublish" })}
                        >
                          Unpublish
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setEditing(withStagedOverlay(dish));
                          setModalOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(dish)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : "Add dish"}
        size="lg"
      >
        <PortalDishForm
          restaurantId={restaurantId}
          dish={editing}
          sections={sections.map(([s]) => s)}
          onSaved={() => {
            setModalOpen(false);
            setEditing(null);
            void reload();
          }}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>
    </div>
  );
}
