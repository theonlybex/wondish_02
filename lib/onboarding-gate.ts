// Where the dashboard gate sends an account that has not finished onboarding.
//
// Two populations are indistinguishable from the Account row alone:
//   - restaurant staff who are NOT patients — a portal-only account must never
//     be trapped in patient onboarding (Phase 6a design §5), and
//   - patients who ALSO manage a restaurant — they still need to finish their
//     profile, and bouncing them to the portal strands them there, because the
//     portal deliberately shows no back link for an account that is not yet an
//     onboarded patient (lib/restaurant-portal-nav.ts).
//
// A Patient row separates them: nothing creates one except the profile form,
// so its existence means this person has started patient onboarding.

export function resolveOnboardingRedirect(args: {
  onboarded: boolean;
  isRestaurantStaff: boolean;
  hasPatientRow: boolean;
}): string | null {
  if (args.onboarded) return null;
  if (args.isRestaurantStaff && !args.hasPatientRow) return "/restaurant";
  return "/profile?onboarding=true";
}
