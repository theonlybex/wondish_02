import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

// Phase 6a M2 — the restaurant portal shell (design §5). Deliberately NOT
// the consumer dashboard chrome: no sidebar, no premium gating, no
// onboarding gate — restaurant staff are not patients. Per-restaurant
// membership is enforced by each page/API, not here.
export default async function RestaurantPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  return (
    <div className="min-h-dvh bg-[#F9F7ED]">
      <header className="bg-white border-b border-[#EAE4CA]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/restaurant" className="flex items-center gap-3">
            <BrandLogo />
            <span className="text-[10px] tracking-[0.24em] uppercase font-mono text-primary mt-0.5">
              For Restaurants
            </span>
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
