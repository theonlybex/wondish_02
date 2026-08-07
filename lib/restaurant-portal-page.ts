// Phase 6a M4 — shared server-component gate for /restaurant/[id]/* pages.
// Mirrors requireRestaurantStaff's decision (SUPER bypasses; otherwise a
// RestaurantStaff row for this restaurant) but returns a redirect target
// instead of throwing, which is what pages need.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export interface PortalPageContext {
  accountId: string;
  membership: { id: string; role: "OWNER" | "MANAGER" } | null; // null = SUPER bypass
  isSuper: boolean;
}

export type PortalPageGate =
  | { allowed: false; redirectTo: string }
  | { allowed: true; ctx: PortalPageContext };

export async function getPortalPageContext(restaurantId: string): Promise<PortalPageGate> {
  const { userId } = await auth();
  if (!userId) return { allowed: false, redirectTo: "/login" };

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: {
      roles: { include: { role: true } },
      restaurantStaff: { where: { restaurantId } },
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
    },
  };
}
