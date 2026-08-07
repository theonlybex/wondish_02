// Phase 6a M4 — DB/Clerk-bound invite + staff-removal operations shared by
// the admin Staff tab (M1) and the portal Staff screen (design §4B/§5.7).
// Callers own authorization; these own the mechanics so both surfaces stay
// behaviorally identical.
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/restaurant-invites";
import { RESTAURANT_ADMIN_ROLE } from "@/lib/restaurant-auth";
import { auditRestaurantChange } from "@/lib/restaurant-audit";

// Deliberately loose: the real validation is Clerk delivering to it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteFailure = { ok: false; status: number; error: string };

export async function createStaffInvite(args: {
  restaurantId: string;
  rawEmail: unknown;
  role: "OWNER" | "MANAGER";
  invitedById: string;
  origin: string;
}): Promise<InviteFailure | { ok: true; invite: { id: string }; emailSent: boolean }> {
  const email = normalizeEmail(typeof args.rawEmail === "string" ? args.rawEmail : "");
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: "A valid email is required" };
  }

  // Already on staff → nothing to invite.
  const existingAccount = await prisma.account.findUnique({
    where: { email },
    select: { id: true, restaurantStaff: { where: { restaurantId: args.restaurantId } } },
  });
  if (existingAccount && existingAccount.restaurantStaff.length > 0) {
    return { ok: false, status: 409, error: "That email is already a staff member" };
  }

  const pending = await prisma.restaurantInvite.findFirst({
    where: { restaurantId: args.restaurantId, email, status: "PENDING" },
    select: { id: true },
  });
  if (pending) {
    return { ok: false, status: 409, error: "An invite for that email is already pending" };
  }

  const invite = await prisma.restaurantInvite.create({
    data: {
      restaurantId: args.restaurantId,
      email,
      role: args.role,
      invitedById: args.invitedById,
    },
  });

  // Clerk sends the email for addresses with no Wondish account yet; an
  // existing account claims the invite in-app instead (design §4C). A Clerk
  // failure must not lose the invite — it stays claimable in-app.
  let emailSent = false;
  if (!existingAccount) {
    try {
      const client = await clerkClient();
      const clerkInvite = await client.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { restaurantInviteId: invite.id },
        redirectUrl: `${args.origin}/restaurant/accept?inviteId=${invite.id}`,
        ignoreExisting: true,
      });
      await prisma.restaurantInvite.update({
        where: { id: invite.id },
        data: { clerkInvitationId: clerkInvite.id },
      });
      emailSent = true;
    } catch (err) {
      console.error("[restaurant-invites] Clerk invitation failed", err);
    }
  }

  await auditRestaurantChange(prisma, {
    restaurantId: args.restaurantId,
    accountId: args.invitedById,
    entity: "invite",
    entityId: invite.id,
    action: "create",
    diff: { email, role: args.role },
  });

  return { ok: true, invite, emailSent };
}

export async function revokeStaffInvite(args: {
  restaurantId: string;
  inviteId: string;
  actorId: string;
}): Promise<InviteFailure | { ok: true; invite: { id: string; status: string } }> {
  const invite = await prisma.restaurantInvite.findFirst({
    where: { id: args.inviteId, restaurantId: args.restaurantId },
  });
  if (!invite) return { ok: false, status: 404, error: "Invite not found" };
  if (invite.status !== "PENDING") {
    return { ok: false, status: 409, error: "Only pending invites can be revoked" };
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
    accountId: args.actorId,
    entity: "invite",
    entityId: invite.id,
    action: "revoke",
  });

  return { ok: true, invite: updated };
}

// Removes a staff row; the RESTAURANT_ADMIN role is only dropped when this
// was the account's LAST restaurant (design §4C).
export async function removeStaffMember(args: {
  restaurantId: string;
  staffId: string;
  actorId: string;
  // The portal may only remove MANAGERs (OWNER rows are ops-managed, and it
  // also stops an owner locking the restaurant out); admin passes nothing.
  allowedRoles?: readonly ("OWNER" | "MANAGER")[];
}): Promise<InviteFailure | { ok: true }> {
  const staff = await prisma.restaurantStaff.findFirst({
    where: { id: args.staffId, restaurantId: args.restaurantId },
  });
  if (!staff) return { ok: false, status: 404, error: "Staff member not found" };
  if (args.allowedRoles && !args.allowedRoles.includes(staff.role)) {
    return { ok: false, status: 403, error: "Owners can only be removed by Wondish ops" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.restaurantStaff.delete({ where: { id: staff.id } });

    const remaining = await tx.restaurantStaff.count({ where: { accountId: staff.accountId } });
    if (remaining === 0) {
      const role = await tx.role.findUnique({ where: { name: RESTAURANT_ADMIN_ROLE } });
      if (role) {
        await tx.accountRole.deleteMany({
          where: { accountId: staff.accountId, roleId: role.id },
        });
      }
    }

    await auditRestaurantChange(tx, {
      restaurantId: staff.restaurantId,
      accountId: args.actorId,
      entity: "staff",
      entityId: staff.id,
      action: "remove",
      diff: { removedAccountId: staff.accountId, role: staff.role },
    });
  });

  return { ok: true };
}
