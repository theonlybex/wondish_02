"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";

// Web surface for the existing DELETE /api/me (built for iOS — D12/D5.1.1(v)):
// the route cancels Stripe billing first, refuses over live Apple billing,
// deletes the Clerk identity, then cascades the Account row.
export default function DeleteAccountSection() {
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const { signOut } = useClerk();

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  const handleDelete = async () => {
    if (!armed || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      if (!res.ok) {
        let msg = "Something went wrong. Your account was NOT deleted — please try again.";
        try {
          const data = await res.json();
          msg = data.message ?? data.error ?? msg;
        } catch {
          /* keep generic message */
        }
        setError(msg);
        setDeleting(false);
        return;
      }
      // The Clerk identity is gone server-side, but the browser still holds
      // this session — a bare redirect to "/" would let the middleware (which
      // bounces signed-in users into the app) drop us back into onboarding.
      // Clear the client session first, then land on the public landing page.
      await signOut({ redirectUrl: "/" });
    } catch {
      setError("Network error. Your account was NOT deleted — check your connection and try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="mt-12 rounded-2xl border border-error/25 bg-error/[0.03] p-6">
      <h2 className="text-base font-semibold text-error mb-1">Danger zone</h2>
      <p className="text-xs mb-4" style={{ color: "#848181" }}>
        Deleting your account permanently removes your profile, meal plans, journal, and all other
        data, and cancels any active subscription. This cannot be undone.
      </p>

      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-4 py-2.5 rounded-xl border border-error/40 text-error text-sm font-semibold hover:bg-error/10 transition-colors"
        >
          Delete my account…
        </button>
      ) : (
        <div className="space-y-3">
          <label htmlFor="delete-confirm" className="block text-sm font-medium text-[#1E1A1A]">
            Type <span className="font-mono font-bold text-error">DELETE</span> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            className="w-full max-w-xs px-3.5 py-2.5 rounded-xl border border-[#EAE4CA] bg-white text-[#1E1A1A] text-sm outline-none focus:border-error focus:ring-2 focus:ring-error/20 transition-all"
            placeholder="DELETE"
          />
          {error && (
            <div role="alert" className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm max-w-md">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!armed || deleting}
              className="px-4 py-2.5 rounded-xl bg-error text-white text-sm font-semibold hover:bg-error/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setConfirmText("");
                setError("");
              }}
              disabled={deleting}
              className="px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#F5F1DD] transition-colors"
              style={{ color: "#848181" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
