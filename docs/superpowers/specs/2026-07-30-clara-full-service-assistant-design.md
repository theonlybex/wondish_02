# Clara Full-Service Assistant — Design (brainstorm checkpoint)

**Status: PARKED.** Direction, confirm policy, and v1 scope are user-approved
(2026-07-30). Architecture detail, wire contract, and task decomposition are
still open — resume the brainstorm from "Open questions" below before writing
the implementation plan. Another cycle takes priority first.

## Goal

Clara becomes a full-service assistant that knows the state of the whole
system and can act on it from chat, on both surfaces (web app + iOS app).
Examples that must work:

- "What did I eat two weeks ago?" → Clara searches meal logs and answers.
- User logs a meal, then asks Clara about it → Clara sees it immediately.
- "Add shellfish to my allergies" / "log that ramen for lunch" → Clara
  performs the change without the user leaving the chat.

## Decided direction: tool use, not prompt-stuffing

Today both Clara surfaces (web dish-checker/fridge + iOS chat) call the same
backend routes, and those routes inject the dietary profile into the system
prompt via `buildFoodMapText` (`lib/food-map.ts`). That read-only snapshot
cannot answer historical queries and cannot write.

**Chosen architecture:** the streaming chat route runs a server-side agentic
tool-use loop (Anthropic tool calling). Clara gets a typed toolbox; the server
executes tools against Prisma under the requesting user's auth. Because web
and iOS share one endpoint, the loop lives in exactly one place; clients keep
receiving a text stream.

Rejected alternatives:
- **Prompt-stuffing the whole state** — unbounded tokens, stale mid-chat,
  can't write.
- **RAG/embeddings over logs** — the data is relational and precisely
  queryable; retrieval adds infra for worse answers.

## Decided: write-confirmation policy

**Conversational confirm (option 1).** Clara proposes the action in prose
("That's about 550 kcal — want me to log it?") and executes the write tool
only after the user's affirmative reply in chat. Stateless; no new
confirmation UI on either client.

## Decided: v1 scope

**Read tools**
| Tool | Backs the question |
|---|---|
| search meal logs (date range / text) | "what did I eat two weeks ago" |
| get meal plan (today / week) | "what's for dinner tomorrow" |
| get dietary profile | queryable, in addition to the prompt snapshot |
| get journal entries | "when did I last note bloating" |
| get grocery list | "is oat milk on my list" |
| get supplements | "what am I taking in the mornings" |

**Write tools (all behind conversational confirm)**
- log a meal
- update dietary filters: add/remove allergy, food-to-avoid, preference
- add grocery list item

**Out of v1 (deliberate)**
- Anything touching money: orders, subscription.
- Account settings.
- Meal-plan regeneration — its pipeline is complex; Clara links the user to
  the surface instead.

## Standing rules that bind this cycle (cycle.md)

- Filter writes must flow through the same graph `lib/diet-match.ts` derives
  bans from — food-surface sync rule; server-enforced.
- Freemium gate stays server-side (`lib/freemium.ts`); tool-loop turns must
  respect the 402-before-token-spend contract.
- The existing chat wire contract is pinned for valid inputs; any new stream
  framing (e.g. "Clara is checking your logs…" status events) must be opt-in
  so existing clients keep byte-identical behavior.
- iOS DTO dates stay `String`.

## Open questions (resume here)

1. Stream framing: keep plain text and hide tool activity, or add opt-in
   status events so clients can show "checking your logs…"? iOS UI impact.
2. Tool-loop budget: max tool rounds per message; model choice per round;
   how tool tokens count against the free daily allowance.
3. Meal-log write shape: which source type does a Clara-logged meal use, and
   does the server price macros for free-text dishes (standing rule 3 covers
   RECIPE/RESTAURANT; Clara logs may be CUSTOM)?
4. Filter-write vocabulary: Clara must map free text ("shellfish") onto the
   canonical `FoodAllergy`/`FoodToAvoid` rows — fuzzy match + confirm, or
   propose the nearest canonical names only?
5. Date semantics for "two weeks ago" — resolve in the user's timezone;
   where does the tz live today?
6. Does the fridge/cook route get the same toolbox, or chat only in v1?

## Process note

Per cycle.md this feature enters as a normal cycle: this spec (finished) →
plan doc under `docs/superpowers/plans/` → engine tasks (wondish_02) →
surface tasks (Clara iOS) → reviews → audit → merge. The iOS repo lives at
`~/Desktop/BeTech/Clara` (cycle.md's `NewView` path is stale).
