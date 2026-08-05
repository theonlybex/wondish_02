// Phase 6a M1 — row-scoped restaurant authorization
// (docs/restaurants/phase-6a-restaurant-admin-design.md §3). Mirrors
// lib/admin.ts's shape: pure helpers up top, one thin Prisma-backed guard,
// errors thrown as "UNAUTHORIZED"/"FORBIDDEN" for adminErrorResponse().
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

/// Portal-gate role name. Granted on invite acceptance; an account can hold
/// it across several restaurants — RestaurantStaff rows decide WHICH.
export const RESTAURANT_ADMIN_ROLE = "RESTAURANT_ADMIN";

export type StaffRole = "OWNER" | "MANAGER";

const STAFF_ROLE_RANK: Record<StaffRole, number> = { MANAGER: 0, OWNER: 1 };

export function staffRoleSatisfies(actual: StaffRole, min: StaffRole): boolean {
  return STAFF_ROLE_RANK[actual] >= STAFF_ROLE_RANK[min];
}

export interface RestaurantStaffContext {
  account: { id: string; email: string };
  /// null when access came through the SUPER bypass (ops acting on any
  /// restaurant) rather than a staff row.
  staff: { id: string; role: StaffRole } | null;
  isSuper: boolean;
}

/// Row-level scoping: the caller must be SUPER, or a RestaurantStaff member
/// of `restaurantId` at `minRole` or above. `restaurantId` must come from
/// the URL path, never the body.
export async function requireRestaurantStaff(
  restaurantId: string,
  minRole: StaffRole = "MANAGER"
): Promise<RestaurantStaffContext> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: {
      roles: { include: { role: true } },
      restaurantStaff: { where: { restaurantId } },
    },
  });
  if (!account) throw new Error("UNAUTHORIZED");

  const isSuper = account.roles.some((r) => r.role.name === "SUPER");
  if (isSuper) {
    return { account: { id: account.id, email: account.email }, staff: null, isSuper: true };
  }

  const staff = account.restaurantStaff[0];
  if (!staff || !staffRoleSatisfies(staff.role, minRole)) throw new Error("FORBIDDEN");

  return {
    account: { id: account.id, email: account.email },
    staff: { id: staff.id, role: staff.role },
    isSuper: false,
  };
}
