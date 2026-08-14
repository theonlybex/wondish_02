import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";
import { generateQrToken } from "@/lib/restaurant-referrals-server";

// Phase 3 §1 — ops mints and labels the codes that go on tables.
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
    return NextResponse.json({ codes });
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
    return NextResponse.json({ code }, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
