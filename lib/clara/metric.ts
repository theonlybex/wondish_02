// Counters for Clara, as one log line each.
//
// What a dish was served from, how often Clara was busy and how meals get
// logged used to exist only as prose in the logs, if at all. Each event is now
// one line that starts with "[clara-metric] " and carries a small JSON object,
// so a log drain or a saved log search can count it: no new service, no new
// dependency. Never user content: fixed words and numbers only.
export type ClaraMetricName = "dish_served" | "dish_resized" | "chat_busy" | "meal_logged";

type Sink = (name: ClaraMetricName, tags: Record<string, string | number | boolean>) => void;
const toLog: Sink = (name, tags) => console.info(`[clara-metric] ${JSON.stringify({ m: name, ...tags })}`);
let sink: Sink = toLog;

/** Tests and simulations swap the sink to count events; returns the one that was set. */
export function setClaraMetricSink(next: Sink | null): Sink {
  const before = sink;
  sink = next ?? toLog;
  return before;
}

/** Counts one event. Never throws. */
export function claraMetric(name: ClaraMetricName, tags: Record<string, string | number | boolean> = {}): void {
  try {
    sink(name, tags);
  } catch {
    // Counting must never break what it counts.
  }
}
