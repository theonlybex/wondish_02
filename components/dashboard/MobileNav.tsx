"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

// Header + the phone navigation drawer. The header's hamburger existed but
// nothing was wired to it and the sidebar is desktop-only, so on a phone the
// dashboard had no navigation at all. Below lg the sidebar slides in over the
// page; it closes on navigation, backdrop tap, or Escape.
export default function MobileNav({
  email,
  name,
  plan,
  isAdmin,
  isRestaurantStaff,
}: {
  email: string;
  name: string;
  plan: "ADMIN" | "PREMIUM" | "FREE";
  isAdmin: boolean;
  isRestaurantStaff: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close when the route changes (a link in the drawer was tapped).
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <DashboardHeader email={email} name={name} plan={plan} onMenuToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[85vw] shadow-2xl" style={{ animation: "mn-slide 0.22s ease-out both" }}>
            <DashboardSidebar isAdmin={isAdmin} isRestaurantStaff={isRestaurantStaff} />
          </div>
          <style>{`
            @keyframes mn-slide { from { transform: translateX(-100%); } to { transform: translateX(0); } }
            @media (prefers-reduced-motion: reduce) { [style*="mn-slide"] { animation: none !important; } }
          `}</style>
        </div>
      )}
    </>
  );
}
