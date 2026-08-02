"use client";

// Add / edit modal for meal-log entries. Creates MANUAL entries via
// POST /api/meal-log; edits any entry via PATCH /api/meal-log/[id].
// For non-MANUAL rows the per-serving snapshot is immutable (server-priced at
// log time) — only name / meal / servings are editable; the server rescales
// totals from the stored unrounded snapshot.

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import ServingsStepper from "./ServingsStepper";
import {
  MEAL_TYPE_ORDER,
  MEAL_TYPE_LABELS,
  newClientRequestId,
  type MealLogDTO,
  type MealType,
  type WriteResponse,
} from "./shared";

const MACRO_FIELDS = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "protein", label: "Protein (g)" },
  { key: "carbs", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" },
  { key: "fiber", label: "Fiber (g)" },
] as const;

type MacroKey = (typeof MACRO_FIELDS)[number]["key"];
type MacroFieldState = Record<MacroKey, string>;

const emptyMacros = (): MacroFieldState => ({
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
  fiber: "",
});

// A per-serving macro field: null (genuinely unset) prefills BLANK, not "0", so
// re-saving keeps it unset/incomplete rather than silently recording a 0.
const macroToField = (v: number | null): string => (v == null ? "" : String(v));

interface MealLogModalProps {
  open: boolean;
  onClose: () => void;
  /** The card's day — client-derived via formatLocalDate, never server-defaulted. */
  localDate: string;
  /** Present → edit mode. */
  initial?: MealLogDTO | null;
  defaultMealType?: MealType;
  onSaved: (res: WriteResponse, mode: "created" | "updated") => void;
}

export default function MealLogModal({
  open,
  onClose,
  localDate,
  initial,
  defaultMealType,
  onSaved,
}: MealLogModalProps) {
  const [name, setName] = useState("");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [servings, setServings] = useState(1);
  const [macros, setMacros] = useState<MacroFieldState>(emptyMacros());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Caller-supplied sources carry editable macros; server-priced snapshots
  // (RECIPE / CUSTOM / RESTAURANT) are servings-scaled only. CLARA joins the
  // editable set (S1 review decision): an estimate is exactly the row type a
  // user most wants to correct, and the API's PATCH gate
  // (isCallerSuppliedMacroSource) already allows it. The row keeps
  // source: CLARA after an edit — provenance means "Clara created this",
  // not "these numbers are untouched".
  const isManual = !initial || initial.source === "MANUAL" || initial.source === "CLARA";

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setMealType((initial?.mealType as MealType) ?? defaultMealType ?? "breakfast");
    setServings(initial?.servings ?? 1);
    setMacros(
      initial && (initial.source === "MANUAL" || initial.source === "CLARA")
        ? {
            calories: macroToField(initial.perServing.calories),
            protein: macroToField(initial.perServing.protein),
            carbs: macroToField(initial.perServing.carbs),
            fat: macroToField(initial.perServing.fat),
            fiber: macroToField(initial.perServing.fiber),
          }
        : emptyMacros()
    );
    setError("");
  }, [open, initial, defaultMealType]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a name for this meal.");
      return;
    }

    // Parse filled macro fields; blanks stay absent (the server flags the row
    // as incomplete nutrition rather than silently assuming 0).
    const perServing: Partial<Record<MacroKey, number>> = {};
    for (const field of MACRO_FIELDS) {
      const raw = macros[field.key].trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 10000) {
        setError(`${field.label} must be a number between 0 and 10000.`);
        return;
      }
      perServing[field.key] = n;
    }

    setSaving(true);
    setError("");
    try {
      const res = initial
        ? await fetch(`/api/meal-log/${initial.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: trimmed,
              mealType,
              servings,
              ...(isManual ? { perServing } : {}),
            }),
          })
        : await fetch("/api/meal-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              localDate,
              mealType,
              source: "MANUAL",
              name: trimmed,
              servings,
              perServing,
              clientRequestId: newClientRequestId(),
            }),
          });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.log) {
        setError(data?.error || "Could not save. Please try again.");
        return;
      }
      onSaved(data as WriteResponse, initial ? "updated" : "created");
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit meal" : "Log a meal"}>
      <div className="flex flex-col gap-4">
        <Input
          id="meal-log-name"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grilled chicken salad"
          maxLength={120}
        />

        {/* Meal-type pill group (QuickJournalLog option-pill styling) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#1E1A1A]">Meal</span>
          <div className="grid grid-cols-4 gap-2">
            {MEAL_TYPE_ORDER.map((mt) => (
              <button
                key={mt}
                type="button"
                onClick={() => setMealType(mt)}
                aria-pressed={mealType === mt}
                className="px-2 py-2 rounded-xl border-2 text-xs font-bold transition-all cursor-pointer"
                style={
                  mealType === mt
                    ? { borderColor: "#812549", background: "rgba(129,37,73,0.08)", color: "#1E1A1A" }
                    : { borderColor: "#F5F1DD", background: "#fff", color: "#848181" }
                }
              >
                {MEAL_TYPE_LABELS[mt]}
              </button>
            ))}
          </div>
        </div>

        {/* Servings — labeled with the ingredient's unit for CUSTOM rows */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#1E1A1A]">
            {initial?.source === "CUSTOM" && initial.unit ? (
              <>
                Quantity <span className="font-normal text-[#848181]">({initial.unit})</span>
              </>
            ) : (
              "Servings"
            )}
          </span>
          <ServingsStepper value={servings} onChange={setServings} disabled={saving} />
        </div>

        {/* Per-serving nutrition */}
        {isManual ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[#1E1A1A]">
              Nutrition per serving <span className="font-normal text-[#848181]">(optional)</span>
            </span>
            <div className="grid grid-cols-2 gap-3">
              {MACRO_FIELDS.map((field) => (
                <Input
                  key={field.key}
                  id={`meal-log-${field.key}`}
                  label={field.label}
                  type="number"
                  min={0}
                  max={10000}
                  step="any"
                  inputMode="decimal"
                  value={macros[field.key]}
                  onChange={(e) =>
                    setMacros((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder="—"
                />
              ))}
            </div>
            <p className="text-xs text-[#848181]">
              Fields left blank stay unset (not zero) and flag the entry as incomplete nutrition.
            </p>
          </div>
        ) : (
          initial && (
            <div className="rounded-xl bg-[#F9F7ED] border border-[#EAE4CA] px-3.5 py-3">
              <p className="text-xs font-semibold text-[#1E1A1A] tabular-nums">
                {initial.source === "CUSTOM" && initial.unit ? `Per ${initial.unit}` : "Per serving"}:{" "}
                {Math.round(initial.perServing.calories ?? 0)} kcal · P{" "}
                {Math.round(initial.perServing.protein ?? 0)}g · C{" "}
                {Math.round(initial.perServing.carbs ?? 0)}g · F{" "}
                {Math.round(initial.perServing.fat ?? 0)}g
              </p>
              <p className="text-[11px] text-[#848181] mt-1">
                Nutrition was snapshotted when this meal was logged — adjust servings to change
                the totals.
              </p>
            </div>
          )
        )}

        {error && (
          <p className="text-error text-xs" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {initial ? "Save changes" : "Add to log"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
