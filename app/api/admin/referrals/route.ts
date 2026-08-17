import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { referralFunnelState, conversionRate } from "@/lib/restaurant-referrals";

// Phase 3 §5 — ops-only referral reporting. Two halves, because a scan is
// anonymous: aggregate counters on top, one row per referred ACCOUNT below.
// Owners get nothing here; this is the Wondish ops view (design §5).
const ROW_LIMIT = 200;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const restaurantId = searchParams.get("restaurantId")?.trim() || null;
    const search = searchParams.get("search")?.trim() || null;

    const where = {
      ...(restaurantId ? { restaurantId } : {}),
      ...(search ? { account: { email: { contains: search, mode: "insensitive" as const } } } : {}),
    };

    const [rows, counters] = await Promise.all([
      prisma.restaurantReferral.findMany({
        where,
        orderBy: { signedUpAt: "desc" },
        take: ROW_LIMIT,
        select: {
          id: true,
          signedUpAt: true,
          accountId: true,
          account: {
            select: { email: true, firstName: true, lastName: true, onboardingComplete: true },
          },
          restaurantId: true,
          restaurant: { select: { name: true } },
          qrCode: { select: { label: true } },
        },
      }),
      // The strip counts SCANS, which are anonymous and therefore live on the
      // QR rows, not on referrals. It honours the restaurant filter, but an
      // email search CANNOT narrow it — a scan has no person attached. The
      // response says so rather than letting site-wide totals sit next to one
      // diner's row and read as that diner's numbers.
      prisma.restaurantQrCode.aggregate({
        where: restaurantId ? { restaurantId } : {},
        _sum: { scans: true, signups: true },
      }),
    ]);

    const scans = counters._sum.scans ?? 0;
    const signups = counters._sum.signups ?? 0;

    return NextResponse.json({
      totals: {
        scans,
        signups,
        conversion: conversionRate(scans, signups),
        // True when an email search is active: the table below is narrowed
        // but these totals are not, because scans are anonymous.
        ignoresSearch: Boolean(search),
      },
      rows: rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        email: r.account.email,
        name: [r.account.firstName, r.account.lastName].filter(Boolean).join(" ") || null,
        restaurantId: r.restaurantId,
        restaurantName: r.restaurant.name,
        qrLabel: r.qrCode?.label ?? null,
        // Derived at read time so it can never drift from the account.
        status: referralFunnelState(r.account),
        signedUpAt: r.signedUpAt,
      })),
      truncated: rows.length === ROW_LIMIT,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
