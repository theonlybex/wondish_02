import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { assignStaffDirect } from "@/lib/restaurant-invites-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — portal staff roster (design §5.7). OWNER only.

// Mirrors /api/restaurant-portal/[id]/invites — the cap counts active staff
// plus pending invites, whichever path a new manager arrives through.
const STAFF_CAP = 10;
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id, "OWNER");
    const { success } = await rateLimit("restaurant-portal-read", ctx.account.id, 120, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const staff = await prisma.restaurantStaff.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "asc" },
      include: {
        account: { select: { email: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({
      staff: staff.map((s) => ({
        id: s.id,
        role: s.role,
        email: s.account.email,
        name: `${s.account.firstName} ${s.account.lastName}`.trim(),
        createdAt: s.createdAt.toISOString(),
        isSelf: ctx.staff?.id === s.id,
      })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// Phase 6a §4B/§4D — owners add their own managers by direct assignment,
// email-free: the teammate must already have a Wondish account (clear error
// otherwise — no invite is created from the portal). MANAGER only — OWNER
// seats are granted by Wondish ops — and the seat cap still applies.
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
    const result = await assignStaffDirect({
      restaurantId: params.id,
      rawEmail: body?.email,
      role: "MANAGER", // portal never grants OWNER (design §4B)
      actorId: ctx.account.id,
      origin: req.nextUrl.origin,
      allowInviteFallback: false, // owners adding managers is email-free
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
