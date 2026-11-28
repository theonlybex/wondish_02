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
  | "generate-threw";

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

/** Says, in the log and to the reporter, that a fallback was taken. Never throws. */
export function claraSignal(kind: ClaraSignalKind, detail = ""): void {
  console.warn(`[clara-signal] ${kind}${detail ? `: ${detail}` : ""}`);
  try {
    reporter(kind, detail);
  } catch {
    // Reporting must never break the dish it is reporting on.
  }
}
