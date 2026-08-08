import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { findClaimableInvites } from "@/lib/restaurant-pending-invites-server";
import Badge from "@/components/ui/Badge";
import PendingInviteBanner from "@/components/restaurant/PendingInviteBanner";

export const metadata = { title: "Your Restaurants" };

// Phase 6a M2 — portal entry (design §5.1): zero restaurants → invite-needed
// page (plus any claimable invites); exactly one → straight to it; several →
// the switcher grid.
export default async function RestaurantEntryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: {
      email: true,
      restaurantStaff: {
        include: {
          restaurant: { select: { id: true, name: true, neighborhood: true, status: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const memberships = account?.restaurantStaff ?? [];
  if (memberships.length === 1) redirect(`/restaurant/${memberships[0].restaurant.id}`);

  const pendingInvites = account ? await findClaimableInvites(account.email) : [];

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-[#1E1A1A] mb-2">Your restaurants</h1>
      <p className="text-sm mb-8" style={{ color: "#848181" }}>
        Manage your menu, nutrition info, and availability on Wondish.
      </p>

      {pendingInvites.length > 0 && (
        <div className="mb-6">
          {pendingInvites.map((invite) => (
            <PendingInviteBanner
              key={invite.id}
              inviteId={invite.id}
              restaurantName={invite.restaurant.name}
              role={invite.role}
            />
          ))}
        </div>
      )}

      {memberships.length === 0 ? (
        pendingInvites.length === 0 && (
          <div className="bg-white border border-[#EAE4CA] rounded-2xl p-8 text-center">
            <p className="font-semibold text-[#1E1A1A] mb-2">No restaurant access yet</p>
            <p className="text-sm" style={{ color: "#848181" }}>
              Access is invite-based. Ask your Wondish contact to send an invite to the email you
              signed in with.
            </p>
          </div>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {memberships.map((m) => (
            <Link
              key={m.id}
              href={`/restaurant/${m.restaurant.id}`}
              className="bg-white border border-[#EAE4CA] rounded-2xl p-5 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[#1E1A1A]">{m.restaurant.name}</p>
                  <p className="text-xs mt-1" style={{ color: "#848181" }}>
                    {m.restaurant.neighborhood}
                  </p>
                </div>
                <Badge variant={m.role === "OWNER" ? "primary" : "info"}>{m.role}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
