import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.patient.update({
    where: { accountId: account.id },
    data: { profileCompleted: true },
  });

  return NextResponse.json({ ok: true });
}
