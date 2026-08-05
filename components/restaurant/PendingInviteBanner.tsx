"use client";

// Phase 6a M2 — claimable invite banner (design §4C): shown on the portal
// entry page for PENDING invites addressed to the signed-in email.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function PendingInviteBanner({
  inviteId,
  restaurantName,
  role,
}: {
  inviteId: string;
  restaurantName: string;
  role: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant-portal/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't accept the invite");
        return;
      }
      router.push(`/restaurant/${body.restaurant.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3 mb-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#1E1A1A]">
          You&apos;ve been invited to manage <span className="font-semibold">{restaurantName}</span>{" "}
          as {role === "OWNER" ? "an owner" : "a manager"}.
        </p>
        <Button size="sm" loading={busy} onClick={accept}>
          Accept
        </Button>
      </div>
      {error && <p className="text-xs text-error mt-2">{error}</p>}
    </div>
  );
}
