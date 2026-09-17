"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignIn, useAuth } from "@clerk/nextjs";
import { checkoutReturnPath } from "@/lib/checkout-return";

// Shown in place of the sign-in form while Clerk loads on a Stripe Checkout
// return (see lib/checkout-return.ts for why that hop lands here). Purely
// visual: no data, no auth decision. If Clerk loads and there is no session,
// the ordinary form takes over below.
function ConfirmingPayment() {
  return (
    <div className="w-full max-w-md text-center text-white" role="status" aria-live="polite">
      <div className="w-10 h-10 mx-auto mb-4 rounded-full border-4 border-white/20 border-t-primary animate-spin" aria-hidden="true" />
      <p className="font-semibold">Confirming your payment…</p>
      <p className="text-sm mt-1 text-white/50">Taking you back to Wondish.</p>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  // Read on the client after mount (no useSearchParams → no Suspense
  // boundary requirement at build time). Until the effect runs this is null
  // and Clerk's <SignIn> renders nothing server-side anyway.
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    setReturnTo(checkoutReturnPath(window.location.search));
  }, []);

  // Clerk found the session client-side (the cookies it needs are first-party
  // here): go straight back to the confirmation instead of waiting for the
  // sign-in widget to notice and do the same.
  useEffect(() => {
    if (returnTo && isLoaded && isSignedIn) router.replace(returnTo);
  }, [returnTo, isLoaded, isSignedIn, router]);

  if (returnTo && (!isLoaded || isSignedIn)) return <ConfirmingPayment />;

  return (
    <div className="flex items-center justify-center w-full">
      <SignIn
        signUpUrl="/register"
        fallbackRedirectUrl="/overview"
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
