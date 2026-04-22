"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  const t = useTranslations("forgotPassword");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Request failed");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-navy-surface rounded-3xl p-8 border border-white/[0.06] text-center">
          <div className="w-16 h-16 bg-success/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">📧</span>
          </div>
          <h1 className="text-white font-bold text-2xl mb-2">{t("successTitle")}</h1>
          <p className="text-white/50 text-sm mb-6">
            {t("successSubtitle", { email })}
          </p>
          <Link href="/login" className="text-primary text-sm font-medium hover:underline">
            {t("backToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-navy-surface rounded-3xl p-8 border border-white/[0.06]">
        <h1 className="text-white font-bold text-2xl mb-1">{t("title")}</h1>
        <p className="text-white/50 text-sm mb-8">{t("subtitle")}</p>

        {error && (
          <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-white/70 text-sm font-medium block mb-1.5">{t("emailLabel")}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white text-sm placeholder:text-white/30 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              placeholder={t("emailPlaceholder")}
            />
          </div>
          <Button type="submit" size="lg" loading={loading} className="w-full">
            {t("submit")}
          </Button>
        </form>

        <p className="text-center text-white/40 text-sm mt-6">
          {t("rememberedIt")}{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
