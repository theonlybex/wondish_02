import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — portal staff roster (design §5.7). OWNER only.
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
