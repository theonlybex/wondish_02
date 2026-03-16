import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "20");
    const search = searchParams.get("search") ?? "";

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          subscription: { select: { plan: true, status: true } },
          roles: { include: { role: true } },
          company: { select: { name: true } },
        },
      }),
      prisma.account.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, limit });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();

    const { id, isEnabled } = await req.json();

    const account = await prisma.account.update({
      where: { id },
      data: { isEnabled },
      select: { id: true, email: true, isEnabled: true },
    });

    return NextResponse.json(account);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
