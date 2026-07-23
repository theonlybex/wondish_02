import { hasActivePremium, accountHasActivePremium } from "@/lib/auth";
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
  isPremium: boolean;
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
  const active = subs.find(hasActivePremium) ?? subs[0] ?? null;
  return {
    id: account.id,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    photoUrl: account.photoUrl,
    onboardingComplete: patient ? isProfileComplete(patient) : false,
    isPremium: accountHasActivePremium(subs),
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
