import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { generateQrToken } from "@/lib/restaurant-referrals-server";

// Phase 3 §1 — ops mints and labels the codes that go on tables.
//
// The scan URL is built HERE, from configuration, not from whichever host the
// admin happens to be on. Minting from a preview deployment or localhost and
// copying that link would bake the wrong host into a PRINTED table tent,
// permanently.
function scanBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://wondish.io").replace(/\/+$/, "");
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const codes = await prisma.restaurantQrCode.findMany({
      where: { restaurantId: params.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        label: true,
        active: true,
        scans: true,
        signups: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      codes: codes.map((c) => ({ ...c, scanUrl: `${scanBaseUrl()}/r/${c.token}` })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 60) {
      return NextResponse.json({ error: "A label is required (max 60 characters)" }, { status: 400 });
    }

    // Staff membership is not in play here (admin is the trust root), but a
    // bad id must 404 rather than hit the foreign key.
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!restaurant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

    const code = await prisma.restaurantQrCode.create({
      data: { restaurantId: params.id, token: generateQrToken(), label },
      select: {
        id: true,
        token: true,
        label: true,
        active: true,
        scans: true,
        signups: true,
        createdAt: true,
      },
    });
    return NextResponse.json(
      { code: { ...code, scanUrl: `${scanBaseUrl()}/r/${code.token}` } },
      { status: 201 }
    );
  } catch (err) {
    return adminErrorResponse(err);
  }
}
