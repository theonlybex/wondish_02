import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — "verify your menu" (design §7 freshness). Staff confirm the
// live menu is still accurate; stamps lastVerifiedAt on every live dish.
// Ingredient corrections still go through the dish editor + review — this
// only asserts "nothing changed".
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const stamped = await tx.restaurantDish.updateMany({
        where: { restaurantId: params.id, status: "PUBLISHED", deletedAt: null },
        data: { lastVerifiedAt: now },
      });
      if (stamped.count > 0) {
        await auditRestaurantChange(tx, {
          restaurantId: params.id,
          accountId: ctx.account.id,
          entity: "restaurant",
          entityId: params.id,
          action: "verify",
          diff: { dishes: stamped.count },
        });
      }
      return stamped;
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "No live dishes to verify" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, dishes: result.count, verifiedAt: now.toISOString() });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
