import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { normalizeEmail } from "@/lib/restaurant-invites";
import { auditRestaurantChange } from "@/lib/restaurant-audit";

// Phase 6a M1 — ops invites restaurant staff (design §4A). Invite-only:
// this admin surface is the trust root; owners inviting managers is M4.

const STAFF_ROLES = new Set(["OWNER", "MANAGER"]);
// Deliberately loose: the real validation is Clerk delivering to it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const invites = await prisma.restaurantInvite.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ invites });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: params.id },
      select: { id: true, name: true },
    });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
    const rawEmail = typeof body?.email === "string" ? body.email : "";
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    const role = body?.role === undefined ? "OWNER" : body.role;
    if (typeof role !== "string" || !STAFF_ROLES.has(role)) {
      return NextResponse.json({ error: "role must be OWNER or MANAGER" }, { status: 400 });
    }

    // Already on staff → nothing to invite.
    const existingAccount = await prisma.account.findUnique({
      where: { email },
      select: { id: true, restaurantStaff: { where: { restaurantId: restaurant.id } } },
    });
    if (existingAccount && existingAccount.restaurantStaff.length > 0) {
      return NextResponse.json({ error: "That email is already a staff member" }, { status: 409 });
    }

    const pending = await prisma.restaurantInvite.findFirst({
      where: { restaurantId: restaurant.id, email, status: "PENDING" },
      select: { id: true },
    });
    if (pending) {
      return NextResponse.json({ error: "An invite for that email is already pending" }, { status: 409 });
    }

    const invite = await prisma.restaurantInvite.create({
      data: {
        restaurantId: restaurant.id,
        email,
        role: role as "OWNER" | "MANAGER",
        invitedById: admin.id,
      },
    });

    // Clerk sends the email for addresses with no Wondish account yet; an
    // existing account claims the invite in-app instead (design §4C). A
    // Clerk failure must not lose the invite — it stays claimable in-app.
    let emailSent = false;
    if (!existingAccount) {
      try {
        const client = await clerkClient();
        const clerkInvite = await client.invitations.createInvitation({
          emailAddress: email,
          publicMetadata: { restaurantInviteId: invite.id },
          // Post-signup landing: the accept page claims the invite and
          // routes into the portal (design §4A step 3).
          redirectUrl: `${req.nextUrl.origin}/restaurant/accept?inviteId=${invite.id}`,
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
      restaurantId: restaurant.id,
      accountId: admin.id,
      entity: "invite",
      entityId: invite.id,
      action: "create",
      diff: { email, role },
    });

    return NextResponse.json({ invite, emailSent }, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
