import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getOrCreateAccount } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { validateInviteAcceptance } from "@/lib/restaurant-invites";
import { RESTAURANT_ADMIN_ROLE, staffRoleSatisfies } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";

// Phase 6a M1 — accept a restaurant invite (design §4). Works for both
// paths: fresh Clerk sign-up from the invitation email (the account row is
// created here via getOrCreateAccount) and an existing account claiming an
// invite in-app. One transaction: staff row + RESTAURANT_ADMIN role +
// invite ACCEPTED + audit.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("restaurant-accept-invite", userId, 10, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { inviteId?: unknown } | null;
  const inviteId = typeof body?.inviteId === "string" && body.inviteId ? body.inviteId : null;
  if (!inviteId) return NextResponse.json({ error: "inviteId is required" }, { status: 400 });

  const account = await getOrCreateAccount(userId);

  const invite = await prisma.restaurantInvite.findUnique({
    where: { id: inviteId },
    include: { restaurant: { select: { id: true, name: true, slug: true } } },
  });
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });

  const err = validateInviteAcceptance(invite, account.email, new Date());
  if (err) return NextResponse.json({ error: err }, { status: 409 });

  const staff = await prisma.$transaction(async (tx) => {
    const role = await tx.role.upsert({
      where: { name: RESTAURANT_ADMIN_ROLE },
      update: {},
      create: { name: RESTAURANT_ADMIN_ROLE },
    });
    await tx.accountRole.upsert({
      where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
      update: {},
      create: { accountId: account.id, roleId: role.id },
    });

    // Re-invites of existing staff only ever raise the tier (an OWNER
    // invite promotes a MANAGER; the reverse never demotes).
    const existing = await tx.restaurantStaff.findUnique({
      where: { accountId_restaurantId: { accountId: account.id, restaurantId: invite.restaurantId } },
    });
    const row = existing
      ? staffRoleSatisfies(existing.role, invite.role)
        ? existing
        : await tx.restaurantStaff.update({ where: { id: existing.id }, data: { role: invite.role } })
      : await tx.restaurantStaff.create({
          data: {
            accountId: account.id,
            restaurantId: invite.restaurantId,
            role: invite.role,
            invitedById: invite.invitedById,
          },
        });

    await tx.restaurantInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    await auditRestaurantChange(tx, {
      restaurantId: invite.restaurantId,
      accountId: account.id,
      entity: "staff",
      entityId: row.id,
      action: "accept-invite",
      diff: { inviteId: invite.id, role: invite.role },
    });

    return row;
  });

  return NextResponse.json({
    restaurant: invite.restaurant,
    role: staff.role,
  });
}
