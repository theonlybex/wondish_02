// Phase 6a M4 — shared server-component gate for /restaurant/[id]/* pages.
// Mirrors requireRestaurantStaff's decision (SUPER bypasses; otherwise a
// RestaurantStaff row for this restaurant) but returns a redirect target
// instead of throwing, which is what pages need.
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export interface PortalPageContext {
  accountId: string;
  membership: { id: string; role: "OWNER" | "MANAGER" } | null; // null = SUPER bypass
  isSuper: boolean;
  /// Memberships across ALL restaurants, not just this one — the portal's
  /// back link needs it, because /restaurant only renders a switcher at 2+.
  membershipCount: number;
  /// Cached onboarding flag. The dashboard layout heals a stale `false` on
  /// its next visit; here a stale `false` only costs a hidden back link,
  /// which is the safe direction to be wrong in (never link into a bounce).
  onboardedPatient: boolean;
}

export type PortalPageGate =
  | { allowed: false; redirectTo: string }
  | { allowed: true; ctx: PortalPageContext };

/// Wrapped in React `cache` so the layout's gate and the page's own guard
/// share ONE account lookup per request instead of issuing the same query
/// twice. Defense in depth costs nothing when it's deduplicated.
export const getPortalPageContext = cache(async function getPortalPageContext(
  restaurantId: string
): Promise<PortalPageGate> {
  const { userId } = await auth();
  if (!userId) return { allowed: false, redirectTo: "/login" };

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: {
      roles: { include: { role: true } },
      restaurantStaff: { where: { restaurantId } },
      // Unfiltered — `restaurantStaff` above is scoped to this restaurant.
      _count: { select: { restaurantStaff: true } },
    },
  });
  const isSuper = account?.roles.some((r) => r.role.name === "SUPER") ?? false;
  const membership = account?.restaurantStaff[0] ?? null;
  if (!account || (!membership && !isSuper)) return { allowed: false, redirectTo: "/restaurant" };

  return {
    allowed: true,
    ctx: {
      accountId: account.id,
      membership: membership ? { id: membership.id, role: membership.role } : null,
      isSuper,
      membershipCount: account._count.restaurantStaff,
      onboardedPatient: account.onboardingComplete,
    },
  };
});
