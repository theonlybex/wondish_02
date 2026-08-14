import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

// Codes are deactivated, never deleted: the referrals they earned point at
// them, and the pilot's history should stay readable. The restaurantId in the
// where-clause scopes the update to the URL's restaurant, so a code id from
// another restaurant cannot be toggled through this path.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; codeId: string } }
) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as { active?: unknown } | null;
    if (typeof body?.active !== "boolean") {
      return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
    }
    const updated = await prisma.restaurantQrCode.updateMany({
      where: { id: params.codeId, restaurantId: params.id },
      data: { active: body.active },
    });
    if (updated.count === 0) return NextResponse.json({ error: "QR code not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
