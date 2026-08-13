// Phase 2 — cuisine filter chips. Plain links over a searchParam, so the
// directory needs no client JS, every filter state is a shareable URL, and
// back/forward behave the way a browser user expects.
import Link from "next/link";

export default function CuisineFilter({
  cuisines,
  active,
}: {
  cuisines: string[];
  active: string | null;
}) {
  if (cuisines.length === 0) return null;

  const chip = (label: string, href: string, isActive: boolean) => (
    <Link
      key={label}
      href={href}
      aria-current={isActive ? "true" : undefined}
      // min-h-[44px] keeps the tap target at the platform minimum; the chips
      // are the primary way a diner narrows a menu on a phone.
      className={`inline-flex items-center min-h-[44px] px-4 rounded-full text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        isActive
          ? "bg-primary text-white border-primary"
          : "bg-white text-[#5C5757] border-[#EAE4CA] hover:border-primary/40"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label="Filter by cuisine" className="flex flex-wrap gap-2">
      {chip("All", "/restaurants", active === null)}
      {cuisines.map((c) =>
        chip(c, `/restaurants?cuisine=${encodeURIComponent(c)}`, active === c)
      )}
    </nav>
  );
}
