import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { auditRestaurantChange } from "@/lib/restaurant-audit";

// Phase 6a M1 — revoke a pending invite (design §4C).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; inviteId: string } }
) {
  try {
    const admin = await requireAdmin();

    const invite = await prisma.restaurantInvite.findFirst({
      where: { id: params.inviteId, restaurantId: params.id },
    });
    if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    if (invite.status !== "PENDING") {
      return NextResponse.json({ error: "Only pending invites can be revoked" }, { status: 409 });
    }

    const updated = await prisma.restaurantInvite.update({
      where: { id: invite.id },
      data: { status: "REVOKED" },
    });

    // Best-effort: also cancel the Clerk email invitation so the link dies.
    if (invite.clerkInvitationId) {
      try {
        const client = await clerkClient();
        await client.invitations.revokeInvitation(invite.clerkInvitationId);
      } catch (err) {
        console.error("[restaurant-invites] Clerk revoke failed", err);
      }
    }

    await auditRestaurantChange(prisma, {
      restaurantId: invite.restaurantId,
      accountId: admin.id,
      entity: "invite",
      entityId: invite.id,
      action: "revoke",
    });

    return NextResponse.json({ invite: updated });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
