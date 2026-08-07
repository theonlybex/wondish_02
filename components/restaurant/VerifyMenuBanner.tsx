"use client";

// Phase 6a M4 — the quarterly freshness nudge (design §7). Shown when the
// menu's newest verification is stale (or missing) while dishes are live.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function VerifyMenuBanner({
  restaurantId,
  lastVerified,
}: {
  restaurantId: string;
  lastVerified: string | null; // ISO — null = never
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurant-portal/${restaurantId}/verify-menu`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not verify the menu.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 min-w-[240px] text-sm text-amber-800 leading-relaxed">
          {lastVerified
            ? `Your menu was last verified ${new Date(lastVerified).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. `
            : "Your live menu has never been verified. "}
          Still accurate? Confirm it — diners rely on your ingredient lists for allergy safety. If
          something changed, update the dish instead.
        </p>
        <Button size="sm" loading={busy} onClick={() => void verify()}>
          Everything is current
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-error mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
