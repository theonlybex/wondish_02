import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Single source of truth for "does this subscription grant premium access".
// Extracted verbatim from the inline check formerly at
// app/(dashboard)/layout.tsx:11-14 — plan must be PREMIUM AND status must be
// one of ACTIVE/TRIALING/INCOMPLETE (INCOMPLETE covers a just-started Stripe
// checkout that hasn't confirmed payment yet but shouldn't be locked out).
// Grace period past a lapsed Stripe period end before entitlement is cut —
// covers renewal-webhook delivery lag without leaving a meaningful free
// window. Entitlement is otherwise 100% webhook-dependent: one missed
// subscription.deleted would leave status ACTIVE (premium) forever.
const PERIOD_END_GRACE_MS = 24 * 60 * 60 * 1000;

export function hasActivePremium(
  subscription:
    | { plan: string; status: string; stripeCurrentPeriodEnd?: Date | null }
    | null
    | undefined
): boolean {
  if (!subscription) return false;
  if (subscription.plan !== "PREMIUM") return false;
  if (!["ACTIVE", "TRIALING", "INCOMPLETE"].includes(subscription.status)) return false;
  // Period-end backstop: only rows that carry a Stripe period end are
  // subject to it — coupon/admin grants (null periodEnd) never expire here.
  const periodEnd = subscription.stripeCurrentPeriodEnd;
  if (periodEnd && periodEnd.getTime() + PERIOD_END_GRACE_MS < Date.now()) return false;
  return true;
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
    include: { subscriptions: true },
  });
}

export async function getAccount() {
  const { userId } = await auth();
  if (!userId) return null;
  return prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true, roles: { include: { role: true } } },
  });
}

// `accountHasActivePremium` ORs `hasActivePremium` across every subscription
// row on the account (one row per source: STRIPE/APPLE/COUPON/ADMIN) — an
// account is premium if ANY source is currently active, even mid-transition
// between sources (e.g. an Apple purchase landing before the Stripe row is
// canceled).
export function accountHasActivePremium(
  subs: Array<{ plan: string; status: string } | null | undefined>
): boolean {
  return subs.some(hasActivePremium);
}

type ClaimTarget = { id: string; clerkId: string | null; email: string } | null;

export type AccountClaimDecision =
  | { action: "claim"; accountId: string; clerkId: string }
  | { action: "create" }
  | { action: "none"; accountId: string }
  | { action: "conflict" };

// Pure decision behind getOrCreateAccount's email-claim reconciliation. A row
// with `clerkId: null` (e.g. a previous partial registration, or a row seeded
// by an admin/coupon flow before the user ever signed in) is claimed for this
// Clerk user ONLY when the incoming Clerk email is verified — otherwise
// anyone who merely types someone else's (unverified) email at sign-up could
// take over that person's account and its premium/coupon entitlements.
//
// `previousOwnerExists` covers rows held by a DIFFERENT clerkId. A Clerk user
// deleted out-of-band (Clerk dashboard, or a crash between the two deletes in
// DELETE /api/me) strands the row: getAccount looks up by clerkId, so the
// person reads as brand new, while this function called the row taken and
// refused it — a permanent lockout no one can self-serve out of. Pass `false`
// ONLY after confirming with Clerk that the previous owner is gone; leave it
// undefined when unchecked, which keeps the conservative conflict.
export function resolveAccountClaim(
  existingByEmail: ClaimTarget,
  userId: string,
  emailVerified: boolean,
  previousOwnerExists?: boolean
): AccountClaimDecision {
  if (!existingByEmail) return { action: "create" };
  if (existingByEmail.clerkId === userId) {
    return { action: "none", accountId: existingByEmail.id };
  }
  if (existingByEmail.clerkId === null && emailVerified) {
    return { action: "claim", accountId: existingByEmail.id, clerkId: userId };
  }
  // Orphaned row: the recorded owner no longer exists in Clerk. Re-claiming is
  // safe here precisely because there is no one left to take it from — and the
  // verified-email requirement is unchanged, so this is not a takeover path.
  if (existingByEmail.clerkId !== null && previousOwnerExists === false && emailVerified) {
    return { action: "claim", accountId: existingByEmail.id, clerkId: userId };
  }
  // Unverified email on an unclaimed row (takeover guard), or the row is
  // already claimed by a different Clerk user — the email is unclaimable by
  // this Clerk user. Never reassign it, and never fall through to `create`:
  // `email` is @unique, so a create here would always throw P2002 and the
  // caller's `findUniqueOrThrow` would then throw P2025 (no row was ever
  // created for this clerkId) — a 500 instead of a diagnosable outcome.
  return { action: "conflict" };
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// Thrown by getOrCreateAccount when the Clerk user's email already belongs to
// a different, unclaimable account row (see resolveAccountClaim's "conflict"
// branch). Carries only the normalized email that collided — never the other
// account's id/clerkId — so callers can surface a diagnosable error without
// leaking which account owns the address.
/// Does this Clerk user still exist? Any answer other than a definite 404 is
/// reported as "still exists" — a transient Clerk outage must never be read as
/// "the owner is gone" and hand someone else's account away.
async function clerkUserExists(
  client: Awaited<ReturnType<typeof clerkClient>>,
  clerkId: string
): Promise<boolean> {
  try {
    await client.users.getUser(clerkId);
    return true;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return false;
    console.error("[auth] could not verify previous Clerk user; treating as present", err);
    return true;
  }
}

export class AccountClaimConflictError extends Error {
  readonly email: string;
  constructor(email: string) {
    super(`Email "${email}" is already associated with another account.`);
    this.name = "AccountClaimConflictError";
    this.email = email;
  }
}

// Explicit-userId account lookup/creation, race-safe against concurrent
// callers (app launch + foreground refresh + a post-purchase webhook can all
// race to create the same account). Always returns with subscriptions
// included so callers never need a second round trip for premium/serializeMe.
export async function getOrCreateAccount(userId: string) {
  const existing = await prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscriptions: true },
  });
  if (existing) return existing;

  const client = await clerkClient();
  const u = await client.users.getUser(userId);
  const primaryEmail = u.primaryEmailAddress ?? u.emailAddresses[0] ?? null;
  const email = primaryEmail?.emailAddress ?? "";
  const emailVerified = primaryEmail?.verification?.status === "verified";
  const firstName = u.firstName ?? "";
  const lastName = u.lastName ?? "";
  const photoUrl = u.imageUrl ?? null;

  const existingByEmail = email ? await prisma.account.findUnique({ where: { email } }) : null;
  const target = existingByEmail
    ? { id: existingByEmail.id, clerkId: existingByEmail.clerkId, email: existingByEmail.email }
    : null;
  let decision = resolveAccountClaim(target, userId, emailVerified);

  // Only reachable once we are already about to fail, so the happy path never
  // pays for this: a row held by a clerkId that no longer exists in Clerk is
  // orphaned, and a verified email may re-claim it instead of being locked out.
  if (decision.action === "conflict" && emailVerified && target?.clerkId) {
    const previousOwnerExists = await clerkUserExists(client, target.clerkId);
    decision = resolveAccountClaim(target, userId, emailVerified, previousOwnerExists);
    if (decision.action === "claim") {
      console.warn(
        `[auth] re-claiming orphaned account ${target.id}: previous Clerk user ${target.clerkId} no longer exists`
      );
    }
  }

  if (decision.action === "conflict") {
    // Never reach findUniqueOrThrow below — no row exists (or ever will) for
    // this clerkId on this path, so that call would throw P2025 (500).
    throw new AccountClaimConflictError(email);
  }

  if (decision.action === "claim") {
    await prisma.account.update({
      where: { id: decision.accountId },
      data: { clerkId: decision.clerkId },
    });
  } else if (decision.action === "create") {
    try {
      await prisma.account.create({
        data: {
          clerkId: userId,
          email,
          firstName,
          lastName,
          photoUrl,
          // Only record consent the user actually gave — auto-created
          // accounts have never seen the terms flow (audit Task 18).
          agreedTerms: false,
          subscriptions: { create: { plan: "FREE", status: "ACTIVE", source: "STRIPE" } },
        },
      });
    } catch (err) {
      // Concurrent launch/foreground/post-purchase requests can race to
      // create the same account (unique on `email`, and once claimed, on
      // `clerkId`). Rather than 500, fall through to the re-read below —
      // whichever request won the race is returned to everyone.
      if (!isUniqueConstraintViolation(err)) throw err;
    }
  }
  // decision.action === "none" needs no write — a concurrent request already
  // claimed this row between our two reads above.

  return prisma.account.findUniqueOrThrow({
    where: { clerkId: userId },
    include: { subscriptions: true },
  });
}
