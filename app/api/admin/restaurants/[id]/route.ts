import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse, pickFields } from "@/lib/admin";
import { isRestaurantStatus, RESTAURANT_MUTABLE_FIELDS } from "@/lib/admin-restaurants";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import { orphanedStaffAccountIds } from "@/lib/restaurant-staff-cleanup";

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// PATCH — any schema field, including status transitions. Restaurants
// themselves have no publish gate (unlike RestaurantDish).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();

    const body = await req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "request body must be a JSON object" }, { status: 400 });
    }

    const { status, slug, ...rest } = body as Record<string, unknown>;

    if (status !== undefined && !isRestaurantStatus(status)) {
      return NextResponse.json({ error: "status must be one of DRAFT, PUBLISHED, ARCHIVED" }, { status: 400 });
    }
    if (slug !== undefined && (typeof slug !== "string" || slug.trim().length === 0)) {
      return NextResponse.json({ error: "slug must be a non-empty string" }, { status: 400 });
    }

    const restaurant = await prisma.restaurant.update({
      where: { id: params.id },
      data: {
        ...pickFields(rest, RESTAURANT_MUTABLE_FIELDS),
        ...(status !== undefined && { status }),
        ...(slug !== undefined && { slug: (slug as string).trim() }),
      },
      include: { ethnic: true, _count: { select: { dishes: true } } },
    });

    return NextResponse.json(restaurant);
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      return NextResponse.json({ error: "A restaurant with that slug already exists" }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();

    // Staff rows die with the restaurant (onDelete: Cascade), which skips
    // removeStaffMember's last-restaurant role cleanup — without this, an
    // account whose only restaurant was deleted keeps RESTAURANT_ADMIN and
    // gets routed to a portal it can never enter.
    await prisma.$transaction(async (tx) => {
      const staff = await tx.restaurantStaff.findMany({
        where: { restaurantId: params.id },
        select: { accountId: true },
      });

      await tx.restaurant.delete({ where: { id: params.id } });

      const accountIds = Array.from(new Set(staff.map((s) => s.accountId)));
      if (accountIds.length > 0) {
        // One groupBy, not a count per account: this runs inside an
        // interactive transaction, which has a wall-clock timeout that a
        // per-account round trip would eat into on a big roster.
        const remaining = await tx.restaurantStaff.groupBy({
          by: ["accountId"],
          where: { accountId: { in: accountIds } },
          _count: { _all: true },
        });
        const orphaned = orphanedStaffAccountIds(
          accountIds,
          remaining.map((r) => ({ accountId: r.accountId, count: r._count._all }))
        );
        if (orphaned.length > 0) {
          const role = await tx.role.findUnique({ where: { name: RESTAURANT_ADMIN_ROLE } });
          if (role) {
            await tx.accountRole.deleteMany({
              where: { accountId: { in: orphaned }, roleId: role.id },
            });
          }
        }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
