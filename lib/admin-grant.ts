// Granting the SUPER role = admin. Admins have Premium by default (decided
// 2026-09-12): the grant also upserts an ADMIN-source Subscription row with
// plan PREMIUM and no end, so every gate, the billing page and /api/me (iOS)
// treat admins as premium through the one existing entitlement rule
// (accountHasActivePremium ORs across rows) instead of per-route
// `isAdmin ||` bypasses. Stripe/Apple/COUPON rows are never touched.
import type { Prisma, PrismaClient } from "@prisma/client";

export const SUPER_ROLE = "SUPER";

export function adminPremiumUpsertArgs(accountId: string) {
  return {
    where: { accountId_source: { accountId, source: "ADMIN" as const } },
    update: { plan: "PREMIUM" as const, status: "ACTIVE" as const, canceledAt: null, stripeCurrentPeriodEnd: null },
    create: {
      accountId,
      source: "ADMIN" as const,
      plan: "PREMIUM" as const,
      status: "ACTIVE" as const,
      stripeCurrentPeriodEnd: null,
    },
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

// Idempotent: role row, role assignment, ADMIN premium row.
export async function grantSuper(db: Db, accountId: string): Promise<void> {
  const role = await db.role.upsert({
    where: { name: SUPER_ROLE },
    update: {},
    create: { name: SUPER_ROLE },
  });
  await db.accountRole.upsert({
    where: { accountId_roleId: { accountId, roleId: role.id } },
    update: {},
    create: { accountId, roleId: role.id },
  });
  await db.subscription.upsert(adminPremiumUpsertArgs(accountId));
}

// Idempotent: removes the assignment and the ADMIN premium row (other rows stay).
export async function revokeSuper(db: Db, accountId: string): Promise<void> {
  await db.accountRole.deleteMany({ where: { accountId, role: { name: SUPER_ROLE } } });
  await db.subscription.deleteMany({ where: { accountId, source: "ADMIN" } });
}
