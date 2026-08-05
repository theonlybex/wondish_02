import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";

// Phase 6a M1 — remove a staff member. The RESTAURANT_ADMIN role is only
// dropped when this was the account's LAST restaurant (design §4C).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; staffId: string } }
) {
  try {
    const admin = await requireAdmin();

    const staff = await prisma.restaurantStaff.findFirst({
      where: { id: params.staffId, restaurantId: params.id },
    });
    if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      await tx.restaurantStaff.delete({ where: { id: staff.id } });

      const remaining = await tx.restaurantStaff.count({ where: { accountId: staff.accountId } });
      if (remaining === 0) {
        const role = await tx.role.findUnique({ where: { name: RESTAURANT_ADMIN_ROLE } });
        if (role) {
          await tx.accountRole.deleteMany({
            where: { accountId: staff.accountId, roleId: role.id },
          });
        }
      }

      await auditRestaurantChange(tx, {
        restaurantId: staff.restaurantId,
        accountId: admin.id,
        entity: "staff",
        entityId: staff.id,
        action: "remove",
        diff: { removedAccountId: staff.accountId, role: staff.role },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
