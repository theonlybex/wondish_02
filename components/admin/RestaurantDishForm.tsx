"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

export interface DishIngredientRow {
  name: string;
  quantity: string;
  unit: string;
}

export interface DishFormValues {
  id?: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  section: string;
  sortOrder: string;
  dishTypeId: string;
  mealTypeId: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  isRecommended: boolean;
  available: boolean;
  status: "DRAFT" | "PUBLISHED";
  ingredients: DishIngredientRow[];
}

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
];

interface RestaurantDishFormProps {
  restaurantId: string;
  initial?: Partial<DishFormValues>;
  dishTypes: { id: string; name: string }[];
  mealTypes: { id: string; name: string }[];
  mode: "create" | "edit";
  onSaved: () => void;
  onCancel: () => void;
}

export default function RestaurantDishForm({
  restaurantId,
  initial,
  dishTypes,
  mealTypes,
  mode,
  onSaved,
  onCancel,
}: RestaurantDishFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<DishFormValues>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    price: initial?.price ?? "",
    currency: initial?.currency ?? "USD",
    section: initial?.section ?? "",
    sortOrder: initial?.sortOrder ?? "0",
    dishTypeId: initial?.dishTypeId ?? "",
    mealTypeId: initial?.mealTypeId ?? "",
    calories: initial?.calories ?? "",
    protein: initial?.protein ?? "",
    carbs: initial?.carbs ?? "",
    fat: initial?.fat ?? "",
    fiber: initial?.fiber ?? "",
    isRecommended: initial?.isRecommended ?? false,
    available: initial?.available ?? true,
    status: initial?.status ?? "DRAFT",
    ingredients: initial?.ingredients ?? [],
  });

  const set = <K extends keyof DishFormValues>(key: K, value: DishFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const addIngredient = () =>
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { name: "", quantity: "", unit: "" }] }));

  const updateIngredient = (idx: number, field: keyof DishIngredientRow, value: string) =>
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    }));

  const removeIngredient = (idx: number) =>
    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload = {
      name: form.name,
      description: form.description || null,
      price: form.price || null,
      currency: form.currency,
      section: form.section,
      sortOrder: form.sortOrder ? parseInt(form.sortOrder, 10) : 0,
      dishTypeId: form.dishTypeId || null,
      mealTypeId: form.mealTypeId || null,
      calories: form.calories ? parseFloat(form.calories) : null,
      protein: form.protein ? parseFloat(form.protein) : null,
      carbs: form.carbs ? parseFloat(form.carbs) : null,
      fat: form.fat ? parseFloat(form.fat) : null,
      fiber: form.fiber ? parseFloat(form.fiber) : null,
      isRecommended: form.isRecommended,
      available: form.available,
      status: form.status,
      ingredients: form.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({
          name: i.name.trim(),
          quantity: i.quantity ? parseFloat(i.quantity) : null,
          unit: i.unit || null,
        })),
    };

    try {
      const url =
        mode === "create"
          ? `/api/admin/restaurants/${restaurantId}/dishes`
          : `/api/admin/restaurants/${restaurantId}/dishes/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Surfaces the publish-gate 400 ("Cannot publish a dish with no
        // ingredients") verbatim, same as any other validation error.
        throw new Error(body.error || "Failed to save dish");
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input
            label="Dish Name *"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="e.g. Pad Thai"
          />
        </div>

        <Input
          label="Section *"
          value={form.section}
          onChange={(e) => set("section", e.target.value)}
          required
          placeholder="e.g. Mains"
        />

        <Input
          label="Sort Order"
          type="number"
          value={form.sortOrder}
          onChange={(e) => set("sortOrder", e.target.value)}
        />

        <Input
          label="Price"
          type="number"
          min="0"
          step="0.01"
          value={form.price}
          onChange={(e) => set("price", e.target.value)}
          placeholder="0.00"
        />

        <Input
          label="Currency"
          value={form.currency}
          onChange={(e) => set("currency", e.target.value.toUpperCase())}
          maxLength={3}
        />

        <Select
          label="Dish Type"
          value={form.dishTypeId}
          onChange={(e) => set("dishTypeId", e.target.value)}
          options={dishTypes.map((d) => ({ value: d.id, label: d.name }))}
          placeholder="Select dish type"
        />

        <Select
          label="Meal Type"
          value={form.mealTypeId}
          onChange={(e) => set("mealTypeId", e.target.value)}
          options={mealTypes.map((m) => ({ value: m.id, label: m.name }))}
          placeholder="Select meal type"
        />

        <Select
          label="Status"
          value={form.status}
          onChange={(e) => set("status", e.target.value as DishFormValues["status"])}
          options={STATUS_OPTIONS}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-[#1E1A1A] block mb-1.5">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          className="w-full px-3.5 py-2.5 rounded-xl border border-[#EAE4CA] bg-white text-sm text-[#1E1A1A] placeholder:text-[#A8A4B5] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all resize-none"
          placeholder="Brief description..."
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={form.isRecommended}
            onChange={(e) => set("isRecommended", e.target.checked)}
            className="w-4 h-4 rounded border-[#EAE4CA] text-primary focus:ring-primary/30"
          />
          Recommended
        </label>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={form.available}
            onChange={(e) => set("available", e.target.checked)}
            className="w-4 h-4 rounded border-[#EAE4CA] text-primary focus:ring-primary/30"
          />
          Available
        </label>
      </div>

      <div>
        <p className="text-sm font-semibold text-navy mb-3">Nutrition (whole dish)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {(["calories", "protein", "carbs", "fat", "fiber"] as const).map((field) => (
            <Input
              key={field}
              label={field.charAt(0).toUpperCase() + field.slice(1)}
              type="number"
              min="0"
              step="0.1"
              value={form[field]}
              onChange={(e) => set(field, e.target.value)}
              placeholder="0"
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-navy">
            Ingredients {form.status === "PUBLISHED" && <span className="text-[#848181] font-normal">(required to publish)</span>}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={addIngredient}>
            + Add
          </Button>
        </div>
        <div className="space-y-2">
          {form.ingredients.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  placeholder="Ingredient name"
                  value={row.name}
                  onChange={(e) => updateIngredient(idx, "name", e.target.value)}
                />
              </div>
              <Input
                className="w-24"
                placeholder="Qty"
                type="number"
                min="0"
                step="0.01"
                value={row.quantity}
                onChange={(e) => updateIngredient(idx, "quantity", e.target.value)}
              />
              <Input
                className="w-20"
                placeholder="Unit"
                value={row.unit}
                onChange={(e) => updateIngredient(idx, "unit", e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeIngredient(idx)}
                className="text-error text-lg leading-none pb-2.5"
                aria-label="Remove ingredient"
              >
                ✕
              </button>
            </div>
          ))}
          {form.ingredients.length === 0 && (
            <p className="text-xs text-[#848181]">No ingredients yet. Add one above.</p>
          )}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>
          {mode === "create" ? "Create Dish" : "Save Changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
