import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 + §4D — invite history for the portal Staff screen (read +
// revoke only). Owners no longer CREATE invites: adding a manager is the
// email-free direct assignment on POST /api/restaurant-portal/[id]/staff,
// so only Wondish ops can originate invites (admin trust root, §4A).

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
