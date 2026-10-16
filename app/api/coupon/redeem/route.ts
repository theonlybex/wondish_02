import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { internalError } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { redeemCouponForAccount, type RedeemOutcome } from "@/lib/coupon-redeem-server";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Brute-force guard: ADMIN-type coupons grant the permanent SUPER role, so
  // unthrottled guessing here would be privilege escalation to full admin.
  // 10/h leaves room for a beta tester's typos; codes are ≥4 chars of a
  // 36-symbol alphabet, so the guess space is still out of reach.
  const { success } = await rateLimit("coupon-redeem", userId, 10, 3600);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawCode = (body as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) {
    return NextResponse.json({ error: "Coupon code is required" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Gates, the cap-enforcing transaction and the grant live in
  // lib/coupon-redeem-server.ts, shared with /r/claim (a code entered before
  // sign-up).
  let outcome: RedeemOutcome;
  try {
    outcome = await redeemCouponForAccount(account.id, code);
  } catch (err) {
    return internalError("coupon/redeem", err, "Couldn't redeem that code right now — please try again.");
  }
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  const accessUntil = outcome.accessUntil ? outcome.accessUntil.toISOString() : null;
  // A PREMIUM-type code grants the COUPON row, which tierFor() rates as
  // "beta" — half of Plus's allowances, never the paid product itself. Say
  // "beta", not "Plus"/"Premium": a tester who reads the paid name here
  // expects the paid limits and then hits a 429 early (QA 2026-09-17).
  const message =
    outcome.type === "ADMIN"
      ? "Admin access granted — you now have unlimited access."
      : accessUntil
        ? `Beta access activated until ${new Date(accessUntil).toLocaleDateString("en-US")}.`
        : "Beta access activated — enjoy!";

  return NextResponse.json({ success: true, type: outcome.type, accessUntil, message });
}
