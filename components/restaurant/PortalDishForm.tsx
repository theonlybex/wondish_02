"use client";

// Phase 6a M2 — the staff dish editor (design §5.3): basics, price,
// whole-dish nutrition (all optional, blank = unknown), and the
// catalog-backed ingredient list. No recipe/steps field exists on purpose.

import { useState } from "react";
import Button from "@/components/ui/Button";
import IngredientPicker, { IngredientRowValue } from "@/components/restaurant/IngredientPicker";
import type { PortalDishDTO } from "@/lib/restaurant-portal-server";

const MACRO_FIELDS = [
  { key: "calories", label: "Calories", suffix: "kcal" },
  { key: "protein", label: "Protein", suffix: "g" },
  { key: "carbs", label: "Carbs", suffix: "g" },
  { key: "fat", label: "Fat", suffix: "g" },
  { key: "fiber", label: "Fiber", suffix: "g" },
] as const;

interface FormState {
  name: string;
  section: string;
  description: string;
  price: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  available: boolean;
  ingredients: IngredientRowValue[];
}

function initialState(dish: PortalDishDTO | null): FormState {
  return {
    name: dish?.name ?? "",
    section: dish?.section ?? "",
    description: dish?.description ?? "",
    price: dish?.price ?? "",
    calories: dish?.calories != null ? String(dish.calories) : "",
    protein: dish?.protein != null ? String(dish.protein) : "",
    carbs: dish?.carbs != null ? String(dish.carbs) : "",
    fat: dish?.fat != null ? String(dish.fat) : "",
    fiber: dish?.fiber != null ? String(dish.fiber) : "",
    available: dish?.available ?? true,
    ingredients: (dish?.ingredients ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity != null ? String(i.quantity) : "",
      unit: i.unit ?? "",
      ingredientId: i.ingredientId,
    })),
  };
}

function macroOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function PortalDishForm({
  restaurantId,
  dish,
  sections,
  onSaved,
  onCancel,
}: {
  restaurantId: string;
  dish: PortalDishDTO | null;
  sections: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(dish));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const nutritionComplete = MACRO_FIELDS.every((m) => form[m.key].trim() !== "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        section: form.section,
        description: form.description || null,
        price: form.price,
        calories: macroOrNull(form.calories),
        protein: macroOrNull(form.protein),
        carbs: macroOrNull(form.carbs),
        fat: macroOrNull(form.fat),
        fiber: macroOrNull(form.fiber),
        available: form.available,
        ingredients: form.ingredients.map((r) => ({
          name: r.name,
          quantity: r.quantity.trim() === "" ? null : Number(r.quantity),
          unit: r.unit.trim() === "" ? null : r.unit.trim(),
          ingredientId: r.ingredientId,
        })),
      };
      const res = await fetch(
        dish
          ? `/api/restaurant-portal/${restaurantId}/dishes/${dish.id}`
          : `/api/restaurant-portal/${restaurantId}/dishes`,
        {
          method: dish ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't save the dish");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && (
        <div className="bg-error/10 border border-error/20 rounded-xl px-3 py-2 mb-4 text-xs text-error">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
            Dish name *
          </span>
          <input
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="w-full border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
            Menu section *
          </span>
          <input
            required
            list="portal-sections"
            value={form.section}
            onChange={(e) => set("section", e.target.value)}
            placeholder="e.g. Mains"
            className="w-full border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
          />
          <datalist id="portal-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
      </div>

      <label className="block mb-4">
        <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
          Description
        </span>
        <textarea
          rows={2}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          className="w-full border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-end gap-4 mb-5">
        <label>
          <span className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
            Price (USD)
          </span>
          <input
            inputMode="decimal"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            placeholder="14.50"
            className="w-28 border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-[#1E1A1A]">
          <input
            type="checkbox"
            checked={form.available}
            onChange={(e) => set("available", e.target.checked)}
          />
          Available right now
        </label>
      </div>

      {/* Nutrition */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#848181" }}>
            Nutrition — whole dish as served
          </p>
          <span
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${
              nutritionComplete
                ? "bg-success/10 text-success border-success/20"
                : "bg-[#F9F7ED] text-[#848181] border-[#EAE4CA]"
            }`}
          >
            {nutritionComplete ? "Nutrition complete ✓" : "Nutrition incomplete"}
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          {MACRO_FIELDS.map((m) => (
            <label key={m.key}>
              <span className="block text-[10px] mb-1" style={{ color: "#848181" }}>
                {m.label} ({m.suffix})
              </span>
              <input
                inputMode="decimal"
                value={form[m.key]}
                onChange={(e) => set(m.key, e.target.value)}
                className="w-24 border border-[#EAE4CA] rounded-xl px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
        <p className="text-[11px] mt-2" style={{ color: "#9C9494" }}>
          Estimates are fine — diners use this to budget their day. Leave a field blank if you
          don&apos;t know it.
        </p>
      </div>

      {/* Ingredients */}
      <div className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#848181" }}>
          Ingredients * <span className="normal-case font-normal">(required to publish)</span>
        </p>
        <p className="text-[11px] mb-2" style={{ color: "#9C9494" }}>
          List what&apos;s in the dish — you never need to share how you make it. Ingredients power
          allergy safety; amounts are optional.
        </p>
        <IngredientPicker rows={form.ingredients} onChange={(rows) => set("ingredients", rows)} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {dish ? "Save changes" : "Create dish"}
        </Button>
      </div>
    </form>
  );
}
