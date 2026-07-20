import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

// Single source of truth for "does this subscription grant premium access".
// Extracted verbatim from the inline check formerly at
// app/(dashboard)/layout.tsx:11-14 — plan must be PREMIUM AND status must be
// one of ACTIVE/TRIALING/INCOMPLETE (INCOMPLETE covers a just-started Stripe
// checkout that hasn't confirmed payment yet but shouldn't be locked out).
export function hasActivePremium(
  subscription: { plan: string; status: string } | null | undefined
): boolean {
  if (!subscription) return false;
  if (subscription.plan !== "PREMIUM") return false;
  return ["ACTIVE", "TRIALING", "INCOMPLETE"].includes(subscription.status);
}

// Explicit account+subscription lookup by Clerk id. Some call sites only ever
// fetch a Patient (e.g. `prisma.patient.findFirst({ where: { account:
// { clerkId } } })`, used across app/api/journal/*), which doesn't carry
// subscription data. Anything that needs a premium gate off the back of a
// patient-first lookup (e.g. the CUSTOM meal-log source) calls this instead
// of open-coding another include — one query shape, shared by every gate.
export async function getAccountWithSubscription(clerkId: string) {
  return prisma.account.findUnique({
    where: { clerkId },
    include: { subscription: true },
  });
}

export async function getAccount() {
  const { userId } = await auth();
  if (!userId) return null;
  return prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  });
}

export async function getOrCreateAccount() {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await prisma.account.findUnique({ where: { clerkId: userId } });
  if (existing) return existing;

  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  return prisma.account.create({
    data: {
      clerkId: userId,
      email: clerkUser.emailAddresses[0]?.emailAddress ?? "",
      firstName: clerkUser.firstName ?? "",
      lastName: clerkUser.lastName ?? "",
      agreedTerms: true,
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
    },
  });
}
