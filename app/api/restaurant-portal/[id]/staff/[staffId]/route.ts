import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { removeStaffMember } from "@/lib/restaurant-invites-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — owner removes a manager (design §5.7). OWNER rows are
// ops-managed, so the portal may only remove MANAGERs.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; staffId: string } }
) {
  try {
    const ctx = await requireRestaurantStaff(params.id, "OWNER");
    const { success } = await rateLimit("restaurant-portal-write", ctx.account.id, 60, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const result = await removeStaffMember({
      restaurantId: params.id,
      staffId: params.staffId,
      actorId: ctx.account.id,
      allowedRoles: ["MANAGER"],
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
