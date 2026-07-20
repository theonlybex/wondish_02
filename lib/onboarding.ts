/**
 * Shared onboarding-completeness logic.
 *
 * Both `Account.onboardingComplete` and `Patient.profileCompleted` are
 * `@default(false)` columns that were added after real accounts already
 * existed, and neither was backfilled. So for any account created before those
 * flags shipped, the flags read `false` even though the user has a fully
 * completed profile — which traps them in the onboarding redirect.
 *
 * To decide whether onboarding is genuinely done we therefore look at the real
 * core fields the caloric engine needs, not the (possibly stale) flags. This
 * mirrors the `isProfileComplete` check in app/api/patient/profile/route.ts.
 */

export type ProfileCompletionInput =
  | {
      birthday?: Date | string | null;
      height?: number | null;
      heightFt?: number | null;
      heightIn?: number | null;
      weight?: number | null;
      physicalActivityId?: string | null;
    }
  | null
  | undefined;

export function isProfileComplete(patient: ProfileCompletionInput): boolean {
  if (!patient) return false;
  const pos = (n: number | null | undefined): boolean =>
    n != null && Number.isFinite(n) && n > 0;
  const nonNeg = (n: number | null | undefined): boolean =>
    n != null && Number.isFinite(n) && n >= 0;
  const hasHeight = pos(patient.height) || (pos(patient.heightFt) && nonNeg(patient.heightIn));
  const validBirthday =
    patient.birthday instanceof Date
      ? !Number.isNaN(patient.birthday.getTime())
      : Boolean(patient.birthday);
  return Boolean(validBirthday && hasHeight && pos(patient.weight) && patient.physicalActivityId);
}
