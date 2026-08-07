"use client";

// Phase 6a M4 — section nav for /restaurant/[id]/* (design §5): Dashboard,
// Menu, Profile, Staff (owners), Activity, Preview.

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PortalNav({
  restaurantId,
  showStaff,
}: {
  restaurantId: string;
  showStaff: boolean;
}) {
  const pathname = usePathname();
  const base = `/restaurant/${restaurantId}`;
  const items = [
    { href: base, label: "Dashboard" },
    { href: `${base}/menu`, label: "Menu" },
    { href: `${base}/profile`, label: "Profile" },
    ...(showStaff ? [{ href: `${base}/staff`, label: "Staff" }] : []),
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/preview`, label: "Preview" },
  ];

  return (
    <nav aria-label="Restaurant sections" className="mb-8 border-b border-[#EAE4CA]">
      <div className="flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = item.href === base ? pathname === base : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-[#6E6868] hover:text-[#1E1A1A]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
