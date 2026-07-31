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
  if (typeof clientDate === "string" && parseLocalDateStrict(clientDate)) {
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

/** Calendar-day arithmetic on a local date string. No timezone involved. */
export function shiftLocalDate(localDate: string, days: number): string {
  const parsed = parseLocalDateStrict(localDate);
  if (!parsed) throw new Error(`shiftLocalDate: invalid date ${localDate}`);
  parsed.setDate(parsed.getDate() + days);
  return format(parsed);
}
