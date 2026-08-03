# Clara S3 — Meal Plan Skill (design)

**Status: user-approved 2026-08-03** (tool split, exchange overlay, confirm guard).
Third skill cycle on the C0 runtime; first write cycle since S1. Program spec:
`docs/superpowers/specs/2026-07-30-clara-full-service-assistant-design.md` (§3 S3).
Wave order holds — the gap ledger is 2 days old, below the §8 Q12 re-rank threshold.

## Goal

Clara reads and acts on the user's meal plan from chat, on both surfaces:

- "What's for dinner tomorrow?" → the actual planned dish — including the
  exchanged-in restaurant/fridge dish when a resolved plan-exchange displaced it.
- "Swap Wednesday's lunch" → propose ≤3 valid alternatives → confirmed swap.
- "I ate the planned dish" → confirmed journal completion (`plan_mark_done`),
  with the intake row (`plan_log_eaten`) as a separate, also-confirmed action.
- "Rate that dish" → like/dislike on the completion row (binary is all the app has).

## Resolved decisions (user, 2026-08-03)

1. **Completion and intake are two separate tools.** `plan_mark_done` writes the
   `JournalMeal` completion (+ optional rating); `plan_log_eaten` writes the
   `MealLog` intake row (source `RECIPE`). The app models these as independent
   actions (web: rate buttons vs "Add to log") and Clara mirrors that. The
   fragment tells Clara to ask once whether to also count it as eaten intake —
   never to assume one implies the other. This **supersedes the program spec's
   tie-breaker note** "plan_mark_done … writes the completion, intake follows":
   intake follows only by a second confirmed tool call.
2. **`plan_get` overlays resolved exchanges (read-only).** Reuses
   `getExchangesForRange` (lib/plan-exchanges.ts) exactly like the web's
   `DailyMealPlanView`: a RESOLVED exchange presents the exchanged-in dish as the
   day's actual meal (flagged restaurant/fridge), pending exchanges are listed.
   Exchange WRITES remain S10.
3. **Minimal structural confirm guard ships now** (S1 carried ticket). `ToolDef`
   gains `isWrite?: true`; the loop refuses to execute a write tool when the
   request's message history contains no prior assistant turn — a first-turn
   write can never have been proposed and confirmed, so the check has zero false
   positives. The refusal is a typed ToolResult the model narrates into a
   proposal. S1's `logs_create`/`logs_delete` adopt the flag. Prompt rule, eval
   proposal assertion, and rate caps remain the broader net.

## The skill

One file `lib/clara/skills/plan.ts` + one `ALL_SKILLS` entry. Skill name /
`CLARA_SKILLS` token: `plan`. Handlers follow the injected-deps factory pattern
(`makePlanHandlers(deps)`). **No migration** — no schema change anywhere in S3.

### Reuse via extraction (the one real refactor)

Completion, alternatives, and swap-validation logic live inline in routes today;
duplicating them in the skill is a review failure (program §1). S3 extracts:

| Helper | New home | Extracted from | Shared by |
|---|---|---|---|
| `upsertMealCompletion(patientId, {recipeId, mealTypeName, date, rating})` | `lib/journal.ts` | `app/api/journal/log-meal/route.ts` | route + `plan_mark_done` |
| `findAlternatives(patient, {mealTypeId, excludeRecipeId, currentCalories})` | `lib/meal-plan.ts` | `app/api/meal-plan/alternatives/route.ts` | route + `plan_alternatives` |
| `validateSwapCandidate(patient, menu, recipe)` | `lib/meal-plan.ts` | `app/api/meal-plan/[menuId]/swap/route.ts` | route + `plan_swap_dish` |

Routes are refactored to call the helpers with behavior pinned by route tests
written BEFORE the extraction (parity first, then reuse). One deliberate
divergence: `upsertMealCompletion` accepts `rating: 1 | -1 | null` (Clara can
mark done without a rating; the row stores `rating: null`, which every consumer
already tolerates) while the HTTP route keeps requiring `1 | -1` — its toggle
contract is unchanged.

### Tools (5)

| Tool | Contract |
|---|---|
| `plan_get` | Inputs: `date` ("YYYY-MM-DD", defaults `ctx.today`) OR `weekStart` (7-day window). Menu rows for the patient's `activePlanVersion` with recipe name, meal type, per-meal macros, `menuId`, completion state (from that day's `JournalMeal` rows), and the exchange overlay (decision 2). Empty plan / no active plan → `ok:true` with an empty list and a narratable note pointing at the Meal Plan surface. |
| `plan_alternatives` | Input: `menuId` — obtainable only from a `plan_get` in this conversation. Runs `findAlternatives` (meal-type match, ±250 kcal band, ban filtering) → ≤3 candidates with `recipeId`, name, macros. Zero candidates is `ok:true` + empty list ("no good alternatives right now"). |
| `plan_mark_done` ✍️ | Inputs: `menuId`, optional `rating: "liked" \| "disliked"`. Resolves the menu row (ownership + active version), then `upsertMealCompletion` for that recipe/date. Re-marking with a different rating updates it; no undo tool (the web toggle covers that). Star-scale phrasings → Clara asks liked/disliked. |
| `plan_log_eaten` ✍️ | Inputs: `menuId`, optional `servings` (default 1). `MealLog` via the S1 funnel (`parseMealLogInput` → `resolveSnapshot` with the recipe → `buildMealLogUpsertArgs`), source `RECIPE`, recipe-priced macros, `clientRequestId: "clara:" + toolUseId`. Independent of `plan_mark_done` (decision 1). |
| `plan_swap_dish` ✍️ | Inputs: `menuId`, `recipeId` — the recipeId obtainable only from `plan_alternatives` in this conversation. `validateSwapCandidate` enforces: menu ownership + active version, recipe public, meal-type match, diet-ban pass, ≤50pp macro deviation. Typed failures for each rejection so Clara can explain why a candidate was refused. |

**Write cap:** all three writes share `clara-plan-write`, 30/hour per patient
(same shape as S1's `clara-logs-write`; fails open on Redis outage).

### Confirm guard (runtime, rule-8 amendment)

- `types.ts`: `ToolDef.isWrite?: boolean`.
- `loop.ts`: before executing a tool whose def has `isWrite`, check the round's
  request messages: if there is **no assistant message** in the history, do not
  execute; produce `{ok:false, reason:"CONFIRM_REQUIRED", message:"Propose the
  action and get the user's confirmation first."}` as the tool result. The model
  sees it next round and proposes — which is the correct conversational move.
- `ToolResult` reason union gains `"CONFIRM_REQUIRED"`.
- Flag adopted by: S3's three writes, S1's `logs_create` + `logs_delete`
  (cross-skill touch, recorded), and every future write skill by contract.
- Tests pin: guarded tool on first turn → not executed + typed result; same tool
  with any prior assistant turn → executes; read tools unaffected.

### Recognition (spec §4 obligations)

- **Tie-breaker PLANNED row becomes skill-conditional** (dark-launch discipline):
  plan active → "what's for dinner / planned / swap → plan_ tools (plan_get to
  find the meal, plan_alternatives before proposing a swap)"; off → today's
  gap_report (MEAL_PLAN) text.
- **"I ate the planned dish" boundary:** plan active → `plan_mark_done`, and the
  fragment's rule: ask once whether to also log it as intake (`plan_log_eaten`);
  unplanned food stays `logs_create`. The eaten-row in the tie-breaker table
  updates accordingly (conditional on BOTH logs and plan states — four
  combinations, each coherent).
- **Refusal edges in the fragment:** plan regeneration → refuse + point to the
  Meal Plan surface + `gap_report(MEAL_PLAN, OUT_OF_SCOPE)`; "skip dinner"
  markings → `gap_report(JOURNAL)` (S4); star-scale ratings → ask liked/disliked.
- **Routing fixture: +12–16 utterances.** Flips: "what's for dinner tomorrow?"
  and "swap Wednesday's lunch for something else" from `gap_report` to plan
  tools. Adversarial: "log that ramen for lunch" stays the S1 confirm-proposal
  case; "what did I eat yesterday" stays `logs_search`; "I ate today's planned
  dinner" → `plan_mark_done` (with history showing a prior proposal);
  "regenerate my plan" → `gap_report`. Audit re-runs the whole accumulated set;
  ≥90% or Critical.
- `CATEGORY_TO_SKILL` gains `MEAL_PLAN: "plan"`.

### Round budget

Worst case ("swap Wednesday's lunch", turn 1): `plan_get` (find the menu row) →
`plan_alternatives` (candidates) → forced final answer proposing options — fits
the 2-round free budget exactly. Turn 2 (user picks + confirms): `plan_swap_dish`
in one round. Every other ask is 1 round + answer.

## Surface impact

**None — explicit no-client-change declaration.** Swaps, completions, and intake
rows surface on the clients' next fetch through existing routes. Chat output is
prose on the existing stream. The Clara iOS repo is untouched. Live smoke on the
release gate covers: a Clara swap appearing in the web plan view, and a
`plan_log_eaten` row appearing in journal/stats with source `RECIPE`.

## Out of scope (S3)

Plan regeneration (refusal edge) · exchange writes (S10) · "mark as skipped"
(S4 Journal) · named-dish swap by free-text recipe search (alternatives-only in
v1; gap demand decides) · batch operations ("mark the whole week done") ·
grocery implications of swaps (S7).

## Error taxonomy (typed `ToolResult`)

`INVALID_INPUT` (bad date, unknown rating value) · `NOT_FOUND` (menuId/recipeId
gone, not owned, or stale plan version) · `OUT_OF_RANGE` (weekStart window
violations) · `CONFIRM_REQUIRED` (guard, new) · `FAILED` (rate cap, unexpected).
Swap validation failures are `INVALID_INPUT` with the specific human reason
(meal-slot mismatch / contains banned ingredients / macros misaligned) so Clara
explains rather than retries blindly.

## Testing

- **Parity first:** route tests for log-meal, alternatives, and swap pinning
  current behavior BEFORE extraction; unchanged after refactor.
- Handler units via injected deps: get (day/week, overlay merge, completion
  state), alternatives (id-from-conversation contract, empty result), mark-done
  (rating map, null rating, re-rate), log-eaten (RECIPE funnel, dedupe key,
  servings), swap (each validation failure typed distinctly).
- Guard tests in loop.test.ts (first-turn block, post-assistant-turn pass,
  reads unaffected) + S1 write tools flagged.
- Schema contract test (5 defs, no identity params, isWrite on exactly 3).
- Registry: four logs×plan flag combinations emit coherent tie-breakers.
- Loop round-trip: plan_get → answer; propose → confirm → swap across turns.
- Routing eval at audit over the whole accumulated fixture (real key).

## Process

Per cycle.md: this spec → plan doc `docs/superpowers/plans/2026-08-03-clara-s3-plan.md`
→ engine tasks on branch `cycle-clara-s3-plan` (E1 extraction+parity, E2 skill
file, E3 guard+wiring, E4 fixture) → per-task reviews → final whole-branch review
(write-path reviewer required this cycle) → audit → merge. Post-merge: watch
`/admin/clara-gaps` — MEAL_PLAN rows should collapse; NUTRITION rows are the S2
control.
