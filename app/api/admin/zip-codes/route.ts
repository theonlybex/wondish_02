import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);
    const zipCodes = await prisma.zipCode.findMany({ orderBy: { code: "asc" } });
    return NextResponse.json({ zipCodes });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);
    const body = await req.json();
    const zipCode = await prisma.zipCode.create({ data: body });
    return NextResponse.json(zipCode, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);
    const { id, ...data } = await req.json();
    const zipCode = await prisma.zipCode.update({ where: { id }, data });
    return NextResponse.json(zipCode);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await prisma.zipCode.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
