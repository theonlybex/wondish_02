// The coupon redemption itself, shared by the two places a code is redeemed:
// POST /api/coupon/redeem (a signed-in user typing it) and /r/claim (a code a
// signed-out visitor entered before signing up, carried in a cookie). Moved
// out of the route (2026-10-16) so both run the exact same gates and the same
// transaction. Callers own auth, rate limiting and how the outcome is shown.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { grantSuper } from "@/lib/admin-grant";
import {
  classifyCoupon,
  couponCapWhere,
  couponPremiumUpsertArgs,
  hasPaidPremium,
  mergeGrantEnd,
  GENERIC_COUPON_ERROR,
} from "@/lib/coupon";

export type RedeemOutcome =
  | { ok: true; type: "PREMIUM" | "ADMIN"; accessUntil: Date | null }
  | { ok: false; reason: "unavailable" | "already" | "paid"; status: 404 | 409; error: string };

// Thrown when the atomic cap-enforcing increment matches no row (cap reached
// or coupon deactivated between the pre-check and the transaction).
class CouponUnavailableError extends Error {}

const UNAVAILABLE: RedeemOutcome = { ok: false, reason: "unavailable", status: 404, error: GENERIC_COUPON_ERROR };
const ALREADY: RedeemOutcome = {
  ok: false,
  reason: "already",
  status: 409,
  error: "You have already redeemed this coupon",
};

/**
 * Redeem `code` (already trimmed + upper-cased) for the account. Throws only
 * on unexpected database errors.
 *
 * `allowAdmin: false` treats ADMIN codes as unavailable. The cookie path sets
 * it: an ADMIN code grants the permanent SUPER role and must be typed by the
 * person it is for, not picked up from a cookie a link planted.
 */
export async function redeemCouponForAccount(
  accountId: string,
  code: string,
  { allowAdmin = true }: { allowAdmin?: boolean } = {}
): Promise<RedeemOutcome> {
  const [subscriptions, coupon] = await Promise.all([
    prisma.subscription.findMany({
      where: { accountId },
      select: { source: true, plan: true, status: true, stripeCurrentPeriodEnd: true, cancelAtPeriodEnd: true },
    }),
    prisma.coupon.findUnique({
      where: { code },
      include: { redemptions: { where: { accountId } } },
    }),
  ]);

  // One generic outcome for not-found/inactive/expired/capped — distinct
  // copy was an enumeration aid (see lib/coupon.ts).
  if (!coupon || classifyCoupon(coupon, new Date()) === "unavailable") return UNAVAILABLE;
  if (coupon.type === "ADMIN" && !allowAdmin) return UNAVAILABLE;
  // PREMIUM codes minted before `accessUntil` existed carry no end date and
  // would grant lifetime premium. The admin validator forbids that for new
  // codes; this closes the gap for legacy rows (2026-09-12 scenario run found
  // three such codes with uses left). ADMIN codes never carry an end.
  if (coupon.type === "PREMIUM" && !coupon.accessUntil) return UNAVAILABLE;

  // The caller already knows this code is valid (they redeemed it), so a
  // distinct message leaks nothing.
  if (coupon.redemptions.length > 0) return ALREADY;

  // A renewing Stripe/Apple subscriber gains nothing from a PREMIUM code and
  // would only burn a use; refuse before touching usedCount. (Checked after
  // the generic gate so an invalid code still reads as merely invalid. A
  // subscriber who already cancelled at period end passes — see
  // hasPaidPremium.)
  if (coupon.type === "PREMIUM" && hasPaidPremium(subscriptions)) {
    return { ok: false, reason: "paid", status: 409, error: "You already have Plus — no code needed." };
  }

  try {
    // The access end actually written (may be later than the coupon's own
    // accessUntil when the account already holds a longer grant). ADMIN → null.
    const accessUntil = await prisma.$transaction(async (tx): Promise<Date | null> => {
      // Record redemption first — the (couponId, accountId) unique aborts a
      // concurrent double-redeem by the same account (P2002 → 409 below).
      await tx.couponRedemption.create({ data: { couponId: coupon.id, accountId } });

      // Atomic cap enforcement: predicate + increment in ONE UPDATE
      // statement, so last-slot races can't overshoot maxUses.
      const capped = await tx.coupon.updateMany({
        where: couponCapWhere(coupon),
        data: { usedCount: { increment: 1 } },
      });
      if (capped.count === 0) throw new CouponUnavailableError();

      if (coupon.type === "ADMIN") {
        // SUPER role + the ADMIN-source premium row (admins have Premium by default).
        await grantSuper(tx, accountId);
        return null;
      }

      // PREMIUM: grant on the COUPON-source row until the coupon's access
      // end; a second code never shortens an active grant.
      const existing = await tx.subscription.findUnique({
        where: { accountId_source: { accountId, source: "COUPON" } },
        select: { plan: true, status: true, stripeCurrentPeriodEnd: true },
      });
      const end = mergeGrantEnd(existing, coupon.accessUntil);
      await tx.subscription.upsert(couponPremiumUpsertArgs(accountId, end));
      return end;
    });
    return { ok: true, type: coupon.type, accessUntil };
  } catch (err) {
    if (err instanceof CouponUnavailableError) return UNAVAILABLE;
    // Concurrent double-redeem by the same account lost the unique race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return ALREADY;
    throw err;
  }
}
