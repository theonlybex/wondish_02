import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getOrCreateAccount } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { isInviteExpired } from "@/lib/restaurant-invites";

// Phase 6a M1 — pending invites addressed to the signed-in email, for the
// in-app claim banner (design §4C: the email already had an account, so no
// Clerk invitation was sent). Expired invites are filtered out here and
// lazily marked EXPIRED so the admin list reflects reality.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("restaurant-pending-invites", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const account = await getOrCreateAccount(userId);
  const rows = await prisma.restaurantInvite.findMany({
    where: { email: account.email.toLowerCase(), status: "PENDING" },
    include: { restaurant: { select: { id: true, name: true, neighborhood: true } } },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const expiredIds = rows.filter((r) => isInviteExpired(r.createdAt, now)).map((r) => r.id);
  if (expiredIds.length) {
    await prisma.restaurantInvite.updateMany({
      where: { id: { in: expiredIds } },
      data: { status: "EXPIRED" },
    });
  }

  const invites = rows
    .filter((r) => !expiredIds.includes(r.id))
    .map((r) => ({ id: r.id, role: r.role, restaurant: r.restaurant, createdAt: r.createdAt }));
  return NextResponse.json({ invites });
}
