"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

// Sign out lives on /profile now that the header's Settings dropdown is a
// plain Profile link (2026-10-19). Kept apart from the Danger zone below it.
export default function SignOutSection() {
  const t = useTranslations("dashboardHeader");
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="mt-12 flex items-center justify-between gap-4 rounded-2xl border border-[#EAE4CA] bg-white p-6">
      <p className="text-sm text-[#4A4E5C]">Signed in on this device.</p>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          signOut({ redirectUrl: "/" });
        }}
        className="inline-flex items-center min-h-[44px] px-4 py-2.5 rounded-xl border border-[#EAE4CA] text-[#1E1A1A] text-sm font-semibold hover:bg-[#F8F7FA] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {t("signOut")}
      </button>
    </div>
  );
}
