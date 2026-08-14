// Phase 3 §1/§2 — the QR scan and attribution write path.
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidQrToken, QR_TOKEN_LENGTH } from "@/lib/restaurant-referrals";

/// The referral carrier across the Clerk sign-up round-trip. A cookie rather
/// than a query param because the register page hard-codes Clerk's
/// forceRedirectUrl, which discards any redirect_url we would attach.
/// Lives here, not in a route module, so both routes can share it without one
/// route handler importing another.
export const REFERRAL_COOKIE = "wondish_ref";

/// 30 minutes — one sitting at a table. Long enough to finish sign-up,
/// short enough that a shared device does not attribute the next diner.
export const REFERRAL_COOKIE_MAX_AGE = 30 * 60;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/// Ambiguous glyphs (0/O, 1/l/I) are omitted: these get printed on a table
/// tent and occasionally typed by hand.
export function generateQrToken(): string {
  const bytes = randomBytes(QR_TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < QR_TOKEN_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export interface ResolvedQrCode {
  id: string;
  restaurantId: string;
  restaurantSlug: string;
}

export async function resolveQrToken(token: string): Promise<ResolvedQrCode | null> {
  if (!isValidQrToken(token)) return null;
  const row = await prisma.restaurantQrCode.findUnique({
    where: { token },
    select: {
      id: true,
      restaurantId: true,
      active: true,
      restaurant: { select: { slug: true, status: true } },
    },
  });
  if (!row || !row.active) return null;
  // The code being active is NOT enough: the destination menu is gated on
  // PUBLISHED (lib/restaurants-page-server.ts) and 404s otherwise. Without
  // this check an active tent on a DRAFT or ARCHIVED restaurant lands a
  // brand-new account on a 404 the moment it finishes signing up.
  if (row.restaurant.status !== "PUBLISHED") return null;
  return { id: row.id, restaurantId: row.restaurantId, restaurantSlug: row.restaurant.slug };
}

export async function recordScan(qrCodeId: string): Promise<void> {
  await prisma.restaurantQrCode.update({
    where: { id: qrCodeId },
    data: { scans: { increment: 1 } },
  });
}

/// Idempotent by design: re-scanning is normal behaviour. A second call must
/// neither create a duplicate row nor inflate the pilot's signup count.
///
/// `countsAsSignup` separates the two ways a referral is created:
///   - true  (/r/claim) — the account was just created, so it IS a sign-up
///     the code earned, and RestaurantQrCode.signups advances.
///   - false (/r/[token] while already signed in) — an EXISTING diner
///     scanning a tent. Worth attributing, but counting it as a sign-up
///     would inflate the one number the pilot is judged on (roadmap
///     Milestone 1: "QR scans -> sign-up conversion"). Staff testing tents
///     and regulars dining out would otherwise dominate it.
export async function recordReferral(args: {
  accountId: string;
  qrCodeId: string;
  restaurantId: string;
  countsAsSignup: boolean;
}): Promise<"created" | "already"> {
  const existing = await prisma.restaurantReferral.findUnique({
    where: { accountId_restaurantId: { accountId: args.accountId, restaurantId: args.restaurantId } },
    select: { id: true },
  });
  if (existing) return "already";

  try {
    // One transaction: the row and the counter it feeds must not diverge.
    // Committing the row and then failing the increment would under-count
    // permanently, because the guard above short-circuits every retry.
    await prisma.$transaction(async (tx) => {
      await tx.restaurantReferral.create({
        data: {
          accountId: args.accountId,
          restaurantId: args.restaurantId,
          restaurantQrCodeId: args.qrCodeId,
        },
      });
      if (args.countsAsSignup) {
        await tx.restaurantQrCode.update({
          where: { id: args.qrCodeId },
          data: { signups: { increment: 1 } },
        });
      }
    });
  } catch (err) {
    // Lost a race with a concurrent claim — the other request already
    // attributed this account, so the outcome is the same.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "already";
    if ((err as { code?: string })?.code === "P2002") return "already";
    throw err;
  }

  return "created";
}
