import { parseLocalDateStrict } from "@/lib/journal";

export interface TodayResolution {
  /** "YYYY-MM-DD" */
  localDate: string;
  source: "client" | "offset" | "server";
}

function format(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Days between two "YYYY-MM-DD" strings, using UTC so no zone can skew it. */
function absDayGap(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd));
  return Math.round(ms / 86_400_000);
}

/**
 * A client-supplied date is trusted only if it is real and close to now.
 *
 * Two holes this closes: `parseLocalDateStrict` accepts rolled-over dates
 * ("2026-02-31" silently becomes March 3), and the value is otherwise entirely
 * client-controlled — it is asserted verbatim in the system prompt AND used as
 * the gap-ledger dedupe key, so an arbitrary date lets a client defeat the
 * unique constraint and distort the report's windows. ±2 days covers every
 * real timezone (max spread is ~26h) with no room to spare.
 */
function isPlausibleClientDate(value: string, now: Date): boolean {
  const parsed = parseLocalDateStrict(value);
  if (!parsed) return false;
  // Round-trip: a rolled-over date formats back to something else.
  if (format(parsed) !== value) return false;
  return absDayGap(value, format(now)) <= 2;
}

/**
 * Decides the caller's local "today" — the anchor every relative date phrase
 * ("two weeks ago") resolves against. Client-supplied first, matching the
 * MealLog.localDate precedent: the server does no UTC math and is immune to
 * its own deploy region.
 *
 * When the result is `source: "server"` the caller told us nothing, and the
 * system prompt deliberately asserts NO date at all (see registry.ts) — a UTC
 * deploy would otherwise tell a UTC-7 user it is already tomorrow.
 */
export function resolveToday(
  clientDate: unknown,
  tzOffsetMinutes: unknown,
  now: Date
): TodayResolution {
  if (typeof clientDate === "string" && isPlausibleClientDate(clientDate, now)) {
    return { localDate: clientDate, source: "client" };
  }
  if (
    typeof tzOffsetMinutes === "number" &&
    Number.isInteger(tzOffsetMinutes) &&
    Math.abs(tzOffsetMinutes) <= 840 // ±14h, the real-world extreme
  ) {
    const shifted = new Date(now.getTime() + tzOffsetMinutes * 60_000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const d = String(shifted.getUTCDate()).padStart(2, "0");
    return { localDate: `${y}-${m}-${d}`, source: "offset" };
  }
  return { localDate: format(now), source: "server" };
}

/**
 * Calendar-day arithmetic on a local date string. No timezone involved — and
 * that is literally true here because the maths runs in UTC. Using a local
 * `Date` would not be: in zones whose DST transition lands at 00:00, local
 * midnight normalizes to 23:00 the previous day and the shift lands a day off.
 */
export function shiftLocalDate(localDate: string, days: number): string {
  if (!parseLocalDateStrict(localDate)) {
    throw new Error(`shiftLocalDate: invalid date ${localDate}`);
  }
  const [y, m, d] = localDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
