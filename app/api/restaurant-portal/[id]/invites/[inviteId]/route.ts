import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { revokeStaffInvite } from "@/lib/restaurant-invites-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — owner revokes a pending invite (design §4C).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; inviteId: string } }
) {
  try {
    const ctx = await requireRestaurantStaff(params.id, "OWNER");
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const result = await revokeStaffInvite({
      restaurantId: params.id,
      inviteId: params.inviteId,
      actorId: ctx.account.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ invite: result.invite });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
