import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/queries";
import { isProfileComplete } from "@/lib/onboarding";
import { resolveOnboardingRedirect } from "@/lib/onboarding-gate";
import { getOrCreateAccount, AccountClaimConflictError } from "@/lib/auth";
import { planBadgeFor } from "@/lib/plan-badge";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import MobileNav from "@/components/dashboard/MobileNav";
import PastDueBanner from "@/components/billing/PastDueBanner";
import CouponEndingBanner from "@/components/billing/CouponEndingBanner";
import { couponEndingSoon } from "@/lib/coupon";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  // First visit after sign-up: no Account row exists yet (it used to be created
  // later by a client /api/me call), so this render saw null — blank greeting,
  // empty name fields in onboarding. Create it here, server-side, then read it
  // back with roles. A claim conflict leaves `account` null exactly as before.
  let account = await getAccount(userId);
  if (!account) {
    try {
      await getOrCreateAccount(userId);
      account = await getAccount(userId);
    } catch (err) {
      if (!(err instanceof AccountClaimConflictError)) throw err;
    }
  }
  const pathname = (await headers()).get("x-pathname") ?? "";

  const isAdmin = account?.roles?.some((r) => r.role.name === "SUPER") ?? false;
  const isRestaurantStaff =
    account?.roles?.some((r) => r.role.name === RESTAURANT_ADMIN_ROLE) ?? false;
  // Header pill: ADMIN / PREMIUM (shown as "Plus") / BETA / FREE. Derived from
  // tierFor (lib/ai-budget) so a coupon-only tester sees "Beta", not the paid
  // badge — their allowances are half of Plus's (2026-09-17 QA: a tester read
  // "Premium" in the header and then hit a 429 at 3 new weeks instead of 5).
  const plan = planBadgeFor(account?.subscriptions ?? [], isAdmin);
  // "Beta access ends soon" banner: last 7 days of a coupon grant with no paid row.
  const couponEndsAt = couponEndingSoon(account?.subscriptions ?? [], new Date());

  // "Trials" nav item only for users with a condition that has trigger rules
  // or a trial on record — a user without a condition never sees it.
  const trialsProbe = account
    ? await prisma.patient.findUnique({
        where: { accountId: account.id },
        select: {
          _count: { select: { triggerTrials: true } },
          healthConditions: { select: { condition: { select: { _count: { select: { triggerRules: true } } } } } },
        },
      })
    : null;
  const showTrials =
    (trialsProbe?.healthConditions.some((hc) => hc.condition._count.triggerRules > 0) ?? false) ||
    (trialsProbe?._count.triggerTrials ?? 0) > 0;

  // ── Onboarding gate (single source of truth) ───────────────────────────────
  // The profile data itself decides whether onboarding is done; account.onboarding-
  // Complete is only a cache. If the cache is stale (e.g. accounts predating the
  // flag) we heal it from the real profile fields instead of trapping the user.
  // /profile is exempt so users can actually finish onboarding.
  if (!pathname.startsWith("/profile")) {
    let onboarded = account?.onboardingComplete ?? false;
    let hasPatientRow = false;
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
      hasPatientRow = p !== null;
      if (isProfileComplete(p)) {
        await prisma.account.update({
          where: { id: account.id },
          data: { onboardingComplete: true },
        });
        onboarded = true;
      }
    }
    // Portal-only staff go to their portal (never trapped in patient
    // onboarding); staff who have STARTED a patient profile finish it instead
    // — bouncing them to the portal stranded them, since the portal shows no
    // back link for an account that is not yet an onboarded patient.
    // Invited-but-not-yet-staff accounts are not staff, so they are unaffected
    // and see the claim banner on the onboarding page.
    const target = resolveOnboardingRedirect({ onboarded, isRestaurantStaff, hasPatientRow });
    if (target) redirect(target);
  }

  // Onboarding: route users through the ingredient taste screen until it's done.
  // Ingredient-taste is part of onboarding for EVERYONE, not just premium
  // (the basket is the base of every plan). Admins still skip it.
  // Cookie-gated: once taste_complete=1 is set we skip the DB query entirely on every navigation.
  if (!isAdmin && account) {
    const tasteDone = cookies().get("taste_complete")?.value === "1";

    if (!tasteDone) {
      // Skip taste redirect when user is on /profile — they need to finish onboarding first.
      // Redirecting to /taste from here would fight the onboarding guard and loop.
      if (pathname && pathname !== "/taste" && !pathname.startsWith("/profile") && !pathname.startsWith("/billing/success")) {
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
        <DashboardSidebar isAdmin={isAdmin} isRestaurantStaff={isRestaurantStaff} showTrials={showTrials} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        <MobileNav
          email={account?.email ?? ""}
          name={account ? `${account.firstName} ${account.lastName}` : ""}
          plan={plan}
          isAdmin={isAdmin}
          isRestaurantStaff={isRestaurantStaff}
          showTrials={showTrials}
          isNew={Boolean(account && Date.now() - new Date(account.createdAt).getTime() < 24 * 60 * 60 * 1000)}
        />
        {account?.subscriptions?.some((s) => s.source === "STRIPE" && s.status === "PAST_DUE") && <PastDueBanner />}
        {couponEndsAt && <CouponEndingBanner endsAt={couponEndsAt} />}
        {/* PREMIUM GATE (parked 2026-09-17). Signing in now gets you the whole
            app; what free users run into is a per-feature allowance enforced
            server-side by guardAiSpend (lib/ai-budget.ts). To restore, re-add
            the two imports at the top and swap the <main> body back to:
              {premiumGatesEnabled() ? (
                <PremiumGuard isPremium={plan === "PREMIUM" || plan === "BETA"} isAdmin={isAdmin}>{children}</PremiumGuard>
              ) : (
                children
              )}
            The CouponEndingBanner above was also gated on premiumGatesEnabled();
            it now shows whenever a coupon is ending, since losing the coupon
            drops a tester from beta limits to free ones either way. */}
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
