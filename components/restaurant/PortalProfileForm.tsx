"use client";

// Phase 6a M4 — restaurant profile editor (design §5.5). Name is display-only
// (renames go through your Wondish contact); photo and logo are real uploads
// into the staff-scoped "restaurants" folder, replacing paste-a-URL.

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";

export interface PortalProfileDTO {
  id: string;
  name: string;
  description: string | null;
  neighborhood: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  website: string | null;
  hours: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
}

const fieldClass =
  "w-full bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-3 text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelClass = "block text-sm font-medium text-[#1E1A1A] mb-1.5";

function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  onError,
}: {
  label: string;
  hint: string;
  value: string | null;
  onChange: (url: string | null) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "restaurants");
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body?.error ?? "Upload failed.");
        return;
      }
      onChange(body.url);
    } catch {
      onError("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={`${label} preview`}
            className="w-16 h-16 rounded-xl object-cover border border-[#EAE4CA] bg-white"
          />
        ) : (
          <div
            aria-hidden
            className="w-16 h-16 rounded-xl border border-dashed border-[#EAE4CA] bg-white flex items-center justify-center text-[10px] text-[#ABA6A6]"
          >
            none
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={uploading}
              aria-label={`${value ? "Replace" : "Upload"} ${label.toLowerCase()}`}
              onClick={() => inputRef.current?.click()}
            >
              {value ? "Replace" : "Upload"}
            </Button>
            {value && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploading}
                aria-label={`Remove ${label.toLowerCase()}`}
                onClick={() => onChange(null)}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "#ABA6A6" }}>
            {hint}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export default function PortalProfileForm({
  initial,
  hoursLocked = false,
}: {
  initial: PortalProfileDTO;
  // True when ops stored structured hours JSON the portal can't edit — the
  // field renders read-only and is omitted from the save payload.
  hoursLocked?: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof PortalProfileDTO>(key: K, value: PortalProfileDTO[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/restaurant-portal/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description,
          neighborhood: form.neighborhood,
          addressLine: form.addressLine,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          phone: form.phone,
          website: form.website,
          ...(hoursLocked ? {} : { hours: form.hours }),
          imageUrl: form.imageUrl,
          logoUrl: form.logoUrl,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Save failed.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-5"
    >
      {error && (
        <div role="alert" className="bg-error/10 border border-error/20 rounded-xl px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="profile-name">
          Name
        </label>
        <input id="profile-name" value={form.name} readOnly aria-readonly className={`${fieldClass} opacity-60 cursor-not-allowed`} />
        <p className="text-[11px] mt-1" style={{ color: "#ABA6A6" }}>
          Renames go through your Wondish contact — everything else here is yours.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="profile-description">
          Description
        </label>
        <textarea
          id="profile-description"
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          className={fieldClass}
          placeholder="A sentence or two diners see on your page."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="profile-neighborhood">
            Neighborhood <span className="text-error">*</span>
          </label>
          <input
            id="profile-neighborhood"
            value={form.neighborhood}
            onChange={(e) => set("neighborhood", e.target.value)}
            required
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="profile-address">
            Street address
          </label>
          <input
            id="profile-address"
            value={form.addressLine ?? ""}
            onChange={(e) => set("addressLine", e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="profile-city">
            City
          </label>
          <input id="profile-city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="profile-state">
            State
          </label>
          <input id="profile-state" value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="profile-postal">
            ZIP
          </label>
          <input
            id="profile-postal"
            value={form.postalCode ?? ""}
            onChange={(e) => set("postalCode", e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="profile-phone">
            Phone
          </label>
          <input
            id="profile-phone"
            type="tel"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="profile-website">
            Website
          </label>
          <input
            id="profile-website"
            type="url"
            value={form.website ?? ""}
            onChange={(e) => set("website", e.target.value)}
            className={fieldClass}
            placeholder="https://…"
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="profile-hours">
          Hours
        </label>
        {hoursLocked ? (
          <p className="text-sm bg-[#F9F7ED] border border-[#EAE4CA] rounded-xl px-4 py-3" style={{ color: "#848181" }}>
            Your hours are managed by your Wondish contact — ask them to make changes.
          </p>
        ) : (
          <>
            <textarea
              id="profile-hours"
              value={form.hours ?? ""}
              onChange={(e) => set("hours", e.target.value)}
              rows={3}
              className={fieldClass}
              placeholder={"Mon–Fri 11:00–21:00\nSat–Sun 12:00–22:00"}
            />
            <p className="text-[11px] mt-1" style={{ color: "#ABA6A6" }}>
              Free text — e.g. one line per set of days.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ImageUploadField
          label="Photo"
          hint="JPEG/PNG/WebP up to 5 MB — shown on your restaurant page."
          value={form.imageUrl}
          onChange={(url) => set("imageUrl", url)}
          onError={setError}
        />
        <ImageUploadField
          label="Logo"
          hint="Square works best."
          value={form.logoUrl}
          onChange={(url) => set("logoUrl", url)}
          onError={setError}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" loading={saving}>
          Save profile
        </Button>
        {saved && (
          <span className="text-sm text-success" role="status">
            Saved ✓
          </span>
        )}
      </div>
    </form>
  );
}
