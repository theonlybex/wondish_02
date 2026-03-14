import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { addMinutes } from "date-fns";

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { email } });
  if (!account || account.emailVerified) {
    // Silent response to avoid enumeration
    return NextResponse.json({ ok: true });
  }

  // Rate limit: 60s between resends
  const recent = await prisma.verificationToken.findFirst({
    where: {
      email,
      createdAt: { gte: new Date(Date.now() - 60 * 1000) },
    },
  });

  if (recent) {
    return NextResponse.json(
      { error: "Please wait 60 seconds before requesting another email." },
      { status: 429 }
    );
  }

  // Delete old tokens
  await prisma.verificationToken.deleteMany({ where: { email } });

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      token,
      email,
      expiresAt: addMinutes(new Date(), 60),
    },
  });

  // TODO: send email via Resend/SendGrid
  console.log(`Verify email token for ${email}: ${token}`);

  return NextResponse.json({ ok: true });
}
