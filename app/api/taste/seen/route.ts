import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
};

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.patient.update({
    where: { accountId: account.id },
    data: { profileCompleted: true },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("taste_complete", "1", COOKIE_OPTS);
  return res;
}
