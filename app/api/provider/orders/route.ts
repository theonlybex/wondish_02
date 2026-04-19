import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return adminErrorResponse(err);
  }

  const orders = await prisma.order.findMany({
    include: {
      items: true,
      patient: {
        include: {
          account: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ orders });
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return adminErrorResponse(err);
  }

  const { orderId, status } = await req.json();

  const VALID_STATUSES = ["CONFIRMED", "PREPARING", "DELIVERED", "CANCELED"];
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status },
  });

  return NextResponse.json(order);
}
