// Phase 6a §4C — the ONE way to read "claimable invites for this email".
// Filters to genuinely pending (status PENDING and inside the 30-day TTL)
// and lazily marks overdue rows EXPIRED, so every claim surface (portal
// entry, dashboard banners, the pending API) shows the same truth and an
// expired invite can never render an Accept button that 409s forever.
import { prisma } from "@/lib/db";
import { isInviteExpired } from "@/lib/restaurant-invites";

export async function findClaimableInvites(email: string) {
  const rows = await prisma.restaurantInvite.findMany({
    where: { email: email.toLowerCase(), status: "PENDING" },
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

  return rows.filter((r) => !expiredIds.includes(r.id));
}
