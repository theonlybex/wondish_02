// Phase 6a §5.1 — where "back" goes from inside a restaurant.
//
// /restaurant is not a safe universal target: it redirects an account with
// exactly one membership straight into that restaurant, so a "← Your
// restaurants" link renders a dead control for the common case — the page
// never changes and every click leaves another browser-history entry behind.
// This picks a destination that actually renders for the caller, or nothing.

export interface PortalBackLink {
  href: string;
  label: string;
}

export function portalBackLink(args: {
  membershipCount: number;
  isSuper: boolean;
  /// Onboarded patient: /overview renders for them. A staff account that has
  /// never completed patient onboarding is bounced by the dashboard gate
  /// back to /restaurant, so it must never be offered as "back".
  onboardedPatient: boolean;
}): PortalBackLink | null {
  // Only a real switcher — two or more restaurants — makes /restaurant render.
  if (args.membershipCount > 1) return { href: "/restaurant", label: "Your restaurants" };

  // Ops browsing someone else's restaurant came from the admin list; the staff
  // switcher would just tell them they have no restaurant access.
  if (args.isSuper) return { href: "/admin/restaurants", label: "Admin restaurants" };

  if (args.onboardedPatient) return { href: "/overview", label: "Wondish dashboard" };

  // Portal-only staff with a single restaurant: this IS their home. Better no
  // control than one that appears to do nothing.
  return null;
}
