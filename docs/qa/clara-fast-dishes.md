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
   nothing salty when they get a lot of sodium) and the asked time. Steps that state amounts are allowed only for a
   one-serving recipe asked for one person (review fix I1: a 4-serving recipe saying "add 1 teaspoon salt" is never
   shown with a ¼-teaspoon card). Then put through **every gate a generated dish passes** (`gateGeneratedDishes`, oil
   repair included) and `pickDish`; the allergen groups for every ranked candidate load in one query, and nothing
   more is queried once a generated dish has been served (review fix I4). It is held to the stricter of both paths.
   Served through the same card as a generated dish: the stored amounts divided by the recipe's servings and the
   stored steps; calories and macros **priced from those amounts** where pricing covers the dish (the stored figures
   only otherwise) and sodium **computed** the same way (null unless fully known) — only fibre is the stored figure,
   and it is refused if it is above the declared or the priced carbs.
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

## Review fixes (after the first report)

- **I1** library: no multi-serving recipe whose steps state amounts for one person (or any recipe with step amounts for
  several people) — a hard filter in `rankLibrary`, so neither the card nor the cook-mode recipe can disagree with its steps.
- **I2** chat loop: the final round keeps the **same tools** (Haiku 5.5 binds thinking blocks to the system, tools and
  earlier messages; `tools: []` on the last round could be a 400) and gets `TOOL_BUDGET_SPENT_NOTE` as a text block after
  the last tool results — append-only, and a text block cannot 400 on any model, where a mid-conversation `role: "system"`
  message (also append-only per the claude-api guide) is a 400 on models without it. A tool call on that round is still
  never executed (local hard stop).
- **I3** tests against the real safety code: `lib/clara/skills/dish-live-gates.test.ts` (in-memory Prisma, fake stream).
- **I4** library work stops once a generated dish is served; one allergen-groups query; recent dishes once per call.
- Minors: fibre also checked against the priced carbs; refusals logged (category only, no user content) in chat and the
  dish generator; the dish tool descriptions say "suggest", made now or from the library, and point at `source`.

## Haiku 5.5 smoke checks

`sim/clara-haiku55-smoke.sim.ts`, real model, in-memory store only (database URLs removed), one vegetarian person with
egg and dairy allergies. **14 live calls** (cap 24), no retries (every call counted). No 400 anywhere.

| Site | Ran? | Result | Latency |
|---|---|---|---|
| Clara chat, plain turn (real loop, all tools, effort low) | yes | `end_turn`, sensible two-sentence answer, no tool | TTFT 0.7 s, total 1.1 s |
| Clara chat, `dish_suggest` (generated) | yes | `tool_use` → dish generated (Chickpea and Tomato Skillet with Quinoa) → `end_turn`; says nothing is logged yet | TTFT 1.5 s; total 7.1 s (dish call 4.5 s, stopped at the first fitting dish) |
| Clara chat, `dish_suggest` with a **library** dish | yes | Honours `LIBRARY_NOTE`: *"Here's a lunch idea from the Wondish recipe library: Garbanzo Beans with Kale, Bell Peppers and Cucumbers."* — no "made for you" | total 2.1 s |
| Clara chat, tool-round limit (maxToolRounds 1, three tools asked) | yes | Round 1 called 3 tools in parallel (numbers, today's log, `dish_plan_today`); the final round (same tools + budget note) answered with `end_turn` and called no tool; no 400. In the plan reply the library lunch was again called "a recipe from the Wondish library" | round 1 TTFT 2.5 s; final round TTFT 3.1 s; total 12.9 s (3 dish calls in parallel inside) |
| Feedback triage | yes | `tool_use` (forced, thinking skipped as documented); WRONG_FOOD / MEDIUM, sensible title | 1.5 s, 264 out tokens |
| Fridge route (same call style as cook-day and clara-swap: forced tool, thinking disabled, 5,376 max tokens) | yes | 200, three recipes, all compliant after the filter | 5.1 s, 1,180 out tokens |
| Meal-plan swap (`clara-swap`) | **no** | Reads `menu`/same-day menus and writes the chosen recipe; the in-memory store does not model menus and refuses writes. Exercising it needs the real database — not done. The fridge row covers its call shape. | — |
| Cook-day | **no** | Reads pantry rows and writes recipes; same reason. The fridge row covers its call shape. | — |
| Recipe-generation top-up (8 lunches, the largest chunk) | yes (model call only) | `tool_use`, 8 dishes, 5,605 out tokens — inside the new 10,752 cap (would have been 68% of 8,192 before). All 8 were then rejected by the allergen filter, **an artifact of the smoke**: it passed an empty prompt ban list, so the model was never told the person is vegetarian with egg/dairy allergies; persistence was not reached (read-only store) | 19.0 s |

Not verifiable here: whether the chat rounds carried thinking blocks at effort low (the adapter does not expose them),
so the "no 400" on the final round shows the request shape is accepted, not that a replayed thinking block was checked.

## Asking to cook something particular (`wants`), 2026-11-12

The owner asked Clara "help me cook eggs" and got a text answer: no dish card, so cooking mode never opened.
`dish_suggest` now takes an optional `wants` (what they asked to cook, in their words, 1 to 80 characters), and the
tool description, the skill's prompt text and the routing table send "help me cook eggs", "how do I make pancakes",
"cook salmon with me" to it. A plain technique question ("how long do I boil an egg?") is still answered in text.

`wants` travels the same path as `maxMinutes`: handler → `DishAsk` → generator prompt (one added line, "THE REQUEST")
→ library ranking → the pick. The gates, the 8 s budget, the structured output and the early stop are the same code.

What the tool returns with `wants`:

| Situation | Result |
|---|---|
| A generated dish that says the request passes the gates | The dish card, `source: generated`, `askedFor`, `answersRequest: true`, and a `request` note: say it is a way to cook that which fits them |
| No such generated dish, but a library recipe matches the request (every food word of the request is in its name or ingredients) | The library dish, `source: library` with the library note, `answersRequest: true` |
| Only a fitting generated dish whose name and ingredients do not say the request (a gate can rename a dish from its ingredients) | That dish, `answersRequest: false`, and a note: say so plainly, never present it as what they asked for |
| Nothing fits and no library recipe matches | `ok: false`, `FAILED`: "I couldn't put together "<wants>" in a way that fits them right now, and no library recipe matches it…" (no card; an unrelated library dish is never served for a request) |
| What they asked for names something their own rules forbid ("eggs" with an egg allergy) | `ok: false`, `FAILED`, before any model call: "What they asked to cook ("eggs") does not fit them: it goes against their profile (allergy: egg). No dish was looked for…" Clara says why and offers a dish that fits |

The conflict check uses the same matchers as the gates (`evaluateDishAgainstProfile` over the request, plus the
catalog's allergen groups). It is a pre-check only: every served dish still passes every gate. Without `wants`
nothing changes.

### Live check (`sim/clara-cook-request-live.sim.ts`)

Real model (`claude-haiku-5-5`) through the real chat loop and the real dish handler, in-memory store only.
**12 live calls** in total (9 + 1 + 2), no retries, about $0.011.

| Case | `dish_suggest` called | Dish came back | Time (whole turn / dish tool) | Rule check |
|---|---|---|---|---|
| "help me cook eggs", no restrictions | yes, `wants: "eggs"`, breakfast | Scrambled Eggs with Butter and Chives (generated), 4 steps, 1 timer; reply opened "Here's a way to cook eggs that fits you" | 6.4 s / 3.0 s | pass |
| "help me cook eggs", egg allergy | yes, `wants: "eggs"` | no dish, no model call for one: the conflict result; Clara said eggs are on the allergy list and offered a breakfast that fits | 2.9 s / 9 ms | no dish served |
| "how do I make pancakes", coeliac | yes, `wants: "pancakes"` | Eggs with Greek Yogurt and Almond Flour (generated), `answersRequest: false`; Clara said she could not come up with a pancake recipe and named what she had instead | 6.2 s / 2.7 s | pass (no wheat, no gluten grain) |
| "What should I eat?" (control) | no: Clara asked which meal it is for | no | 2.3 s | no dish served |
| "What should I eat for dinner?" (control, stopped after the tool) | yes, no `wants` | Lemon Herb Chicken with Roasted Potatoes and Green Beans (generated); no request line in the generator prompt | 4.0 s / 2.5 s | pass |

One more call ran the generator alone for the coeliac pancakes ask, with a trace: it wrote "Egg and Greek Yogurt
Pancakes", "Cottage Cheese and Egg Pancakes" and "Black Bean and Egg Pancakes", and all three passed the gates under
those names. So the model does write pancakes; in the chat run the served name had lost the word. After that run the
pick was changed to prefer a dish that still says the request (then a matching library recipe, then the flagged
dish). **That change is covered by unit tests only; it was not re-run live** (the 12-call cap was used up).

Not shown here: the first control did not call the tool for a bare "What should I eat?" (it asked which meal). Whether
that is new or how it already behaved was not measured; nothing in this change touches the no-`wants` path.

## The intent router (deterministic tool choice), 2026-11-12

The model was deciding whether to call the dish tools, and sometimes answered in text. `lib/clara/intent.ts`
(`detectIntent`) now reads the latest user message with patterns (no model call, no I/O). When it names a tool and the
dish skill is on, the chat service forces that tool on the **first round only** (`tool_choice: {type: "tool"}`); the
model still writes the arguments, and later rounds are unforced. Haiku 5.5 accepts a forced tool with adaptive thinking
left on (the reply then starts with the tool call and has no thinking block), so nothing else about the request changes.

| The person writes | Forced on round 1 |
|---|---|
| A request to cook a named thing: "help me cook eggs", "cook salmon with me", "how do I make pancakes", "how to make an omelette", "I want to make a lentil soup", "let's cook pasta", "recipe for chicken curry", "chicken curry recipe", "make me a smoothie", "help me make dinner with rice" | `dish_suggest`; the router's food phrase is filled in as `wants` if the model leaves it out (the model's own `wants` is kept) |
| The same with no food left ("help me cook", "let's cook", "help me make dinner") | `dish_suggest`, no `wants` |
| What to eat: "what should I eat", "what can I cook tonight", "give me a dinner idea", "suggest a lunch", "any dinner ideas", "I'm hungry" | `dish_suggest`, no `wants` |
| Another dish: "something else", "another one", "a different dish" | `dish_suggest`, only when this chat already has a dish; the names already shown are passed as `avoid`, and a dish with one of those names is never served |
| Plan the day, with the day described: "plan my day, we have guests tonight" | `dish_plan_today` |
| Plan the day, nothing said about today: "plan today's dishes", "plan my day", "what should I eat today", "plan my meals for today" | `ask_choices` ("Anything happening today?" with its four boxes); the plan runs after the answer, as before |

Never forced (the message stays with the model): technique and fact questions ("how long do I boil an egg?", "is
salmon ok for me?", "can I eat eggs with IBS?"); anything naming the saved meal plan, the log, the journal, numbers,
nutrients, pills, weight, shopping; negations ("I don't want to cook"); reports of something already eaten or cooked ("I
cooked eggs", "I made pasta yesterday"); the app's own "Cook this with me: …" message; any reply to a question Clara
just asked (answer boxes, or a saved reply ending in "?"); messages over 200 characters; a thing to cook longer than 6
words; the dish skill switched off. When unsure the router returns nothing.

Meal with no meal named: the prompt now carries one line with the meal for the person's local time (breakfast
04:00–10:29, lunch 10:30–14:59, otherwise dinner, from the offset the app sends) and tells Clara not to ask which meal.
With no offset it only tells her not to ask.

Each forced turn logs `[clara-intent] forced <tool>` (plus `(wants)`), never the message.

### Live check (16 calls, fake DB, `COOK_SET=router`, local time set to 18:30)

| Message | Router | Forced tool called | Card | Time (turn / dish tool) | Rule check |
|---|---|---|---|---|---|
| "help me cook eggs" | `dish_suggest`, fill `wants: eggs` | yes (`breakfast`, `wants: "eggs"`) | Scrambled Eggs with Butter and Chives | 5.1 s / 2.7 s | pass |
| "how do I make pancakes" (coeliac) | `dish_suggest`, fill `wants: pancakes` | yes | Greek Yogurt Pancakes with Eggs (says the request) | 3.7 s to the card / 2.6 s (closing round not run) | pass |
| "What should I eat?" (no meal named) | `dish_suggest` | yes (`dinner`, from the local time; no "which meal?") | Lemon Herb Chicken with Roasted Potatoes and Green Beans | 5.8 s / 2.8 s | pass |
| "something else" (next turn of that chat) | `dish_suggest` | yes | **the same dish again** (Lemon Herb Chicken…) | 3.7 s to the card / 2.7 s (closing round not run) | pass |
| "plan today's dishes" | `ask_choices` | yes: "Anything happening today?" with the four boxes | no (nothing planned yet) | 2.2 s | — |
| "how long do I boil an egg?" | none | — | no; answered in text | 1.4 s | — |
| "is salmon ok for me?" | none | — | no; answered in text | 1.4 s | — |
| "I cooked eggs this morning" | none | — | no; Clara proposed logging it, with answer boxes | 2.5 s | — |
| "help me cook eggs" (egg allergy) | `dish_suggest`, fill `wants: eggs` | yes | no; the conflict result, explained plainly | 1.9 s / 10 ms | no dish served |

About $0.015. The repeated dish on "something else" is why `avoid` was added afterwards; **`avoid` is unit-tested only,
not re-run live.**

