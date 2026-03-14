"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reset failed");

      router.push("/login?reset=true");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-navy-surface rounded-3xl p-8 border border-white/[0.06] text-center">
          <span className="text-5xl">❌</span>
          <h1 className="text-white font-bold text-2xl mt-4 mb-2">Invalid link</h1>
          <p className="text-white/50 text-sm mb-6">
            This password reset link is missing a token.
          </p>
          <Link href="/forgot-password" className="text-primary text-sm font-medium hover:underline">
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-navy-surface rounded-3xl p-8 border border-white/[0.06]">
        <h1 className="text-white font-bold text-2xl mb-1">Reset password</h1>
        <p className="text-white/50 text-sm mb-8">Enter your new password below.</p>

        {error && (
          <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-white/70 text-sm font-medium block mb-1.5">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              placeholder="Min. 8 characters"
            />
          </div>

          <div>
            <label className="text-white/70 text-sm font-medium block mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              placeholder="Repeat password"
            />
          </div>

          <Button type="submit" size="lg" loading={loading} className="w-full">
            Reset Password
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-white/50 text-sm">Loading…</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
