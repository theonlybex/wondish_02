"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { CUSTOM_CONDITION_LIMITS as L, type CustomConditionField } from "@/lib/custom-conditions";
import type { CustomConditionView } from "@/lib/custom-conditions-server";

// "My conditions" — user-defined conditions with their own rules (spec
// docs/superpowers/specs/2026-09-11-custom-conditions-design.md). Lives
// under the profile form; talks to /api/patient/conditions.

type Draft = { name: string; avoid: string[]; guidance: string; symptoms: string[] };
const emptyDraft = (): Draft => ({ name: "", avoid: [], guidance: "", symptoms: [] });
const toDraft = (c: CustomConditionView): Draft => ({ name: c.name, avoid: [...c.avoid], guidance: c.guidance ?? "", symptoms: c.symptoms.map((s) => s.label) });

// Tag input: type, then Enter / comma / "Add"; chips remove with ×.
function TagInput({
  id, label, helper, values, onChange, placeholder, max, maxLength, error,
}: {
  id: string; label: string; helper: string; values: string[]; onChange: (v: string[]) => void;
  placeholder: string; max: number; maxLength: number; error?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  };
  const full = values.length >= max;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#1E1A1A] mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={full ? `Up to ${max}` : placeholder}
          disabled={full}
          maxLength={maxLength}
          aria-describedby={`${id}-help`}
          aria-invalid={!!error}
          className="flex-1 min-h-[44px] px-4 rounded-xl border-2 border-[#F5F1DD] bg-white text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all disabled:opacity-50"
        />
        <Button type="button" variant="secondary" onClick={add} disabled={full || !draft.trim()}>Add</Button>
      </div>
      <p id={`${id}-help`} className="text-xs mt-1.5" style={{ color: "#848181" }}>{helper} ({values.length}/{max})</p>
      {error && <p className="text-error text-xs mt-1.5" role="alert">{error}</p>}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2 mt-2" aria-label={`${label} added`}>
          {values.map((v) => (
            <li key={v} className="flex items-center rounded-full bg-[#F3F2FF] text-sm font-medium text-[#4A4646] pl-3">
              <span className="py-2">{v}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-[#812549] hover:bg-[#812549]/10"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CustomConditions({ initial }: { initial: CustomConditionView[] }) {
  const router = useRouter();
  const [items, setItems] = useState<CustomConditionView[]>(initial);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<{ field?: CustomConditionField; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const startNew = () => { setDraft(emptyDraft()); setError(null); setNotice(""); setEditing("new"); };
  const startEdit = (c: CustomConditionView) => { setDraft(toDraft(c)); setError(null); setNotice(""); setEditing(c.id); };
  const cancel = () => { setEditing(null); setError(null); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/patient/conditions" : `/api/patient/conditions/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, avoid: draft.avoid, guidance: draft.guidance || null, symptoms: draft.symptoms }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ field: data.field, message: data.error ?? "Could not save. Please try again." });
        return;
      }
      const saved: CustomConditionView = data.condition;
      setItems((list) => (isNew ? [...list, saved] : list.map((c) => (c.id === saved.id ? saved : c))).sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
      setNotice(`${saved.name} saved — Clara and your next week will follow it.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/patient/conditions/${id}`, { method: "DELETE" });
      if (!res.ok) { setError({ message: "Could not delete. Please try again." }); return; }
      const gone = items.find((c) => c.id === id);
      setItems((list) => list.filter((c) => c.id !== id));
      setConfirmDelete(null);
      setNotice(gone ? `${gone.name} removed.` : "Removed.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (f: CustomConditionField) => (error?.field === f ? error.message : undefined);
  const form = (
    <div className="rounded-xl border-2 border-[#F5F1DD] bg-white p-4 sm:p-5 space-y-5" role="group" aria-label={editing === "new" ? "New condition" : "Edit condition"}>
      <Input
        label="Condition name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder="e.g. Gout, Histamine intolerance"
        maxLength={L.nameMax}
        error={fieldError("name")}
        required
      />
      <TagInput
        id="cc-avoid"
        label="Ingredients to avoid"
        helper="Each one is excluded from every dish, swap and shopping list, like an allergy would be. Press Enter after each."
        values={draft.avoid}
        onChange={(avoid) => setDraft((d) => ({ ...d, avoid }))}
        placeholder="e.g. anchovies"
        max={L.avoidMax}
        maxLength={L.avoidNameMax}
        error={fieldError("avoid")}
      />
      <div>
        <label htmlFor="cc-guidance" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">A note for Clara (optional)</label>
        <textarea
          id="cc-guidance"
          value={draft.guidance}
          onChange={(e) => setDraft((d) => ({ ...d, guidance: e.target.value }))}
          rows={2}
          maxLength={L.guidanceMax}
          placeholder="e.g. small portions of red meat, no beer, plenty of water"
          aria-describedby="cc-guidance-help"
          aria-invalid={!!fieldError("guidance")}
          className="w-full px-4 py-3 rounded-xl border-2 border-[#F5F1DD] bg-white text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none"
        />
        <p id="cc-guidance-help" className="text-xs mt-1.5" style={{ color: "#848181" }}>How to cook for it — Clara reads this when it plans and swaps dishes. {draft.guidance.length}/{L.guidanceMax}</p>
        {fieldError("guidance") && <p className="text-error text-xs mt-1.5" role="alert">{fieldError("guidance")}</p>}
      </div>
      <TagInput
        id="cc-symptoms"
        label="Symptoms to track"
        helper="These appear in your daily journal so you can see what changes."
        values={draft.symptoms}
        onChange={(symptoms) => setDraft((d) => ({ ...d, symptoms }))}
        placeholder="e.g. joint pain"
        max={L.symptomsMax}
        maxLength={L.symptomMax}
        error={fieldError("symptoms")}
      />
      {error && !error.field && <p className="text-error text-sm" role="alert">{error.message}</p>}
      <p className="text-xs" style={{ color: "#848181" }}>Wondish plans around what you enter here; it is not medical advice. Check the rules with your clinician.</p>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
        <Button type="button" onClick={save} loading={saving} disabled={!draft.name.trim()}>
          {editing === "new" ? "Add condition" : "Save changes"}
        </Button>
      </div>
    </div>
  );

  return (
    <section className="max-w-2xl mt-10" aria-labelledby="cc-heading">
      <h2 id="cc-heading" className="text-base font-semibold text-navy mb-1">My conditions</h2>
      <p className="text-sm mb-4" style={{ color: "#848181" }}>
        Not in the list above? Add your own, with the ingredients it rules out, a note for Clara and the symptoms to track.
      </p>

      {notice && <p className="text-sm mb-3 font-medium" style={{ color: "#5F1C35" }} role="status" aria-live="polite">{notice}</p>}

      {items.length === 0 && editing !== "new" && (
        <p className="text-sm mb-4" style={{ color: "#848181" }}>You haven&apos;t added any conditions of your own yet.</p>
      )}

      <ul className="space-y-3 mb-4">
        {items.map((c) => (
          <li key={c.id} className="rounded-xl border-2 border-[#F5F1DD] bg-white p-4">
            {editing === c.id ? form : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1E1A1A]">{c.name}</p>
                    <p className="text-xs mt-1" style={{ color: "#848181" }}>
                      {c.avoid.length} ingredient{c.avoid.length === 1 ? "" : "s"} avoided · {c.symptoms.length} symptom{c.symptoms.length === 1 ? "" : "s"} tracked{c.guidance ? " · note for Clara" : ""}
                    </p>
                    {c.avoid.length > 0 && <p className="text-sm mt-2 text-[#4A4646] break-words">Avoids: {c.avoid.join(", ")}</p>}
                    {c.symptoms.length > 0 && <p className="text-sm mt-1 text-[#4A4646] break-words">Tracks: {c.symptoms.map((s) => s.label).join(", ")}</p>}
                    {c.guidance && <p className="text-sm mt-1 italic text-[#4A4646] break-words">&ldquo;{c.guidance}&rdquo;</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(c)} disabled={saving || editing !== null}>Edit</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setConfirmDelete(c.id); setError(null); }} disabled={saving || editing !== null}>Delete</Button>
                  </div>
                </div>
                {confirmDelete === c.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#FFF5F5] p-3" role="alertdialog" aria-label={`Delete ${c.name}?`}>
                    <p className="text-sm text-[#1E1A1A] flex-1 min-w-[12rem]">Delete {c.name}? Its rules and symptom history go with it.</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={saving}>Keep</Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => remove(c.id)} loading={saving}>Delete</Button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {editing === "new" ? form : (
        <Button type="button" variant="secondary" onClick={startNew} disabled={editing !== null || items.length >= L.perPatient}>
          {items.length >= L.perPatient ? `Up to ${L.perPatient} conditions` : "+ Add your own condition"}
        </Button>
      )}
    </section>
  );
}
