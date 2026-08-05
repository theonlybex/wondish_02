import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

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
