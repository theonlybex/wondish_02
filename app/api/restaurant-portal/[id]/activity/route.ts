import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse } from "@/lib/admin";
import { requireRestaurantStaff } from "@/lib/restaurant-auth";
import { getActivityPage } from "@/lib/restaurant-portal-server";
import { rateLimit } from "@/lib/rate-limit";

// Phase 6a M4 — activity feed (design §5.7): RestaurantAuditLog newest-first,
// humanized server-side ("Maria updated Pad Thai — price 17.99 → 18.99").
// Page logic lives in getActivityPage, shared with the server-rendered page.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireRestaurantStaff(params.id);
    const { success } = await rateLimit("restaurant-portal-read", ctx.account.id, 120, 60);
    if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

    const cursor = new URL(req.url).searchParams.get("cursor");
    return NextResponse.json(await getActivityPage(params.id, cursor));
  } catch (err) {
    return adminErrorResponse(err);
  }
}
