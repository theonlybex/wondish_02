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
  /**
   * For expect:null cases only — a regex (source) the assistant's TEXT must
   * match for the case to pass. Without it, expect:null scores a PASS on any
   * toolless reply, including "I can't do that", which would let the headline
   * behavior break while the eval stays green.
   */
  expectTextMatch?: string;
}

export const ROUTING_FIXTURE: RoutingCase[] = [
  // ── profile (C0) ──
  { utterance: "what's on my dietary profile right now?", expect: "profile_get" },
  { utterance: "remind me which allergies you have on file for me", expect: "profile_get" },
  { utterance: "read back my food preferences", expect: "profile_get" },

  // ── no tool: Clara's native dish check and general knowledge ──
  { utterance: "is a chicken burrito okay for me?", expect: null, note: "answers from the prompt snapshot" },
  {
    utterance: "how much protein should I eat a day?",
    expect: "nutrition_targets",
    note: "S2: flipped from null — the personalized target now exists and beats generic advice",
  },
  {
    utterance: "is 100g of protein a day too much for the average person?",
    expect: null,
    note: "general knowledge — depersonalized, NOT about the user's own targets",
  },
  { utterance: "thanks Clara!", expect: null },

  // ── gaps: capabilities that do not exist yet ──
  { utterance: "add shellfish to my allergies", expect: "gap_report", note: "S6 not built; profile_get is read-only" },
  { utterance: "what's for dinner tomorrow?", expect: "plan_get", note: "S3: flipped from gap_report" },
  { utterance: "is oat milk on my grocery list?", expect: "gap_report", note: "S7 not built" },
  { utterance: "cancel my subscription", expect: "gap_report", note: "OUT_OF_SCOPE, still recorded" },

  // ── S1 logs — the two C0 gap rows above this comment used to include these;
  //    they flipped to real tools when the skill shipped ──
  { utterance: "what did I eat two weeks ago?", expect: "logs_search", note: "S1" },
  {
    utterance: "log that ramen for lunch",
    expect: null,
    note: "S1: confirm rule — Clara PROPOSES an estimate first; no tool on the first turn",
    // Must actually propose: a kcal figure and a question — not refuse.
    expectTextMatch: "\\d+\\s*(k?cal|calories)[\\s\\S]*\\?",
  },

  // ── S1 logs — direct hits ──
  { utterance: "what did I have for breakfast yesterday?", expect: "logs_search" },
  { utterance: "did I eat any fish last week?", expect: "logs_search" },
  { utterance: "how much protein have I had today?", expect: "logs_day_summary" },
  { utterance: "show me today's meals", expect: "logs_day_summary" },
  { utterance: "how many calories did I eat on Monday?", expect: "logs_day_summary" },
  { utterance: "delete the snack I logged twice", expect: "logs_search", note: "find candidates first, then confirm" },

  // ── adversarial neighbours — must NOT hit logs ──
  { utterance: "swap Wednesday's lunch for something else", expect: "plan_get", note: "S3: flipped — find the menu first, alternatives second" },
  { utterance: "when did I last note feeling bloated?", expect: "gap_report", note: "felt ≠ eaten (JOURNAL)" },
  { utterance: "how was my energy this week?", expect: "gap_report", note: "JOURNAL" },
  {
    utterance: "how many calories do I have left today?",
    expect: "nutrition_day",
    note: "S2: flipped from logs_day_summary — remaining is now a real tool",
  },
  { utterance: "is ramen okay for me?", expect: null, note: "dish check — profile, no tool" },

  // ── padding: unambiguous logs hits (keeps one flaky routing decision from
  //    burning the whole ≥90% margin — 5 misses allowed at 55 cases) ──
  { utterance: "what did I log for dinner on Tuesday?", expect: "logs_search" },
  { utterance: "have I eaten pasta this month?", expect: "logs_search" },
  { utterance: "list everything I ate yesterday", expect: "logs_search" },
  { utterance: "show my meals and totals so far today", expect: "logs_day_summary", note: "reworded in S2: bare 'totals' now also matches nutrition_day's description" },
  { utterance: "how much fiber did I get today?", expect: "logs_day_summary" },

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

  // ── S2 nutrition — direct hits ──
  { utterance: "how much protein do I have left today?", expect: "nutrition_day" },
  { utterance: "did I go over my calories yesterday?", expect: "nutrition_day" },
  { utterance: "do I have room for a burger tonight?", expect: "nutrition_day" },
  { utterance: "am I hitting my protein target this week?", expect: "nutrition_range_summary" },
  { utterance: "how have my calories looked over the past two weeks?", expect: "nutrition_range_summary" },
  { utterance: "what are my daily macros supposed to be?", expect: "nutrition_targets" },
  { utterance: "what's my calorie target?", expect: "nutrition_targets" },

  // ── S2 adversarial neighbours — boundaries that must hold ──
  {
    utterance: "how much protein have I had so far today?",
    expect: "logs_day_summary",
    note: "ate ≠ left — must NOT drift to nutrition_day now that it exists",
  },
  {
    utterance: "am I on track to reach my goal weight?",
    expect: "gap_report",
    note: "trend/prediction is S11 PROGRESS, not a 31-day adherence read",
  },
  {
    utterance: "change my calorie target to 2000",
    expect: "gap_report",
    note: "BODY_GOALS write — out of scope until post-S6; refuse + hand off",
  },

  // ── padding: unambiguous S2 hits (protects the ≥90% margin) ──
  { utterance: "how many carbs do I have left for the day?", expect: "nutrition_day" },
  { utterance: "how much protein should I be getting according to my plan?", expect: "nutrition_targets" },

  // ── S3 plan — direct hits ──
  { utterance: "what's for dinner tonight?", expect: "plan_get" },
  { utterance: "what's on my meal plan this week?", expect: "plan_get" },
  { utterance: "what am I supposed to have for breakfast tomorrow?", expect: "plan_get" },
  { utterance: "show me alternatives for tonight's dinner", expect: "plan_get", note: "must locate the menu row before plan_alternatives" },
  {
    utterance: "I ate today's planned dinner",
    expect: "plan_get",
    note: "confirm rule: find the dish, then PROPOSE marking done — the write needs a yes first",
  },

  // ── S3 adversarial neighbours ──
  { utterance: "regenerate my meal plan", expect: "gap_report", note: "OUT_OF_SCOPE refusal edge — link to Meal Plan tab" },
  { utterance: "skip tonight's dinner", expect: "gap_report", note: "JOURNAL (S4) owns skipped" },
  { utterance: "swap Friday's dinner for a restaurant meal", expect: "gap_report", note: "EXCHANGES (S10), not plan_swap_dish" },
  { utterance: "what should I buy for this week's plan?", expect: "gap_report", note: "GROCERY (S7)" },
  { utterance: "rate yesterday's lunch 4 stars", expect: "plan_get", note: "find the meal; the proposal must map stars → liked/disliked" },

  // ── padding: unambiguous S3 hits ──
  { utterance: "what's planned for lunch tomorrow?", expect: "plan_get" },
  { utterance: "is there anything I can have instead of tomorrow's breakfast?", expect: "plan_get" },
];
