"use client";

// Phase 6a M2 — accepts the invite named in ?inviteId= (design §4). Runs
// once on mount; success routes into the restaurant, failure explains
// (wrong email, expired, revoked) with the entry page as the way out.

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function AcceptInviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("inviteId");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!inviteId) {
      setError("This invite link is missing its invite id — use the link from your email.");
      return;
    }
    (async () => {
      const res = await fetch("/api/restaurant-portal/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't accept this invite.");
        return;
      }
      router.replace(`/restaurant/${body.restaurant.id}`);
    })();
  }, [inviteId, router]);

  return (
    <div className="max-w-md mx-auto text-center py-16">
      {error ? (
        <div className="bg-white border border-[#EAE4CA] rounded-2xl p-8">
          <p className="font-semibold text-[#1E1A1A] mb-2">Couldn&apos;t accept the invite</p>
          <p className="text-sm mb-6" style={{ color: "#848181" }}>{error}</p>
          <Link href="/restaurant" className="text-sm font-semibold text-primary hover:underline">
            Go to your restaurants →
          </Link>
        </div>
      ) : (
        <p className="text-sm" style={{ color: "#848181" }}>Accepting your invite…</p>
      )}
    </div>
  );
}
