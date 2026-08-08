import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateAccount } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { findClaimableInvites } from "@/lib/restaurant-pending-invites-server";

// Phase 6a M1 — pending invites addressed to the signed-in email, for the
// in-app claim banner (design §4C: the email already had an account, so no
// Clerk invitation was sent). Expiry filtering + lazy EXPIRED marking live
// in findClaimableInvites, shared with every other claim surface.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("restaurant-pending-invites", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const account = await getOrCreateAccount(userId);
  const rows = await findClaimableInvites(account.email);
  const invites = rows.map((r) => ({
    id: r.id,
    role: r.role,
    restaurant: r.restaurant,
    createdAt: r.createdAt,
  }));
  return NextResponse.json({ invites });
}
