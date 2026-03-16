import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET() {
  const active = await prisma.termsAndConditions.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ terms: active });
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { version, content } = await req.json();
    const terms = await prisma.termsAndConditions.create({
      data: { version, content, isActive: false },
    });
    return NextResponse.json(terms, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { id } = await req.json();

    // Deactivate all, activate selected
    await prisma.$transaction([
      prisma.termsAndConditions.updateMany({ data: { isActive: false } }),
      prisma.termsAndConditions.update({ where: { id }, data: { isActive: true } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
