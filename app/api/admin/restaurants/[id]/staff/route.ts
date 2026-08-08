import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { assignStaffDirect } from "@/lib/restaurant-invites-server";

// Phase 6a M1 — staff roster for the admin Staff tab (design §4/§5.7).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const staff = await prisma.restaurantStaff.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "asc" },
      include: {
        account: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return NextResponse.json({ staff });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// Phase 6a §4D — ops adds staff by email. Direct-assigns when the email
// already has a Wondish account (no invite round-trip), otherwise falls
// back to the invite flow; `mode` in the response says which happened.
// Admin is the trust root and may grant OWNER (design §4A).

const STAFF_ROLES = new Set(["OWNER", "MANAGER"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
    const role = body?.role === undefined ? "OWNER" : body.role;
    if (typeof role !== "string" || !STAFF_ROLES.has(role)) {
      return NextResponse.json({ error: "role must be OWNER or MANAGER" }, { status: 400 });
    }

    const result = await assignStaffDirect({
      restaurantId: restaurant.id,
      rawEmail: body?.email,
      role: role as "OWNER" | "MANAGER",
      actorId: admin.id,
      origin: req.nextUrl.origin,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
