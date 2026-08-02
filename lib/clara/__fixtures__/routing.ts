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
  /** Optional prior turns — for cases whose correct routing depends on
   *  conversation state (e.g. the confirm rule's second turn). */
  history?: { role: "user" | "assistant"; content: string }[];
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

  // ── gaps: capabilities that do not exist yet ──
  { utterance: "add shellfish to my allergies", expect: "gap_report", note: "S6 not built; profile_get is read-only" },
  { utterance: "what's for dinner tomorrow?", expect: "gap_report", note: "S3 not built" },
  { utterance: "is oat milk on my grocery list?", expect: "gap_report", note: "S7 not built" },
  { utterance: "cancel my subscription", expect: "gap_report", note: "OUT_OF_SCOPE, still recorded" },

  // ── S1 logs — the two C0 gap rows above this comment used to include these;
  //    they flipped to real tools when the skill shipped ──
  { utterance: "what did I eat two weeks ago?", expect: "logs_search", note: "S1" },
  {
    utterance: "log that ramen for lunch",
    expect: null,
    note: "S1: confirm rule — Clara PROPOSES an estimate first; no tool on the first turn",
  },

  // ── S1 logs — direct hits ──
  { utterance: "what did I have for breakfast yesterday?", expect: "logs_search" },
  { utterance: "did I eat any fish last week?", expect: "logs_search" },
  { utterance: "how much protein have I had today?", expect: "logs_day_summary" },
  { utterance: "show me today's meals", expect: "logs_day_summary" },
  { utterance: "how many calories did I eat on Monday?", expect: "logs_day_summary" },
  { utterance: "delete the snack I logged twice", expect: "logs_search", note: "find candidates first, then confirm" },

  // ── adversarial neighbours — must NOT hit logs ──
  { utterance: "swap Wednesday's lunch for something else", expect: "gap_report", note: "MEAL_PLAN" },
  { utterance: "when did I last note feeling bloated?", expect: "gap_report", note: "felt ≠ eaten (JOURNAL)" },
  { utterance: "how was my energy this week?", expect: "gap_report", note: "JOURNAL" },
  {
    utterance: "how many calories do I have left today?",
    expect: "logs_day_summary",
    note: "totals are answerable; remaining is S2 — either way NOT a gap-only turn",
  },
  { utterance: "is ramen okay for me?", expect: null, note: "dish check — profile, no tool" },

  // ── confirm flow, second turn ──
  {
    utterance: "yes, log it",
    expect: "logs_create",
    note: "the proposal happened last turn; the affirmative is the trigger",
    history: [
      { role: "user", content: "log that ramen for lunch" },
      {
        role: "assistant",
        content:
          "Tonkotsu ramen is about 550 kcal with 24g protein per bowl — want me to log it for lunch?",
      },
    ],
  },
];
