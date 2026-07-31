import { parseLocalDateStrict } from "@/lib/journal";

export interface ClaraRequestOptions {
  clientDate?: string;
  tzOffsetMinutes?: number;
  surface: "web" | "ios" | "unknown";
}

/**
 * Additive, optional extensions to the pinned chat body. Invalid values are
 * DROPPED, never 400: an old or buggy client must keep chatting exactly as it
 * does today. `messages` validation stays in lib/chat-history.ts.
 *
 * `tzOffsetMinutes` is minutes EAST of UTC (UTC-5 ⇒ -300) — the same sign
 * convention as the web client's `-getTimezoneOffset()` and iOS's
 * `TimeZone.secondsFromGMT() / 60`.
 */
export function parseClaraRequestOptions(body: unknown): ClaraRequestOptions {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const rawDate = b.clientDate;
  const clientDate =
    typeof rawDate === "string" && parseLocalDateStrict(rawDate) ? rawDate : undefined;

  const rawOffset = b.tzOffsetMinutes;
  const tzOffsetMinutes =
    typeof rawOffset === "number" && Number.isInteger(rawOffset) && Math.abs(rawOffset) <= 840
      ? rawOffset
      : undefined;

  const surface = b.surface === "web" || b.surface === "ios" ? b.surface : "unknown";

  return { clientDate, tzOffsetMinutes, surface };
}
