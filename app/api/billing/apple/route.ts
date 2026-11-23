import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { accountHasActivePremium } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { AppleOwnershipError, AppleVerifyError, claimAppleTransaction, readAppleTransaction } from "@/lib/billing/apple";

// POST /api/billing/apple { signedTransactions: string[] }: the Clara iOS app
// reports the signed transactions StoreKit gave it (after a purchase, on
// launch, and on "Restore purchases"). Each is verified against Apple's root
// certificate and bound to the caller's account. Answers with the resulting
// entitlement so the app can unlock at once.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await rateLimit("billing-apple", userId, 30, 60);
  if (!success) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { signedTransactions?: unknown } | null;
  const signed = Array.isArray(body?.signedTransactions)
    ? body.signedTransactions.filter((t): t is string => typeof t === "string").slice(0, 10)
    : [];
  if (signed.length === 0) return NextResponse.json({ error: "signedTransactions required" }, { status: 400 });

  const account = await prisma.account.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  let rejected = 0;
  let ownedByAnother = false;
  for (const jws of signed) {
    try {
      await claimAppleTransaction(prisma, account.id, readAppleTransaction(jws));
    } catch (err) {
      if (err instanceof AppleOwnershipError) ownedByAnother = true;
      else if (err instanceof AppleVerifyError) rejected += 1;
      else throw err;
    }
  }

  const subs = await prisma.subscription.findMany({ where: { accountId: account.id } });
  const isPremium = accountHasActivePremium(subs);
  // The purchase is real but another Clara account already holds it.
  if (ownedByAnother && !isPremium) {
    return NextResponse.json({ error: "apple_purchase_in_use", isPremium }, { status: 409 });
  }
  if (rejected === signed.length) return NextResponse.json({ error: "Invalid transaction", isPremium }, { status: 400 });
  return NextResponse.json({ isPremium });
}
