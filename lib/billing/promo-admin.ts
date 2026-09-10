// Validation for admin-created Stripe promotion codes. Pure, so the shape
// rules are unit-tested; the route only translates a valid input into the
// Stripe Coupon + Promotion Code pair.
export type PromoInput = {
  code: string;
  percentOff?: number;
  amountOffCents?: number;
  duration: "once" | "repeating" | "forever";
  durationInMonths?: number;
  maxRedemptions?: number;
  expiresAt?: string;
  firstTimeOnly: boolean;
};

const CODE_RE = /^[A-Z0-9_-]{3,20}$/;

export function validatePromoInput(input: unknown): { ok: true; value: PromoInput } | { ok: false; error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) return { ok: false, error: "Code must be 3–20 letters, digits, _ or -" };
  const percentOff = typeof b.percentOff === "number" ? b.percentOff : undefined;
  const amountOffCents = typeof b.amountOffCents === "number" ? Math.round(b.amountOffCents) : undefined;
  if ((percentOff == null) === (amountOffCents == null)) return { ok: false, error: "Set exactly one of percentOff or amountOffCents" };
  if (percentOff != null && (percentOff <= 0 || percentOff > 100)) return { ok: false, error: "percentOff must be 1–100" };
  if (amountOffCents != null && amountOffCents <= 0) return { ok: false, error: "amountOffCents must be positive" };
  const duration = b.duration;
  if (duration !== "once" && duration !== "repeating" && duration !== "forever") {
    return { ok: false, error: "duration must be once | repeating | forever" };
  }
  const durationInMonths = typeof b.durationInMonths === "number" ? b.durationInMonths : undefined;
  if (duration === "repeating" && !(durationInMonths && durationInMonths >= 1)) {
    return { ok: false, error: "durationInMonths required for repeating" };
  }
  const maxRedemptions = typeof b.maxRedemptions === "number" && b.maxRedemptions >= 1 ? Math.floor(b.maxRedemptions) : undefined;
  const expiresAt = typeof b.expiresAt === "string" && !Number.isNaN(Date.parse(b.expiresAt)) ? b.expiresAt : undefined;
  return {
    ok: true,
    value: { code, percentOff, amountOffCents, duration, durationInMonths, maxRedemptions, expiresAt, firstTimeOnly: b.firstTimeOnly === true },
  };
}
