"use client";

// Phase 6a M3 — ops review queue (design §7). First publishes and staged
// ingredient/name edits from the restaurant portal wait here; approving a
// PUBLISH takes the dish live, approving an EDIT swaps the staged payload
// into the live dish. Rejections require a note — the restaurant sees it.

import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

interface IngredientRow {
  name: string;
  quantity: number | null;
  unit: string | null;
  ingredientId: string | null;
}

interface QueueItem {
  id: string;
  kind: "PUBLISH" | "EDIT";
  createdAt: string;
  submittedBy: { email: string; name: string } | null;
  restaurant: { id: string; name: string };
  dish: {
    id: string;
    name: string;
    section: string;
    description: string | null;
    price: string | null;
    currency: string;
    calories: number | null;
    status: string;
    ingredients: IngredientRow[];
  };
  staged: { name: string | null; ingredients: IngredientRow[] | null } | null;
  diff: { added: string[]; removed: string[]; changed: string[] } | null;
}

function formatRow(i: IngredientRow): string {
  const qty = i.quantity != null ? ` — ${i.quantity}${i.unit ? ` ${i.unit}` : ""}` : "";
  return `${i.name}${qty}`;
}

/** Words carry the meaning; colour only reinforces it. */
function DiffList({ diff }: { diff: NonNullable<QueueItem["diff"]> }) {
  const groups: { label: string; names: string[]; color: string }[] = [
    { label: "Added", names: diff.added, color: "#5F8A6A" },
    { label: "Removed", names: diff.removed, color: "#B75E78" },
    { label: "Changed", names: diff.changed, color: "#A07C2C" },
  ];
  const nonEmpty = groups.filter((g) => g.names.length > 0);
  if (nonEmpty.length === 0) {
    return <p className="text-xs text-[#ABA6A6]">Only quantities or catalog links changed.</p>;
  }
  return (
    <ul className="space-y-1">
      {nonEmpty.map((g) => (
        <li key={g.label} className="text-sm leading-relaxed">
          <span className="font-semibold" style={{ color: g.color }}>
            {g.label}:
          </span>{" "}
          <span className="text-[#1E1A1A]">{g.names.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdminReviewQueuePage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QueueItem | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/admin/review-queue");
    if (res.ok) {
      const body = await res.json();
      setItems(body.items ?? []);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "Could not load the queue.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (item: QueueItem, action: "approve" | "reject", noteText?: string) => {
    setBusyId(item.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/review-queue/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: noteText || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${item.dish.name}: ${body?.error ?? "Decision failed"}`);
        return false;
      }
      setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
      return true;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-8">
        <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
          Restaurants · review
        </p>
        <h1 className="text-2xl font-semibold text-[#1E1A1A] mb-2">Review queue</h1>
        <p className="text-sm text-[#6E6868] max-w-2xl leading-relaxed">
          Ingredient lists drive allergy verdicts, so they never change on a live dish without a
          second pair of eyes. First publishes wait here in full; edits to live dishes wait as a
          staged diff while diners keep seeing the previous list.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-white rounded-2xl p-5 mb-6 border border-[#E8C4CE] text-sm text-[#B75E78]">
          {error}
        </div>
      )}

      {items === null ? (
        <p className="text-sm text-[#ABA6A6]">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-10 text-center">
          <p className="font-semibold text-[#1E1A1A] mb-1">Queue is clear</p>
          <p className="text-sm text-[#6E6868]">
            Nothing is waiting for review. New submissions from restaurant staff land here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <section key={item.id} className="bg-white border border-[#EAE4CA] rounded-2xl overflow-hidden">
                <div
                  className="px-5 py-3.5 border-b border-[#EAE4CA] flex flex-wrap items-center gap-x-3 gap-y-1.5"
                  style={{ background: "#F9F7ED" }}
                >
                  <Badge variant={item.kind === "PUBLISH" ? "warning" : "info"}>
                    {item.kind === "PUBLISH" ? "First publish" : "Edit to live dish"}
                  </Badge>
                  <p className="font-semibold text-sm text-[#1E1A1A]">
                    {item.dish.name}
                    <span className="font-normal text-[#6E6868]"> · {item.restaurant.name}</span>
                  </p>
                  <p className="text-xs text-[#ABA6A6] ml-auto">
                    {item.submittedBy ? `${item.submittedBy.name || item.submittedBy.email} · ` : ""}
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="px-5 py-4 grid gap-5 md:grid-cols-2">
                  <div>
                    <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
                      {item.kind === "PUBLISH" ? "Dish as submitted" : "Currently live"}
                    </p>
                    <p className="text-sm text-[#1E1A1A] leading-relaxed">
                      {item.dish.section}
                      {item.dish.price ? ` · $${item.dish.price}` : ""}
                      {item.dish.calories != null ? ` · ${Math.round(item.dish.calories)} kcal` : " · no nutrition"}
                    </p>
                    {item.dish.description && (
                      <p className="text-xs text-[#6E6868] mt-1 leading-relaxed">{item.dish.description}</p>
                    )}
                    <ul className="mt-2 space-y-0.5">
                      {item.dish.ingredients.map((i) => (
                        <li key={i.name} className="text-sm text-[#6E6868] leading-relaxed">
                          {formatRow(i)}
                          {i.ingredientId === null && (
                            <span className="ml-1.5 text-[10px] text-[#A07C2C]">free text</span>
                          )}
                        </li>
                      ))}
                      {item.dish.ingredients.length === 0 && (
                        <li className="text-sm text-[#B75E78]">No ingredients — cannot approve.</li>
                      )}
                    </ul>
                  </div>

                  {item.kind === "EDIT" && item.staged && (
                    <div>
                      <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: "#ABA6A6" }}>
                        Requested changes
                      </p>
                      {item.staged.name && (
                        <p className="text-sm text-[#1E1A1A] mb-2">
                          Rename to <span className="font-semibold">{item.staged.name}</span>
                        </p>
                      )}
                      {item.diff && <DiffList diff={item.diff} />}
                      {item.staged.ingredients && (
                        <ul className="mt-2 space-y-0.5">
                          {item.staged.ingredients.map((i) => (
                            <li key={i.name} className="text-sm text-[#6E6868] leading-relaxed">
                              {formatRow(i)}
                              {i.ingredientId === null && (
                                <span className="ml-1.5 text-[10px] text-[#A07C2C]">free text</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="px-5 py-3.5 border-t border-[#F1ECDC] flex items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setRejecting(item);
                      setNote("");
                    }}
                  >
                    Reject…
                  </Button>
                  <Button size="sm" loading={busy} onClick={() => void decide(item, "approve")}>
                    {item.kind === "PUBLISH" ? "Approve & publish" : "Approve changes"}
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject — ${rejecting.dish.name}` : "Reject"}
      >
        <div>
          <label htmlFor="reject-note" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">
            Note to the restaurant <span className="text-error">*</span>
          </label>
          <p className="text-xs text-[#6E6868] mb-2">
            Say what to fix — staff see this in their portal.
          </p>
          <textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-3 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
            placeholder="e.g. Peanut is listed but the menu says cashew — please confirm which it is."
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!note.trim()}
              loading={rejecting !== null && busyId === rejecting.id}
              onClick={async () => {
                if (!rejecting) return;
                const done = await decide(rejecting, "reject", note.trim());
                if (done) setRejecting(null);
              }}
            >
              Reject with note
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
