import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET() {
  try {
    await requireAdmin();

    const companies = await prisma.company.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { accounts: true } } },
    });

    return NextResponse.json({ companies });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const { name } = await req.json();
    const company = await prisma.company.create({ data: { name } });
    return NextResponse.json(company, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();

    const { id, name } = await req.json();
    const company = await prisma.company.update({ where: { id }, data: { name } });
    return NextResponse.json(company);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
