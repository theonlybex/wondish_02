"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CouponRedeem() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; type?: string } | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/coupon/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResult({ success: false, message: data.error });
      } else {
        setResult({ success: true, message: data.message, type: data.type });
        setCode("");
        // ADMIN coupon → refresh to reflect new role
        if (data.type !== "PREMIUM") {
          setTimeout(() => router.refresh(), 1200);
        }
        // PREMIUM coupon → user clicks the button shown in the success state
      }
    } catch {
      setResult({ success: false, message: "Something went wrong. Try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#F8F7FA] border border-[#E8E7EA] rounded-2xl p-6">
      <h3 className="text-[#25293C] font-semibold text-base mb-1">Redeem a coupon</h3>
      <p className="text-[#8A8D93] text-sm mb-4">
        Have a coupon code? Enter it below to unlock access.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ENTER CODE"
          className="flex-1 bg-white border border-[#E8E7EA] rounded-xl px-4 py-2.5 text-sm font-mono text-[#25293C] placeholder:text-[#C0C0C4] focus:outline-none focus:border-primary/50 uppercase tracking-widest"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? "Checking…" : "Redeem"}
        </button>
      </form>

      {result && (
        <div className="mt-3">
          <p className={`text-sm font-medium ${result.success ? "text-emerald-600" : "text-red-500"}`}>
            {result.success ? "✓" : "✗"} {result.message}
          </p>
          {result.success && result.type === "PREMIUM" && (
            <a
              href="/taste"
              className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              🍽 Set up your taste profile →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
