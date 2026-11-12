# Clara dishes: fast, and a dish every time

Branch `feat/clara-fast-dishes`, 2026-11-12. The owner's instruction: *"we cant make it slow it has to be fast,
think of the way to give dishes everytime and run simulation to see if the decision works"*.

## Result in one table

Same 40 people (30 with several restrictions), one `dish_suggest` each plus 8 `dish_plan_today` (two dishes each):
56 dishes asked per arm. Real model, in-memory store (no database).

| | Before (`main`: Haiku 4.5, one forced-tool call, 3 dishes) | After (this branch: Haiku 5.5, new design, 8 s budget) |
|---|---|---|
| Got a dish | **50/56 (89%)** | **52/56 (93%)** |
| … generated dish / library dish | 50 / 0 | 51 / 1 |
| Hard profiles that got a dish | 36/42 (86%) | 38/42 (90%) |
| No dish while the library had one | (no library path) | **0** |
| Time until the dish: p50 / p95 / max | 16.6 s / 19.8 s / 22.0 s | **3.4 s / 7.3 s / 7.5 s** |
| Model call: p50 / p95 / max | 16.2 s / 19.7 s / 22.0 s | 3.3 s / 7.2 s / 7.4 s |
| Cost per model call | $0.0131 | **$0.0007** |
| Unparseable model output | 0 of 56 calls (1 in 6 in the earlier sample) | impossible by construction (0 of 56) |
| Oracle violations (served dish breaks a rule) | **0** | **0** |

Every "no dish" left in the after arm is a case where **both** paths are empty (below).

### Design versus model (like-for-like, the 28 hard `dish_suggest` asks)

The owner moved every Haiku call to Haiku 5.5 during this work. To separate the effect of the design from the effect of
the model, the new design also ran on Haiku 4.5 for the same 28 hard asks (the call cap did not allow the full 56):

| Same 28 hard asks | Before: old design, Haiku 4.5 | New design, Haiku 4.5 (8 s budget enforced live) | New design, Haiku 5.5 |
|---|---|---|---|
| Got a dish | 25/28 (89%) | 26/28 (93%) | 26/28 (93%) |
| … generated / library | 25 / 0 | 24 / 2 | 26 / 0 |
| Time until the dish p50 / p95 / max | 16.7 s / 19.8 s / 22.0 s | 5.0 s / 8.0 s / 8.0 s | 3.6 s / 7.4 s / 7.5 s |
| First fitting dish p50 / p95 / max | — | 4.8 s / 7.0 s / 7.7 s | 3.5 s / 6.8 s / 7.5 s |
| Time to first token p50 / p95 | — | 1.4 s / 1.9 s | 1.3 s / 2.3 s |
| Input tokens per call | 2,672 | 2,400 | 3,177 (newer tokenizer, ~30% more for the same text) |
| Cost per call | $0.0135 | $0.0051 | $0.0007 |
| Violations | 0 | 0 | 0 |

- **The design is what makes it fast and reliable**: on the same model (Haiku 4.5) the wait drops from 16.7 s to
  5.0 s (p50) and from 19.8 s to 8.0 s (p95), and the share with a dish goes from 89% to 93%. Two of the 28 got the
  library dish because the model ran into the 8 s budget (vegan+celiac breakfast; dairy+egg+nut breakfast).
- **Haiku 5.5 adds speed and cost on top**: about 1.4 s faster at p50, never past the budget in this run, and 7×
  cheaper per call than Haiku 4.5 with the same design. **Not better on everything**: in the full after run its
  candidates were refused by the safety filter more often (15 of 84 streamed candidates, 18%, versus 3 of 35, 9%, for
  Haiku 4.5 with the same prompt), mostly by writing a forbidden word anyway ("Garlic **Butter-Free** Salmon" for a
  dairy allergy, "soy sauce, sesame oil" for keto+dairy), and once it declared `"fiber": 180` for one serving (now
  refused, see below). The gates caught all of it; it costs time, not safety.

## What was built (`lib/clara/skills/dish.ts`, `lib/clara/dish-output.ts`, `lib/clara/dish-library.ts`)

1. **Malformed output made impossible.** The generator answers through structured outputs
   (`output_config.format` with a strict JSON schema; supported on Haiku 4.5 and 5.5 per the claude-api skill, works
   in SDK 0.96.0). Per-item validation is unchanged: every item still goes through `parseFridgeRecipes` and every gate.
   The schema is leaner than the fridge schema: each ingredient carries its own `{name, quantity, unit}` with the unit
   from a fixed list, so "ingredient without an amount" and "amount spelt differently" can no longer drop a dish; the
   server sets the meal type and servings it asked for.
2. **Streamed and stopped early.** Each dish is gated the moment its closing brace arrives (`DishItemExtractor`), and the
   call stops at the first gated dish that passes the card's own test (`pickDish`: time, servings). Asking for 3 costs
   nothing extra when the first fits (51 of 56 calls stopped after one or two dishes), and the 2nd and 3rd are there
   when it does not. Still one model call, no retry.
3. **Forbidden words in the prompt** from the same ban data the gate judges with (`bannedNamesForPrompt` + every allergy
   matcher term), with the rule that plant-based and "-free" versions are out too ("coconut milk" for a dairy allergy).
   The gate is untouched and has the final say. "Coconut milk" appeared in the before arm's raw candidates for
   dairy-allergic people and was refused each time; after, it appeared in 0 of Haiku 5.5's 84 candidates and once in
   Haiku 4.5's 35 (refused). The model still sometimes writes a forbidden word (above), and the gate refuses it.
4. **Repair, not drop, where deterministic**: the structural repair in (1) (amounts carried per ingredient, meal type
   and servings set by the server). No safety failure is ever repaired.
5. **Library safety net, no second model call.** Started at the same moment as the model call: the public recipes for
   that meal type (cached in-process for 10 minutes), filtered by the **meal planner's own rule filter** (not
   disliked; `evaluateDishAgainstProfile` over the catalog ingredient names *and* their stored allergen groups), with
   complete data only (every amount, steps, a fibre figure not above the carbs, no editing notes in the name), not one
   of the person's dishes from the last 7 days; ranked by the levels (fibre-rich ingredient when they get little fibre,
   nothing salty when they get a lot of sodium), the asked time, and for several servings steps without amounts; then
   put through **every gate a generated dish passes** (`gateGeneratedDishes`, oil repair included) and `pickDish`.
   It is held to the stricter of both paths. Served through the same card, with its stored amounts per serving, steps
   and macros.
6. **Time budget: 8 s per dish** (`DISH_BUDGET_MS`), enforced by aborting the model request; what was gated before the
   deadline still counts; a generator that ignores the abort is cut off 300 ms later; the library gets at most 1.5 s
   beyond the budget. `dish_plan_today` runs each meal's dish with its own budget, in parallel, and the person is
   loaded once per tool call.
7. **Wording**: the dish part is unchanged on the wire. The tool result the model reads gains `source`
   (`"generated"` / `"library"`), and for a library dish a note: *never say you made, created or invented it for them;
   say it is a recipe from the library*. Reasons stay about intake.

### The time budget: why 8 s

Measured on Haiku 5.5 without a deadline (the run recorded when each first fitting dish arrived): first fitting dish
p50 3.3 s, p95 6.0 s, max 7.5 s; whole model call max 7.4 s (including the calls where no candidate fit). Replaying
the same 56 asks at other budgets:

| Budget | Got a dish | Generated / library | Time until the dish p95 / max |
|---|---|---|---|
| 5 s | 52/56 | 44 / 8 | 5.0 s / 6.8 s |
| 6 s | 52/56 | 48 / 4 | 6.0 s / 6.8 s |
| **8 s** | **52/56** | **51 / 1** | **7.3 s / 7.5 s** |

8 s sits above every first fitting dish observed, so the budget only cuts outliers (an overloaded API, a slow stream)
and the person still has a dish by 8 s. The share with a dish does not depend on the budget (the library is always
ready); a shorter budget trades generated dishes for library dishes. 6 s is the alternative if the chat turn needs the
time; with Haiku 4.5 the same 8 s budget cut 2 of 28 calls to the library.

## Every case that still ended with no dish

| Ask | Before | After | Why |
|---|---|---|---|
| every rule at once (9 allergies, vegan, keto, paleo, kidney, hypertension, diabetes, celiac, IBS-D, 4 avoids) · suggest dinner, plan lunch, plan dinner | none ×3 | none ×3 | every candidate refused by the safety filter (e.g. "meatless chicken" — soy/wheat), and no library recipe passes |
| paleo + egg + tree-nut allergies · breakfast | none | none | 3 candidates refused by the safety filter (5.5) / other gates (4.5); no library breakfast passes |
| dairy + egg + nut allergies · breakfast | none | **got a dish** (generated on 5.5; library on 4.5) | |
| celiac + dairy + eggs · plan breakfast (eating out) | none | **got a dish** | |

The honest "couldn't make one that fits" now appears only when both paths are empty.

## Candidates through the gates (streamed candidates only; the new code stops early)

| Arm | Produced | Unparseable | Refused by safety filter | Dropped by other gates | Failed the card | Accepted |
|---|---|---|---|---|---|---|
| Before (old, 4.5) | 168 | 0 | 21 | 29 | 4 | 114 |
| After (new, 5.5) | 84 | 0 | 15 | 18 | 0 | 51 |
| New design on 4.5 (28 asks) | 35 | 0 | 3 | 8 | 0 | 24 |

## Offline simulation (`npm run sim:clara-first`, `SIM_PAIRS=0 npm run sim:rules`)

Both pass. The Clara sim's fake model now streams the structured answer and, besides the earlier modes (violating
first, allergen slipped into a step, "cooking oil", library dish, all-violating), sometimes returns **nothing**,
**output that is not the schema**, or **hangs until the deadline aborts it**. 326 dish tool calls: 314 dishes served
(136 generated, 178 library), **0 breaking a rule**; 151 plain asks had at least 10 complete rule-compliant library
recipes (independent oracle) and every one got a dish (`dish.always-a-dish`); 10 "couldn't make one", 8 of them with
an empty library (the other 2 asked for guests or a time limit, where the library is narrower). New invariants:
`dish.source`, `honesty.library-not-made`. Unit tests: `lib/clara/skills/dish-fallback.test.ts` (budget abort, a
generator that ignores the abort, partial results at the deadline, both-empty message, per-meal fallback in a plan,
the stream extractor under any chunking, the strict schema, forbidden words, the library filter and ranking).

## Calls and cost

140 live model calls, the cap: 56 before (Haiku 4.5, $0.736), 56 after (Haiku 5.5, $0.039), 28 new design on Haiku
4.5 ($0.144). About **$0.92** in all. Output tokens of a stream stopped early are not reported by the API; they are
estimated from the streamed characters at the run's own chars-per-token (2.18 on Haiku 5.5 from its completed calls;
2.8 for Haiku 4.5, i.e. 2.18 × the ~1.3 tokenizer ratio, since none of its 28 calls ran to the end).

**Prompt caching** was not added: the system prompt is per person and per meal (food map, bans, levels, servings), so
the reusable prefix is a few hundred tokens and each request would pay a cache write for little read-back; on Haiku 4.5
the minimum cacheable prompt (4,096 tokens) is above the whole prompt. Time to first token is 1.3 s (p50) already.

## What changed from the brief, and advice

- Added **streaming with early stop**. Not in the brief, and the largest latency win: the first dish is served while
  the model would still be writing the other two.
- Kept **3 candidates** rather than fewer: with early stop the extra ones cost nothing unless they are needed, and they
  are needed (in the after run 14 dishes were a 2nd or 3rd candidate, after the 1st was refused).
- A dish declaring **more fibre than carbs** is refused (live: `"fiber": 180`); the card logs that figure and no
  deterministic repair exists.
- The **budget is 8 s**, not the 6 s p95, so that a slow but good generated dish is not traded for a library dish; 6 s
  is a one-line change.

## What this simulation cannot show

- **Real database latency for the library**: here the pool is in memory. In production the first dish of each server
  instance loads the meal type's public recipes with their ingredients (about 300–1,400 rows) and the catalog names;
  both are then cached for 10 minutes. That load runs in parallel with the model call, and the fallback waits for it
  at most 1.5 s past the budget, but its real duration is unmeasured. The ranking and gating took up to ~0.4 s of CPU
  in the simulation.
- **The real chat loop**: the dish tool runs inside a Clara chat turn; the model's own rounds before and after the tool
  (now Haiku 5.5 at effort low) add to what the person waits. Not run here.
- **Model drift**: 140 calls on one day. Haiku 5.5's refusals (`stop_reason: "refusal"`, no server-side fallback) were
  not seen; the generator logs them and the library covers them.
- One after-arm row (vegetarian, no eggs/dairy, suggest) ran before the fibre check existed and was served the dish
  that declared 180 g of fibre; the shipped code would refuse it and serve the next candidate or the library dish
  ("Brown Rice Porridge with Spinach, Sweet Potato, and Olive Oil" was ready).
- Cached library: a recipe made private can still be offered for up to 10 minutes on a warm instance.

## Files

- Product: `lib/clara/skills/dish.ts`, `lib/clara/dish-output.ts`, `lib/clara/dish-library.ts`
- Tests: `lib/clara/skills/dish-fallback.test.ts`
- Simulation: `sim/clara-fast-live.sim.ts` (live arms; runs on `main` too), `sim/clara-fast-people.ts` (the 40 people),
  `sim/clara-fast-report.ts` (tables and budget replay), `sim/clara-first.sim.ts` + `sim/clara-dishes.ts` (offline
  fake model: streams, nothing, garbage, hang)
- Raw rows (git-ignored): `sim/.snapshot/fast-before-4.5.jsonl`, `fast-after-5.5.jsonl`, `fast-after-4.5.jsonl`

Reproduce the tables: `node --import tsx sim/clara-fast-report.ts sim/.snapshot/fast-after-5.5.jsonl --budget=8000`
(and `--match=sim/.snapshot/fast-after-4.5.jsonl` for the like-for-like subset).
