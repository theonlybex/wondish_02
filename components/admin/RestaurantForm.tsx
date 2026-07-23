"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

export interface RestaurantFormValues {
  id?: string;
  name: string;
  slug: string;
  neighborhood: string;
  description: string;
  ethnicId: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  website: string;
  imageUrl: string;
  logoUrl: string;
}

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

interface RestaurantFormProps {
  initial?: Partial<RestaurantFormValues>;
  ethnics: { id: string; name: string }[];
  mode: "create" | "edit";
  onSaved: () => void;
  onCancel: () => void;
}

export default function RestaurantForm({ initial, ethnics, mode, onSaved, onCancel }: RestaurantFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<RestaurantFormValues>({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    neighborhood: initial?.neighborhood ?? "",
    description: initial?.description ?? "",
    ethnicId: initial?.ethnicId ?? "",
    status: initial?.status ?? "DRAFT",
    addressLine: initial?.addressLine ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    postalCode: initial?.postalCode ?? "",
    phone: initial?.phone ?? "",
    website: initial?.website ?? "",
    imageUrl: initial?.imageUrl ?? "",
    logoUrl: initial?.logoUrl ?? "",
  });

  const set = <K extends keyof RestaurantFormValues>(key: K, value: RestaurantFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload: Record<string, unknown> = {
      name: form.name,
      neighborhood: form.neighborhood,
      description: form.description || null,
      ethnicId: form.ethnicId || null,
      status: form.status,
      addressLine: form.addressLine || null,
      city: form.city || null,
      state: form.state || null,
      postalCode: form.postalCode || null,
      phone: form.phone || null,
      website: form.website || null,
      imageUrl: form.imageUrl || null,
      logoUrl: form.logoUrl || null,
    };
    // Only send slug when the operator explicitly set one; on create, an
    // empty slug lets the server derive it from name.
    if (mode === "edit" || form.slug.trim()) payload.slug = form.slug || undefined;

    try {
      const url = mode === "create" ? "/api/admin/restaurants" : `/api/admin/restaurants/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save restaurant");
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
            label="Restaurant Name *"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            placeholder="e.g. Miracle Mile Kitchen"
          />
        </div>

        <Input
          label="Slug"
          value={form.slug}
          onChange={(e) => set("slug", e.target.value)}
          placeholder={mode === "create" ? "auto-generated from name if left blank" : ""}
        />

        <Input
          label="Neighborhood *"
          value={form.neighborhood}
          onChange={(e) => set("neighborhood", e.target.value)}
          required
          placeholder="e.g. Miracle Mile"
        />

        <Select
          label="Cuisine"
          value={form.ethnicId}
          onChange={(e) => set("ethnicId", e.target.value)}
          options={ethnics.map((e) => ({ value: e.id, label: e.name }))}
          placeholder="Select cuisine"
        />

        <Select
          label="Status"
          value={form.status}
          onChange={(e) => set("status", e.target.value as RestaurantFormValues["status"])}
          options={STATUS_OPTIONS}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-[#1E1A1A] block mb-1.5">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          className="w-full px-3.5 py-2.5 rounded-xl border border-[#EAE4CA] bg-white text-sm text-[#1E1A1A] placeholder:text-[#A8A4B5] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all resize-none"
          placeholder="Brief description..."
        />
      </div>

      <div>
        <p className="text-sm font-semibold text-navy mb-3">Location & contact</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Input
              label="Address"
              value={form.addressLine}
              onChange={(e) => set("addressLine", e.target.value)}
            />
          </div>
          <Input label="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
          <Input label="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
          <Input
            label="Postal Code"
            value={form.postalCode}
            onChange={(e) => set("postalCode", e.target.value)}
          />
          <Input label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <Input label="Website" value={form.website} onChange={(e) => set("website", e.target.value)} />
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-navy mb-3">Media</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Image URL" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
          <Input label="Logo URL" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>
          {mode === "create" ? "Create Restaurant" : "Save Changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
