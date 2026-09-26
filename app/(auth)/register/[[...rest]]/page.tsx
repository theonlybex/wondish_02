"use client";

import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <div className="flex items-center justify-center w-full">
      <SignUp
        signInUrl="/login"
        // Phase 3: every sign-up lands on /r/claim, which redeems a QR
        // referral cookie when present and otherwise forwards to onboarding.
        forceRedirectUrl="/r/claim"
        appearance={{
          elements: {
            rootBox: "w-full max-w-md",
            card: "bg-navy-surface border border-white/[0.08] shadow-2xl rounded-2xl",
            headerTitle: "text-white",
            headerSubtitle: "text-white/50",
            // 44px on a finger: Clerk's defaults measured 32px (production
            // sweep, 2026-09-26) — the first thing a new tester touches.
            socialButtonsBlockButton: "border-white/10 text-white hover:bg-white/[0.06] [@media(pointer:coarse)]:min-h-11",
            dividerLine: "bg-white/10",
            dividerText: "text-white/30",
            formFieldLabel: "text-white/60",
            formFieldInput: "bg-white/[0.05] border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 [@media(pointer:coarse)]:min-h-11",
            formFieldInputShowPasswordButton: "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
            formButtonPrimary: "bg-primary hover:bg-primary-dark shadow-lg shadow-primary/25 [@media(pointer:coarse)]:min-h-11",
            footerActionLink: "text-primary hover:text-primary-light",
            identityPreviewText: "text-white",
            identityPreviewEditButton: "text-primary",
          },
        }}
      />
    </div>
  );
}
