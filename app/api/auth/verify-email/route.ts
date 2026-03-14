import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ status: "invalid" });
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } });

  if (!record) {
    return NextResponse.json({ status: "invalid" });
  }

  if (record.expiresAt < new Date()) {
    return NextResponse.json({ status: "expired", email: record.email });
  }

  await prisma.$transaction([
    prisma.account.updateMany({
      where: { email: record.email },
      data: { emailVerified: true },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ]);

  return NextResponse.json({ status: "verified" });
}
