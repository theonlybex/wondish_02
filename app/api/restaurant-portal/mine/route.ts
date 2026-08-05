import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M1 — the restaurants the signed-in account is staff of (design
// §5.1). Derived purely from RestaurantStaff rows; there is no way to name
// a restaurant you aren't a member of.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("restaurant-portal-mine", userId, 60, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const account = await prisma.account.findUnique({
    where: { clerkId: userId },
    select: {
      restaurantStaff: {
        include: {
          restaurant: { select: { id: true, name: true, slug: true, status: true, neighborhood: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const restaurants = (account?.restaurantStaff ?? []).map((s) => ({
    ...s.restaurant,
    staffRole: s.role,
  }));
  return NextResponse.json({ restaurants });
}
