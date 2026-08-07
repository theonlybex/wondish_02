import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { removeStaffMember } from "@/lib/restaurant-invites-server";

// Phase 6a M1/M4 — remove a staff member (any role — admin is the trust
// root); mechanics shared with the portal Staff screen, which may only
// remove MANAGERs.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; staffId: string } }
) {
  try {
    const admin = await requireAdmin();
    const result = await removeStaffMember({
      restaurantId: params.id,
      staffId: params.staffId,
      actorId: admin.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
