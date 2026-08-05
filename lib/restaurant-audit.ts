// Phase 6a M1 — audit trail for restaurant-scoped writes
// (docs/restaurants/phase-6a-restaurant-admin-design.md §5.7). Thin by
// design: callers pass the tx client so the audit row commits atomically
// with the change it describes.
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export interface RestaurantAuditInput {
  restaurantId: string;
  accountId: string;
  entity: "restaurant" | "dish" | "ingredients" | "staff" | "invite";
  entityId?: string | null;
  action: string;
  diff?: Prisma.InputJsonValue;
}

export async function auditRestaurantChange(db: Db, input: RestaurantAuditInput): Promise<void> {
  await db.restaurantAuditLog.create({
    data: {
      restaurantId: input.restaurantId,
      accountId: input.accountId,
      entity: input.entity,
      entityId: input.entityId ?? null,
      action: input.action,
      diff: input.diff,
    },
  });
}
