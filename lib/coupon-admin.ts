// Validation for admin-created DB coupons (PREMIUM beta grants and ADMIN
// SUPER-role codes). Pure, so the shape rules are unit-tested; the route only
// translates a valid input into a prisma.coupon.create.
export type CouponInput = {
  code: string;
  type: "PREMIUM" | "ADMIN";
  maxUses: number; // -1 = unlimited, else ≥ 1
  expiresAt: Date | null; // redeem-by deadline
  accessUntil: Date | null; // access end; non-null iff type === "PREMIUM"
  note: string | null;
};

const CODE_RE = /^[A-Z0-9_-]{4,24}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 200;

// <input type="date"> sends "YYYY-MM-DD". Read as end of that day (UTC) so
// "access until Dec 31" includes Dec 31. Full ISO strings pass through.
export function parseDeadline(raw: unknown): Date | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const s = raw.trim();
  if (!s) return null;
  const iso = DATE_ONLY_RE.test(s) ? `${s}T23:59:59.999Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export function validateCouponInput(
  input: unknown,
  now: Date
): { ok: true; value: CouponInput } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Body must be an object" };
  const b = input as Record<string, unknown>;

  const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) return { ok: false, error: "Code must be 4–24 letters, digits, _ or -" };

  const type = b.type;
  if (type !== "PREMIUM" && type !== "ADMIN") return { ok: false, error: "type must be PREMIUM or ADMIN" };

  const maxUses = b.maxUses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || (maxUses !== -1 && maxUses < 1)) {
    return { ok: false, error: "maxUses must be -1 (unlimited) or a positive integer" };
  }

  const expiresAt = parseDeadline(b.expiresAt);
  if (expiresAt === "invalid") return { ok: false, error: "expiresAt is not a valid date" };
  if (expiresAt && expiresAt <= now) return { ok: false, error: "Redeem-by date must be in the future" };

  const accessUntil = parseDeadline(b.accessUntil);
  if (accessUntil === "invalid") return { ok: false, error: "accessUntil is not a valid date" };
  if (type === "PREMIUM" && !accessUntil) return { ok: false, error: "Premium codes need an access end date" };
  if (type === "ADMIN" && accessUntil) return { ok: false, error: "Admin codes don't take an access end date" };
  if (accessUntil && accessUntil <= now) return { ok: false, error: "Access end date must be in the future" };
  if (expiresAt && accessUntil && expiresAt > accessUntil) {
    return { ok: false, error: "Redeem-by date must not be after the access end date" };
  }

  const rawNote = typeof b.note === "string" ? b.note.trim() : "";
  if (rawNote.length > NOTE_MAX) return { ok: false, error: `Note must be at most ${NOTE_MAX} characters` };

  return {
    ok: true,
    value: { code, type, maxUses, expiresAt, accessUntil, note: rawNote || null },
  };
}
