// Phase 3 §1/§2 — the QR scan and attribution write path.
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidQrToken, QR_TOKEN_LENGTH } from "@/lib/restaurant-referrals";

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
    select: { id: true, restaurantId: true, active: true, restaurant: { select: { slug: true } } },
  });
  if (!row || !row.active) return null;
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
export async function recordReferral(args: {
  accountId: string;
  qrCodeId: string;
  restaurantId: string;
}): Promise<"created" | "already"> {
  const existing = await prisma.restaurantReferral.findUnique({
    where: { accountId_restaurantId: { accountId: args.accountId, restaurantId: args.restaurantId } },
    select: { id: true },
  });
  if (existing) return "already";

  try {
    await prisma.restaurantReferral.create({
      data: {
        accountId: args.accountId,
        restaurantId: args.restaurantId,
        restaurantQrCodeId: args.qrCodeId,
      },
    });
  } catch (err) {
    // Lost a race with a concurrent claim — the other request already
    // attributed this account, so the outcome is the same.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "already";
    if ((err as { code?: string })?.code === "P2002") return "already";
    throw err;
  }

  await prisma.restaurantQrCode.update({
    where: { id: args.qrCodeId },
    data: { signups: { increment: 1 } },
  });
  return "created";
}
