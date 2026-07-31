/**
 * Utterance → expected tool. Every skill cycle APPENDS 10–20 cases here and
 * re-runs the whole accumulated set via `npm run clara:routing-eval` at audit
 * (spec §4.3). Bar: ≥90% top-1. `expect: null` means the right move is to
 * answer conversationally without calling anything.
 *
 * This is NOT a unit test: measuring selection needs real model calls, which
 * are slow, costly and non-deterministic. It is an audit-phase script whose
 * score is recorded in the cycle ledger.
 */
export interface RoutingCase {
  utterance: string;
  expect: string | null;
  note?: string;
}

export const ROUTING_FIXTURE: RoutingCase[] = [
  // ── profile (C0) ──
  { utterance: "what's on my dietary profile right now?", expect: "profile_get" },
  { utterance: "remind me which allergies you have on file for me", expect: "profile_get" },
  { utterance: "read back my food preferences", expect: "profile_get" },

  // ── no tool: Clara's native dish check and general knowledge ──
  { utterance: "is a chicken burrito okay for me?", expect: null, note: "answers from the prompt snapshot" },
  { utterance: "how much protein should I eat a day?", expect: null, note: "general knowledge" },
  { utterance: "thanks Clara!", expect: null },

  // ── gaps: capabilities that do not exist yet in C0 ──
  { utterance: "what did I eat two weeks ago?", expect: "gap_report", note: "S1 not built" },
  { utterance: "log that ramen for lunch", expect: "gap_report", note: "S1 not built" },
  { utterance: "add shellfish to my allergies", expect: "gap_report", note: "S6 not built; profile_get is read-only" },
  { utterance: "what's for dinner tomorrow?", expect: "gap_report", note: "S3 not built" },
  { utterance: "is oat milk on my grocery list?", expect: "gap_report", note: "S7 not built" },
  { utterance: "cancel my subscription", expect: "gap_report", note: "OUT_OF_SCOPE, still recorded" },
];
