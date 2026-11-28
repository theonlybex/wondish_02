// One place for "Clara carried on without something she should have had".
//
// The dish path is built to always answer: when a person's rules, steer or
// kept foods fail to load, it serves a dish without them and moves on. That is
// the right thing for the person, and it used to leave only a console line, so
// a broken rule path could run for days unnoticed. Each such fallback now also
// reaches Sentry as one grouped warning per kind.
//
// Never pass user content: `kind` is a fixed word and `detail` an error
// message or a number of milliseconds.
import * as Sentry from "@sentry/nextjs";

export type ClaraSignalKind =
  | "steer-failed"
  | "level-ceilings-failed"
  | "brain-failed"
  | "brain-minimal"
  | "brain-reads-failed"
  | "brain-reads-slow"
  | "kept-foods-failed"
  | "kept-foods-slow"
  | "library-failed"
  | "generate-threw"
  | "model-busy-retried"
  | "model-busy";

type Reporter = (kind: ClaraSignalKind, detail: string) => void;

const toSentry: Reporter = (kind) => {
  Sentry.captureMessage(`Clara fallback: ${kind}`, { level: "warning", tags: { clara_signal: kind }, fingerprint: ["clara-signal", kind] });
};

let reporter: Reporter = toSentry;

/** Tests and simulations swap the reporter to count signals; returns the one that was set. */
export function setClaraSignalReporter(next: Reporter | null): Reporter {
  const before = reporter;
  reporter = next ?? toSentry;
  return before;
}

/**
 * At most one report per kind per minute from one server instance. With many
 * people on at once, one failing dependency fails every request the same way:
 * unthrottled, that is thousands of identical Sentry events in minutes (and
 * Sentry bills and rate-limits by event). The next report says how many were
 * held back, so the size of the problem is not lost.
 */
export const SIGNAL_REPORT_EVERY_MS = 60_000;
const lastReported = new Map<ClaraSignalKind, number>();
const heldBack = new Map<ClaraSignalKind, number>();

/** Tests only: forget what was reported. */
export function resetClaraSignalThrottle(): void {
  lastReported.clear();
  heldBack.clear();
}

/** Says, in the log and to the reporter, that a fallback was taken. Never throws. */
export function claraSignal(kind: ClaraSignalKind, detail = "", now: number = Date.now()): void {
  // The log line is always written: logs are cheap and complete. Only the report is throttled.
  console.warn(`[clara-signal] ${kind}${detail ? `: ${detail}` : ""}`);
  const last = lastReported.get(kind);
  if (last !== undefined && now - last < SIGNAL_REPORT_EVERY_MS) {
    heldBack.set(kind, (heldBack.get(kind) ?? 0) + 1);
    return;
  }
  const held = heldBack.get(kind) ?? 0;
  lastReported.set(kind, now);
  heldBack.delete(kind);
  try {
    reporter(kind, `${detail}${held > 0 ? `${detail ? " " : ""}(+${held} more in the last minute)` : ""}`);
  } catch {
    // Reporting must never break the dish it is reporting on.
  }
}
