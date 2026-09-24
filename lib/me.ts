import { accountHasActivePremium, hasActivePremium, primarySubscriptionRow } from "@/lib/auth";
import { isProfileComplete, type ProfileCompletionInput } from "@/lib/onboarding";

export type MeSubscriptionDTO = {
  plan: string;
  status: string;
  source: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  canceledAt: string | null;
} | null;

export type MeDTO = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  onboardingComplete: boolean;
  /**
   * ENTITLEMENT, not billing: true for anyone with live elevated access,
   * including a beta coupon holder. Read `tier` to tell those apart. A
   * consumer that treats this alone as "paying customer" will greet a beta
   * tester as one — which is exactly how /restaurants came to show a coupon
   * holder a "Plus" badge.
   */
  isPremium: boolean;
  /** What the user should be CALLED. Mirrors lib/plan-badge.ts planBadgeFor. */
  tier: "premium" | "beta" | "free";
  subscription: MeSubscriptionDTO;
};

type SubRow = {
  plan: string;
  status: string;
  source: string;
  stripeCurrentPeriodEnd: Date | null;
  appleExpiresAt?: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
};

// Pure — no Prisma/auth. Shapes the `/api/me` response: identity + the
// derived (not cached) onboarding truth + the single active subscription row
// (if any) across every source. Only these six subscription fields are ever
// exposed — never stripeCustomerId/stripeSubscriptionId/appleOriginalTransactionId
// or any other billing-provider identifier.
export function serializeMe(
  account: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    subscriptions: SubRow[];
  },
  patient: ProfileCompletionInput | null
): MeDTO {
  const subs = account.subscriptions ?? [];
  // Shared with lib/billing/load-view.ts so iOS and the billing page always
  // describe the same row (paid beats coupon; live beats dead; Stripe beats
  // an expired coupon row).
  const active = primarySubscriptionRow(subs);
  return {
    id: account.id,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    photoUrl: account.photoUrl,
    onboardingComplete: patient ? isProfileComplete(patient) : false,
    isPremium: accountHasActivePremium(subs),
    // Same precedence as lib/ai-budget.ts tierFor: a live PAID row of any
    // source outranks a coupon; coupons alone are beta; nothing live is free.
    // (Kept local rather than imported: this module is pure, and ai-budget
    // pulls in Prisma and the rate limiter.)
    tier: (() => {
      if (!accountHasActivePremium(subs)) return "free" as const;
      const live = subs.filter((s) => hasActivePremium(s));
      return live.length > 0 && live.every((s) => s.source === "COUPON") ? ("beta" as const) : ("premium" as const);
    })(),
    subscription: active
      ? {
          plan: active.plan,
          status: active.status,
          source: active.source,
          currentPeriodEnd: (active.stripeCurrentPeriodEnd ?? active.appleExpiresAt ?? null)?.toISOString() ?? null,
          trialEndsAt: active.trialEndsAt?.toISOString() ?? null,
          canceledAt: active.canceledAt?.toISOString() ?? null,
        }
      : null,
  };
}
