import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { createStaffInvite } from "@/lib/restaurant-invites-server";

// Phase 6a M1/M4 — ops invites restaurant staff (design §4A). This admin
// surface is the trust root (it may grant OWNER); the portal's own invite
// screen (§4B) shares the same mechanics via lib/restaurant-invites-server.

const STAFF_ROLES = new Set(["OWNER", "MANAGER"]);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const invites = await prisma.restaurantInvite.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ invites });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

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

    const result = await createStaffInvite({
      restaurantId: restaurant.id,
      rawEmail: body?.email,
      role: role as "OWNER" | "MANAGER",
      invitedById: admin.id,
      origin: req.nextUrl.origin,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ invite: result.invite, emailSent: result.emailSent }, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
