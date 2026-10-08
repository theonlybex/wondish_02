"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import TagInput from "@/components/ui/TagInput";
import { CUSTOM_PLAN_LIMITS as L, type CustomPlanField } from "@/lib/custom-plans";
import type { CustomPlanView } from "@/lib/custom-plans-server";

// "Your own plans" — a user-made eating plan (name, foods it leaves out, a
// note for Clara), enforced by the engine like any built-in diet. Lives under
// the Diets chips; talks to /api/patient/plans. Sibling of CustomConditions.

type Draft = { name: string; avoid: string[]; guidance: string };
const emptyDraft = (): Draft => ({ name: "", avoid: [], guidance: "" });
const toDraft = (p: CustomPlanView): Draft => ({ name: p.name, avoid: [...p.avoid], guidance: p.guidance ?? "" });
// Enter in these fields must not submit the surrounding profile form.
const blockEnterSubmit = (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
};

export default function CustomPlans({ initial }: { initial: CustomPlanView[] }) {
  const router = useRouter();
  const [items, setItems] = useState<CustomPlanView[]>(initial);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<{ field?: CustomPlanField; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const startNew = () => { setDraft(emptyDraft()); setError(null); setNotice(""); setEditing("new"); };
  const startEdit = (p: CustomPlanView) => { setDraft(toDraft(p)); setError(null); setNotice(""); setEditing(p.id); };
  const cancel = () => { setEditing(null); setError(null); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/patient/plans" : `/api/patient/plans/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, avoid: draft.avoid, guidance: draft.guidance || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ field: data.field, message: data.error ?? "Could not save. Please try again." });
        return;
      }
      const saved: CustomPlanView = data.plan;
      setItems((list) => (isNew ? [...list, saved] : list.map((p) => (p.id === saved.id ? saved : p))).sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
      setNotice(`${saved.name} saved — Clara, your shopping list and your next week will follow it.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/patient/plans/${id}`, { method: "DELETE" });
      if (!res.ok) { setError({ message: "Could not delete. Please try again." }); return; }
      const gone = items.find((p) => p.id === id);
      setItems((list) => list.filter((p) => p.id !== id));
      setConfirmDelete(null);
      setNotice(gone ? `${gone.name} removed.` : "Removed.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (f: CustomPlanField) => (error?.field === f ? error.message : undefined);
  const form = (
    <div className="rounded-xl border-2 border-[#F5F1DD] bg-white p-4 sm:p-5 space-y-5" role="group" aria-label={editing === "new" ? "New plan" : "Edit plan"}>
      <Input
        label="Plan name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder="e.g. My low-histamine plan, Weekday light eating"
        maxLength={L.nameMax}
        error={fieldError("name")}
        required
      />
      <TagInput
        id="cp-avoid"
        label="Foods this plan leaves out"
        helper="Each one is kept out of every dish, swap and shopping list, like any diet. Press Enter after each."
        values={draft.avoid}
        onChange={(avoid) => setDraft((d) => ({ ...d, avoid }))}
        placeholder="e.g. white bread"
        max={L.avoidMax}
        maxLength={L.avoidNameMax}
        error={fieldError("avoid")}
      />
      <div>
        <label htmlFor="cp-guidance" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">How to cook for this plan (optional)</label>
        <textarea
          id="cp-guidance"
          value={draft.guidance}
          onChange={(e) => setDraft((d) => ({ ...d, guidance: e.target.value }))}
          rows={2}
          maxLength={L.guidanceMax}
          placeholder="e.g. light dinners, lots of vegetables, nothing fried"
          aria-describedby="cp-guidance-help"
          aria-invalid={!!fieldError("guidance")}
          className="w-full px-4 py-3 rounded-xl border-2 border-[#F5F1DD] bg-white text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none"
        />
        <p id="cp-guidance-help" className="text-xs mt-1.5" style={{ color: "#848181" }}>Clara reads this when it plans and swaps dishes. {draft.guidance.length}/{L.guidanceMax}</p>
        {fieldError("guidance") && <p className="text-error text-xs mt-1.5" role="alert">{fieldError("guidance")}</p>}
      </div>
      {error && !error.field && <p className="text-error text-sm" role="alert">{error.message}</p>}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
        <Button type="button" onClick={save} loading={saving} disabled={!draft.name.trim()}>
          {editing === "new" ? "Add plan" : "Save changes"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mt-4" onKeyDown={blockEnterSubmit} aria-labelledby="cp-heading" role="region">
      <p id="cp-heading" className="text-sm font-medium text-[#1E1A1A] mb-1">Your own plans</p>
      <p className="text-xs mb-3" style={{ color: "#848181" }}>
        Eat a way that isn&apos;t listed? Make your own plan — the foods it leaves out and how to cook for it. Saved as soon as you add it.
      </p>
      {notice && <p className="text-sm mb-3 font-medium" style={{ color: "#5F1C35" }} role="status" aria-live="polite">{notice}</p>}

      <ul className="space-y-3 mb-3">
        {items.map((p) => (
          <li key={p.id} className="rounded-xl border-2 border-[#F5F1DD] bg-white p-4">
            {editing === p.id ? form : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1E1A1A]">{p.name}</p>
                    {p.avoid.length > 0 && <p className="text-sm mt-1 text-[#4A4646] break-words">Leaves out: {p.avoid.join(", ")}</p>}
                    {p.guidance && <p className="text-sm mt-1 italic text-[#4A4646] break-words">&ldquo;{p.guidance}&rdquo;</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(p)} disabled={saving || editing !== null}>Edit</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setConfirmDelete(p.id); setError(null); }} disabled={saving || editing !== null}>Delete</Button>
                  </div>
                </div>
                {confirmDelete === p.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#FFF5F5] p-3" role="alertdialog" aria-label={`Delete ${p.name}?`}>
                    <p className="text-sm text-[#1E1A1A] flex-1 min-w-[12rem]">Delete {p.name}? Your meals stop following it.</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={saving}>Keep</Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => remove(p.id)} loading={saving}>Delete</Button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? form : (
        <Button type="button" variant="secondary" onClick={startNew} disabled={editing !== null || items.length >= L.perPatient}>
          {items.length >= L.perPatient ? `Up to ${L.perPatient} plans` : "+ Create your own plan"}
        </Button>
      )}
    </div>
  );
}
