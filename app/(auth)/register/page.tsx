"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function RegisterForm() {
  const searchParams = useSearchParams();
  const selectedPlan = searchParams.get("plan") ?? "free";

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    agreedTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "First name is required.";
    else if (form.firstName.trim().length < 2) e.firstName = "Min 2 characters.";

    if (!form.lastName.trim()) e.lastName = "Last name is required.";

    if (!form.email.trim()) e.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "Invalid email address.";

    if (!form.password) e.password = "Password is required.";
    else if (form.password.length < 8) e.password = "Min 8 characters.";
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password))
      e.password = "Must include uppercase, lowercase, and a number.";

    if (form.password !== form.confirmPassword)
      e.confirmPassword = "Passwords do not match.";

    if (!form.agreedTerms) e.agreedTerms = "You must accept the terms.";

    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          plan: selectedPlan,
          agreedTerms: form.agreedTerms,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrors({ form: data.error ?? "Registration failed." });
        return;
      }

      if (selectedPlan === "premium" && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        window.location.href = "/dashboard";
      }
    } catch {
      setErrors({ form: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  return (
    <div className="w-full max-w-md">
      {/* Plan badge */}
      {selectedPlan === "premium" && (
        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary text-sm font-medium px-4 py-2 rounded-xl mb-6 justify-center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1l1.5 4h4.5L9.5 8l1.5 4L7 10l-4 2 1.5-4L1 5h4.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Starting Premium — 14-day free trial
        </div>
      )}

      {/* Card */}
      <div className="bg-navy-surface border border-white/[0.08] rounded-2xl p-8 shadow-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Create account</h1>
          <p className="text-white/50 text-sm">
            {selectedPlan === "premium"
              ? "Start your 14-day Premium free trial. No card needed yet."
              : "Join Wondish and start eating smarter."}
          </p>
        </div>

        {errors.form && (
          <div className="bg-error/10 border border-error/20 text-error text-sm rounded-xl px-4 py-3 mb-6">
            {errors.form}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-white/60 text-sm font-medium mb-1.5">
                First name
              </label>
              <input
                type="text"
                autoComplete="given-name"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                placeholder="Alex"
                className={`w-full bg-white/[0.05] border ${errors.firstName ? "border-error/50" : "border-white/10"} rounded-xl px-4 py-3 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all`}
              />
              {errors.firstName && (
                <p className="text-error text-xs mt-1">{errors.firstName}</p>
              )}
            </div>
            <div>
              <label className="block text-white/60 text-sm font-medium mb-1.5">
                Last name
              </label>
              <input
                type="text"
                autoComplete="family-name"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                placeholder="Smith"
                className={`w-full bg-white/[0.05] border ${errors.lastName ? "border-error/50" : "border-white/10"} rounded-xl px-4 py-3 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all`}
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-white/60 text-sm font-medium mb-1.5">
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="you@example.com"
              className={`w-full bg-white/[0.05] border ${errors.email ? "border-error/50" : "border-white/10"} rounded-xl px-4 py-3 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all`}
            />
            {errors.email && (
              <p className="text-error text-xs mt-1">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-white/60 text-sm font-medium mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="Min. 8 characters"
                className={`w-full bg-white/[0.05] border ${errors.password ? "border-error/50" : "border-white/10"} rounded-xl px-4 py-3 pr-11 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 9s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            </div>
            {errors.password && (
              <p className="text-error text-xs mt-1">{errors.password}</p>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-white/60 text-sm font-medium mb-1.5">
              Confirm password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => set("confirmPassword", e.target.value)}
              placeholder="••••••••"
              className={`w-full bg-white/[0.05] border ${errors.confirmPassword ? "border-error/50" : "border-white/10"} rounded-xl px-4 py-3 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all`}
            />
            {errors.confirmPassword && (
              <p className="text-error text-xs mt-1">{errors.confirmPassword}</p>
            )}
          </div>

          {/* Terms */}
          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={form.agreedTerms}
                  onChange={(e) => set("agreedTerms", e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                    form.agreedTerms
                      ? "bg-primary border-primary"
                      : "bg-transparent border-white/20"
                  }`}
                >
                  {form.agreedTerms && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-white/40 text-xs leading-relaxed">
                I agree to the{" "}
                <Link href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-primary hover:underline">
                  Privacy Policy
                </Link>
              </span>
            </label>
            {errors.agreedTerms && (
              <p className="text-error text-xs mt-1">{errors.agreedTerms}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold text-sm transition-all duration-150 shadow-lg shadow-primary/25 mt-2"
          >
            {loading
              ? "Creating account…"
              : selectedPlan === "premium"
              ? "Start free trial"
              : "Create account"}
          </button>
        </form>

        <p className="text-center text-white/40 text-sm mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:text-primary-light transition-colors font-medium">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="text-white/50 text-sm">Loading…</div>}>
      <RegisterForm />
    </Suspense>
  );
}
