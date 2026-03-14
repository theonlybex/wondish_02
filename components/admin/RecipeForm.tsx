"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { RecipeDTO } from "@/types";

interface RefData {
  mealTypes: { id: string; name: string }[];
  dishTypes: { id: string; name: string }[];
  ethnics: { id: string; name: string }[];
  ingredients: { id: string; name: string; unit?: string | null }[];
}

interface RecipeFormProps {
  recipe?: Partial<RecipeDTO>;
  refData: RefData;
  mode: "create" | "edit";
}

interface IngredientRow {
  ingredientId: string;
  quantity: string;
  unit: string;
}

export default function RecipeForm({ recipe, refData, mode }: RecipeFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: recipe?.name ?? "",
    description: recipe?.description ?? "",
    emoji: recipe?.emoji ?? "",
    calories: String(recipe?.calories ?? ""),
    protein: String(recipe?.protein ?? ""),
    carbs: String(recipe?.carbs ?? ""),
    fat: String(recipe?.fat ?? ""),
    fiber: String(recipe?.fiber ?? ""),
    prepTime: String(recipe?.prepTime ?? ""),
    cookTime: String(recipe?.cookTime ?? ""),
    servings: String(recipe?.servings ?? "1"),
    mealTypeId: recipe?.mealTypeId ?? "",
    dishTypeId: recipe?.dishTypeId ?? "",
    ethnicId: recipe?.ethnicId ?? "",
  });

  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    recipe?.ingredients?.map((i) => ({
      ingredientId: i.ingredientId,
      quantity: String(i.quantity ?? ""),
      unit: i.unit ?? "",
    })) ?? []
  );

  const addIngredient = () =>
    setIngredients((prev) => [...prev, { ingredientId: "", quantity: "", unit: "" }]);

  const updateIngredient = (idx: number, field: keyof IngredientRow, value: string) => {
    setIngredients((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );
  };

  const removeIngredient = (idx: number) =>
    setIngredients((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload = {
      name: form.name,
      description: form.description || null,
      emoji: form.emoji || null,
      calories: form.calories ? parseFloat(form.calories) : null,
      protein: form.protein ? parseFloat(form.protein) : null,
      carbs: form.carbs ? parseFloat(form.carbs) : null,
      fat: form.fat ? parseFloat(form.fat) : null,
      fiber: form.fiber ? parseFloat(form.fiber) : null,
      prepTime: form.prepTime ? parseInt(form.prepTime) : null,
      cookTime: form.cookTime ? parseInt(form.cookTime) : null,
      servings: form.servings ? parseInt(form.servings) : 1,
      mealTypeId: form.mealTypeId || null,
      dishTypeId: form.dishTypeId || null,
      ethnicId: form.ethnicId || null,
      ingredients: ingredients
        .filter((i) => i.ingredientId)
        .map((i) => ({
          ingredientId: i.ingredientId,
          quantity: i.quantity ? parseFloat(i.quantity) : null,
          unit: i.unit || null,
        })),
    };

    try {
      const url =
        mode === "create"
          ? "/api/admin/recipes"
          : `/api/admin/recipes/${recipe?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to save recipe");
      router.push("/admin/recipes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {error && (
        <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input
            label="Recipe Name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            placeholder="e.g. Grilled Chicken Salad"
          />
        </div>

        <Input
          label="Emoji"
          value={form.emoji}
          onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
          placeholder="🍽"
          maxLength={4}
        />

        <Select
          label="Meal Type"
          value={form.mealTypeId}
          onChange={(e) => setForm((f) => ({ ...f, mealTypeId: e.target.value }))}
          options={refData.mealTypes.map((m) => ({ value: m.id, label: m.name }))}
          placeholder="Select meal type"
        />

        <Select
          label="Dish Type"
          value={form.dishTypeId}
          onChange={(e) => setForm((f) => ({ ...f, dishTypeId: e.target.value }))}
          options={refData.dishTypes.map((m) => ({ value: m.id, label: m.name }))}
          placeholder="Select dish type"
        />

        <Select
          label="Ethnic Cuisine"
          value={form.ethnicId}
          onChange={(e) => setForm((f) => ({ ...f, ethnicId: e.target.value }))}
          options={refData.ethnics.map((m) => ({ value: m.id, label: m.name }))}
          placeholder="Select cuisine"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-[#25293C] block mb-1.5">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          rows={3}
          className="w-full px-3.5 py-2.5 rounded-xl border border-[#E8E7EA] bg-white text-sm text-[#25293C] placeholder:text-[#A8A4B5] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all resize-none"
          placeholder="Brief description..."
        />
      </div>

      {/* Macros */}
      <div>
        <p className="text-sm font-semibold text-navy mb-3">Nutrition (per serving)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {(["calories", "protein", "carbs", "fat", "fiber"] as const).map((field) => (
            <Input
              key={field}
              label={field.charAt(0).toUpperCase() + field.slice(1)}
              type="number"
              min="0"
              step="0.1"
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              placeholder="0"
            />
          ))}
          <Input
            label="Servings"
            type="number"
            min="1"
            value={form.servings}
            onChange={(e) => setForm((f) => ({ ...f, servings: e.target.value }))}
          />
        </div>
      </div>

      {/* Times */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Prep Time (min)"
          type="number"
          min="0"
          value={form.prepTime}
          onChange={(e) => setForm((f) => ({ ...f, prepTime: e.target.value }))}
          placeholder="0"
        />
        <Input
          label="Cook Time (min)"
          type="number"
          min="0"
          value={form.cookTime}
          onChange={(e) => setForm((f) => ({ ...f, cookTime: e.target.value }))}
          placeholder="0"
        />
      </div>

      {/* Ingredients */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-navy">Ingredients</p>
          <Button type="button" variant="secondary" size="sm" onClick={addIngredient}>
            + Add
          </Button>
        </div>
        <div className="space-y-2">
          {ingredients.map((row, idx) => (
            <div key={idx} className="flex gap-2 items-end">
              <div className="flex-1">
                <Select
                  options={refData.ingredients.map((i) => ({
                    value: i.id,
                    label: i.name,
                  }))}
                  value={row.ingredientId}
                  onChange={(e) => updateIngredient(idx, "ingredientId", e.target.value)}
                  placeholder="Select ingredient"
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
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>
          {mode === "create" ? "Create Recipe" : "Save Changes"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
