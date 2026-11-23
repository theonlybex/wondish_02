import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  APPLE_BUNDLE_ID,
  AppleVerifyError,
  readAppleTransaction,
  refreshAppleTransaction,
  verifyAppleJws,
} from "@/lib/billing/apple";

type Notification = {
  notificationType?: string;
  signedDate?: number;
  data?: { bundleId?: string; signedTransactionInfo?: string };
};

// POST /api/billing/apple/notifications { signedPayload }: App Store Server
// Notifications, version 2. Apple calls this when a subscription renews,
// lapses, or is refunded. There is no session: the payload is trusted only
// because its signature chains to Apple's root certificate. The row that
// already holds the purchase is updated; a purchase nobody has claimed is
// ignored (the app claims it when the buyer next opens Clara).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { signedPayload?: unknown } | null;
  if (typeof body?.signedPayload !== "string") return NextResponse.json({ error: "signedPayload required" }, { status: 400 });

  try {
    const notification = verifyAppleJws<Notification>(body.signedPayload);
    const signedTransaction = notification.data?.signedTransactionInfo;
    // Notices with no transaction (e.g. TEST) and notices for another app: acknowledged, nothing to do.
    if (!signedTransaction || notification.data?.bundleId !== APPLE_BUNDLE_ID) return NextResponse.json({ ok: true });
    await refreshAppleTransaction(prisma, readAppleTransaction(signedTransaction));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AppleVerifyError) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    throw err;
  }
}
