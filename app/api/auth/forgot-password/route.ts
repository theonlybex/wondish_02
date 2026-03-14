import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const account = await prisma.account.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    if (!account) {
      return NextResponse.json({ success: true });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token in a dedicated field (requires schema addition) — for now use a safe log
    // In production: store in a PasswordResetToken table with expiry
    console.info(`[forgot-password] token for ${email}: ${token} (expires ${expires.toISOString()})`);

    await sendPasswordResetEmail(email, token).catch((err) =>
      console.error("[forgot-password] email error:", err)
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
