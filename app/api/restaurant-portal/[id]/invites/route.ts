import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { createStaffInvite } from "@/lib/restaurant-invites-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — owners invite their own staff (design §4B): MANAGER role
// only (OWNER is granted by Wondish ops), capped at 10 seats per restaurant
// counting active staff plus pending invites.

const STAFF_CAP = 10;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id, "OWNER");
    const { success } = await rateLimit("restaurant-portal-read", ctx.account.id, 120, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const invites = await prisma.restaurantInvite.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    });
    return NextResponse.json({
      invites: invites.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id, "OWNER");
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    // Staff membership implies the restaurant exists, but SUPER bypasses —
    // check explicitly so a bad id 404s instead of hitting the FK.
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const [staffCount, pendingCount] = await Promise.all([
      prisma.restaurantStaff.count({ where: { restaurantId: params.id } }),
      prisma.restaurantInvite.count({ where: { restaurantId: params.id, status: "PENDING" } }),
    ]);
    if (staffCount + pendingCount >= STAFF_CAP) {
      return NextResponse.json(
        { error: `Staff is capped at ${STAFF_CAP} people per restaurant (counting pending invites)` },
        { status: 409 }
      );
    }

    const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
    const result = await createStaffInvite({
      restaurantId: params.id,
      rawEmail: body?.email,
      role: "MANAGER", // portal invites never grant OWNER (design §4B)
      invitedById: ctx.account.id,
      origin: req.nextUrl.origin,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ invite: result.invite, emailSent: result.emailSent }, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
