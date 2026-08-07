"use client";

// Phase 6a M4 — activity feed client (design §5.7): first page is
// server-rendered; "Show more" walks the cursor.

import { useState } from "react";
import Button from "@/components/ui/Button";

export interface ActivityEntry {
  id: string;
  actor: string;
  line: string;
  createdAt: string;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PortalActivityFeed({
  restaurantId,
  initialEntries,
  initialCursor,
}: {
  restaurantId: string;
  initialEntries: ActivityEntry[];
  initialCursor: string | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/restaurant-portal/${restaurantId}/activity?cursor=${encodeURIComponent(cursor)}`
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not load more activity.");
        return;
      }
      setEntries((prev) => [...prev, ...(body.entries ?? [])]);
      setCursor(body.nextCursor ?? null);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };

  if (entries.length === 0) {
    return (
      <div className="bg-white border border-[#EAE4CA] rounded-2xl p-8 text-center">
        <p className="font-semibold text-[#1E1A1A] mb-1">No activity yet</p>
        <p className="text-sm" style={{ color: "#848181" }}>
          Menu and profile changes made by your team (and Wondish review decisions) appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div role="alert" className="bg-error/10 border border-error/20 rounded-xl px-4 py-3 mb-4 text-sm text-error">
          {error}
        </div>
      )}
      <div className="bg-white border border-[#EAE4CA] rounded-2xl divide-y divide-[#F5F1DD]">
        {entries.map((e) => (
          <div key={e.id} className="px-5 py-3">
            <p className="text-sm text-[#1E1A1A] leading-relaxed">
              <span className="font-semibold">{e.actor}</span> {e.line}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#ABA6A6" }}>
              {formatWhen(e.createdAt)}
            </p>
          </div>
        ))}
      </div>
      {cursor && (
        <div className="mt-4 text-center">
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void loadMore()}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
