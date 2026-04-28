"use client";

import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <div className="flex items-center justify-center w-full">
      <SignUp
        signInUrl="/login"
        forceRedirectUrl="/profile?onboarding=true"
        appearance={{
          elements: {
            rootBox: "w-full max-w-md",
            card: "bg-navy-surface border border-white/[0.08] shadow-2xl rounded-2xl",
            headerTitle: "text-white",
            headerSubtitle: "text-white/50",
            socialButtonsBlockButton: "border-white/10 text-white hover:bg-white/[0.06]",
            dividerLine: "bg-white/10",
            dividerText: "text-white/30",
            formFieldLabel: "text-white/60",
            formFieldInput: "bg-white/[0.05] border-white/10 text-white placeholder:text-white/25 focus:border-primary/50",
            formButtonPrimary: "bg-primary hover:bg-primary-dark shadow-lg shadow-primary/25",
            footerActionLink: "text-primary hover:text-primary-light",
            identityPreviewText: "text-white",
            identityPreviewEditButton: "text-primary",
          },
        }}
      />
    </div>
  );
}
