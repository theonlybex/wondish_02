import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import { isProfileComplete } from "@/lib/onboarding";
import { accountHasActivePremium } from "@/lib/auth";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PremiumGuard from "@/components/PremiumGuard";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await getAccount(userId);
  const pathname = (await headers()).get("x-pathname") ?? "";

  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isRestaurantStaff =
    account?.roles?.some((r) => r.role.name === RESTAURANT_ADMIN_ROLE) ?? false;
  const isPremium = accountHasActivePremium(account?.subscriptions ?? []);

  // ── Onboarding gate (single source of truth) ───────────────────────────────
  // The profile data itself decides whether onboarding is done; account.onboarding-
  // Complete is only a cache. If the cache is stale (e.g. accounts predating the
  // flag) we heal it from the real profile fields instead of trapping the user.
  // /profile is exempt so users can actually finish onboarding.
  if (!pathname.startsWith("/profile")) {
    let onboarded = account?.onboardingComplete ?? false;
    if (!onboarded && account) {
      const p = await prisma.patient.findUnique({
        where: { accountId: account.id },
        select: {
          birthday: true,
          height: true,
          heightFt: true,
          heightIn: true,
          weight: true,
          physicalActivityId: true,
        },
      });
      if (isProfileComplete(p)) {
        await prisma.account.update({
          where: { id: account.id },
          data: { onboardingComplete: true },
        });
        onboarded = true;
      }
    }
    if (!onboarded) {
      // Restaurant staff are not patients (Phase 6a design §5): an account
      // that exists to manage a restaurant must never be trapped in patient
      // onboarding or premium. Portal-only accounts land here after sign-in
      // (/login falls back to /overview) — route them to their portal.
      // Invited-but-not-yet-staff accounts are NOT redirected (they may be
      // patients who happen to hold a stray invite); they see the claim
      // banner on the onboarding page instead.
      if (isRestaurantStaff) redirect("/restaurant");
      redirect("/profile?onboarding=true");
    }
  }

  // New-premium onboarding: redirect to Dish Tinder only if user hasn't seen taste setup yet.
  // Cookie-gated: once taste_complete=1 is set we skip the DB query entirely on every navigation.
  if (isPremium && !isAdmin && account) {
    const tasteDone = cookies().get("taste_complete")?.value === "1";

    if (!tasteDone) {
      // Skip taste redirect when user is on /profile — they need to finish onboarding first.
      // Redirecting to /taste from here would fight the onboarding guard and loop.
      if (pathname && pathname !== "/taste" && !pathname.startsWith("/profile")) {
        const patient = await prisma.patient.findUnique({
          where: { accountId: account.id },
          select: { tasteCompleted: true },
        });
        if (!patient?.tasteCompleted) {
          redirect("/taste");
        }
        // tasteCompleted=true but no cookie yet (existing user pre-dating this change).
        // Bounce through the cookie-setter once so future navigations skip this DB call.
        redirect(`/api/taste/set-cookie?next=${encodeURIComponent(pathname)}`);
      }
    }
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <div className="hidden lg:block">
        <DashboardSidebar isAdmin={isAdmin} isRestaurantStaff={isRestaurantStaff} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <DashboardHeader
          email={account?.email ?? ""}
          name={account ? `${account.firstName} ${account.lastName}` : ""}
          plan={isAdmin ? "ADMIN" : isPremium ? "PREMIUM" : "FREE"}
        />
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">
          <PremiumGuard isPremium={isPremium} isAdmin={isAdmin}>
            {children}
          </PremiumGuard>
        </main>
      </div>
    </div>
  );
}
