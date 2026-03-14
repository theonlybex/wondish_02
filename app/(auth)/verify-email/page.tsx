"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";

type Status = "loading" | "verified" | "expired" | "invalid";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    fetch(`/api/auth/verify-email?token=${token}`)
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.status);
        if (d.email) setEmail(d.email);
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleResend = async () => {
    if (!email) return;
    setResendLoading(true);
    await fetch("/api/auth/verify-email/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setResendLoading(false);
    setResendDone(true);
  };

  const content = {
    loading: {
      icon: "⏳",
      title: "Verifying…",
      body: "Please wait while we verify your email.",
    },
    verified: {
      icon: "✅",
      title: "Email verified!",
      body: "Your email has been confirmed. You can now sign in.",
    },
    expired: {
      icon: "⏰",
      title: "Link expired",
      body: "This verification link has expired.",
    },
    invalid: {
      icon: "❌",
      title: "Invalid link",
      body: "This verification link is not valid.",
    },
  }[status];

  return (
    <div className="w-full max-w-md">
      <div className="bg-navy-surface rounded-3xl p-8 border border-white/[0.06] text-center">
        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">{content.icon}</span>
        </div>
        <h1 className="text-white font-bold text-2xl mb-2">{content.title}</h1>
        <p className="text-white/50 text-sm mb-6">{content.body}</p>

        {status === "verified" && (
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-semibold text-sm transition-all w-full"
          >
            Sign in
          </Link>
        )}

        {status === "expired" && (
          <>
            {resendDone ? (
              <p className="text-success text-sm">New verification email sent!</p>
            ) : (
              <Button loading={resendLoading} onClick={handleResend} className="w-full">
                Resend verification email
              </Button>
            )}
          </>
        )}

        <div className="mt-4">
          <Link href="/login" className="text-primary text-sm font-medium hover:underline">
            ← Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="text-white/50 text-sm">Loading…</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
