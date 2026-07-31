# Clara Full-Service Assistant — Design (skill-partitioned program)

**Status: PARKED (design), restructured 2026-07-31.**
Direction (tool use), confirm policy, and the "what Clara may touch" boundary are
user-approved. **AMENDMENT 2026-07-31 (user-directed):** the feature no longer ships as
one cycle with a flat v1 toolbox. Clara's capabilities are partitioned into **skills** —
one skill per domain of the app (logs is a skill, meal plan is a skill, …) — and
**each skill is its own cycle** with its own plan doc, engine tasks, surface tasks,
review and audit. This document is the **program spec**: it defines what a skill is,
enumerates every skill, and fixes the cycle order. Per-cycle contracts live in
`docs/superpowers/plans/`.

## Goal

Clara knows the state of the whole system and can act on it from chat, on both surfaces
(web app + iOS app). Examples that must work:

- "What did I eat two weeks ago?" → Clara searches meal logs and answers.
- User logs a meal, then asks Clara about it → Clara sees it immediately.
- "Add shellfish to my allergies" / "log that ramen for lunch" → Clara performs the
  change without the user leaving the chat.

## Decided direction: tool use, not prompt-stuffing

Today both Clara surfaces (web dish-checker/fridge + iOS chat) hit the same backend
routes (`POST /api/dish-checker` streams; `POST /api/fridge`), and those routes inject a
read-only dietary snapshot into the system prompt via `buildFoodMapText`
(`lib/food-map.ts`). That snapshot cannot answer historical queries and cannot write.

**Chosen architecture:** the streaming chat route runs a server-side agentic tool-use
loop (Anthropic tool calling). Clara gets a typed toolbox; the server executes tools
against Prisma under the requesting user's auth. Web and iOS share one endpoint, so the
loop lives in exactly one place and clients keep receiving a text stream.

Rejected alternatives:
- **Prompt-stuffing the whole state** — unbounded tokens, stale mid-chat, can't write.
- **RAG/embeddings over logs** — the data is relational and precisely queryable;
  retrieval adds infra for worse answers.

## Decided: write-confirmation policy

**Conversational confirm.** Clara proposes the action in prose ("That's about 550 kcal —
want me to log it?") and executes the write tool only after the user's affirmative reply
in chat. Stateless; no new confirmation UI on either client. Every skill's write tools
inherit this — it is a runtime rule, not a per-skill choice.

---

## 1. What a "Clara skill" is

A **skill** is one bounded slice of the product that Clara can see and act on, shipped as
a self-contained module the runtime discovers through a registry. One skill ≈ one data
domain ≈ one existing tab/surface of the app ≈ **one cycle**.

A skill is *not* a single tool. It is the whole vertical:

| Skill part | Contract |
|---|---|
| **Tools** | 2–6 typed tool definitions (JSON Schema), named `<domain>_<verb>` (`logs_search`, `logs_create`). Reads and writes of one domain travel together — they share validation, date semantics and vocabulary. |
| **Handlers** | Pure-ish server functions taking `(patientId, args)`. `patientId` is resolved from server auth **only** — no tool ever accepts a patient/account id from the model. Handlers reuse the existing `lib/` logic (`lib/meal-log.ts`, `lib/journal.ts`, `lib/diet-match.ts`, …); a skill that duplicates business rules instead of calling them is a review failure. |
| **Prompt fragment** | A short "when to use / what you may not do" block appended to the system prompt **only when the skill is active**. Owned by the skill, versioned with it. |
| **Confirm policy** | Writes: propose → affirmative reply → execute. Each write tool declares the human-readable confirmation sentence shape it expects Clara to produce. |
| **Refusal edges** | What the skill must decline and hand off to a surface ("I can't regenerate your plan here — open Meal Plan"). Explicit, tested. |
| **Failure taxonomy** | Every handler returns a typed result the model can narrate — `{ok:false, reason:"NOT_FOUND"|"AMBIGUOUS"|"OUT_OF_RANGE"|"NEEDS_PREMIUM"}` — never a raw exception, never a stack trace into the transcript. |
| **Tests** | Handler unit tests (TDD), tool-schema contract test, one loop integration test with a stubbed model asserting the tool round-trip, and a freemium/auth gating test. |
| **Surface work** | Either the iOS/web change the skill needs (with fixtures + screenshots per cycle.md Phase 3), or an explicit written "no client change" declaration in the plan doc. |
| **Flag** | Each skill is independently enablable (`CLARA_SKILLS` allow-list). A skill can dark-launch and be killed without redeploying the loop. |

**Why one skill = one cycle.** Each skill carries its own vocabulary problem (how does
free text map to rows), its own date/timezone semantics, its own write blast radius, and
its own review risk. Bundling them makes one un-reviewable diff; splitting them means
every cycle ships something a user can feel, and a bad skill can be flagged off without
touching the others.

### Module layout (fixed now so cycles never collide)

```
lib/clara/
  loop.ts            # C0 — tool-use loop, streaming, budget       (touched only by C0)
  registry.ts        # C0 — skill registration + active-set resolution
  types.ts           # C0 — Skill, ToolDef, ToolResult, ConfirmSpec
  dates.ts           # C0 — shared "two weeks ago" → localDate resolver (tz)
  skills/
    profile.ts       # C0 pilot
    logs.ts          # S1
    nutrition.ts     # S2
    ...              # one file per skill; a skill cycle adds exactly one file
                     # + one registry line + its tests
```

Each skill cycle touches: its own `skills/<name>.ts`, its tests, one registry line, and
(if needed) client code in the Clara repo. Two skill cycles can therefore run in parallel
with no file overlap — cycle.md §3 parallel dispatch applies.

---

## 2. What Clara can help with — full capability inventory

Everything below exists in the app today (models in `prisma/schema.prisma`, routes under
`app/api/`). This is the raw material; §3 partitions it.

| # | Domain (data / routes) | What a user would ask Clara |
|---|---|---|
| 1 | **Meal logs** — `MealLog`, `/api/meal-log` (+`/batch`, `/[id]`) | "what did I eat two weeks ago", "log that ramen for lunch", "delete the snack I logged twice", "how much protein have I had today" |
| 2 | **Targets & macros** — `lib/caloric-engine.ts`, `lib/macros.ts`, `getDayEnvelope`/`computeRemaining`, `/api/patient/caloric-profile` | "how many calories do I have left", "am I hitting my protein", "what should dinner look like to stay on target" |
| 3 | **Meal plan** — `Menu`, `/api/meal-plan` (+`/status`, `/start-date`, `/[menuId]/swap`, `/alternatives`) | "what's for dinner tomorrow", "swap Wednesday's lunch", "I ate today's planned dish", "rate that dish 4 stars" |
| 4 | **Plan exchanges** — `RestaurantPlanExchange`, `FridgePlanExchange`, `/api/meal-plan/exchanges/*` | "I'm eating out Friday, swap that dinner for a restaurant meal", "replace tomorrow's lunch with something from my fridge" |
| 5 | **Dietary filters** — `PatientFoodAllergy`/`FoodToAvoid`/`FoodPreference`/`HealthCondition`/`Motivation`, ban graph in `lib/diet-match.ts` | "add shellfish to my allergies", "I'm avoiding dairy now", "why is this dish flagged for me", "drop the low-sodium preference" |
| 6 | **Journal** — `JournalEntry` (mood/weight/energy/activity/notes), `JournalMeal`, `/api/journal` (+`/calendar`, `/log-meal`) | "when did I last note bloating", "I weighed 181 this morning", "how was my energy last week", "mark today's dinner as skipped" |
| 7 | **Supplements** — `Supplement`, `SupplementIntake`, `/api/supplements/*` | "what am I taking in the mornings", "I took my magnesium", "add vitamin D 2000 IU in the evening", "did I miss any this week" |
| 8 | **Grocery list** — derived from plan menus over a window, `/api/grocery-list` | "is oat milk on my list", "what do I need to buy for this week", "add olive oil" |
| 9 | **Restaurants** — `Restaurant`, `RestaurantDish`, `/api/restaurants*`, verdicts via `evaluateDishAgainstProfile` | "what can I safely order at Sakura", "find me a place that fits my profile", "is the pad thai OK for me" |
| 10 | **Fridge & cook** — `/api/fridge`, `lib/fridge.ts`, generated recipes | "I have chicken, rice and spinach — what can I make", "I cooked that, log it" |
| 11 | **Dish check** — Clara's existing native behavior (`buildSystemPrompt` + food map) | "is this burrito OK for me" — already works; skills make the verdict actionable |
| 12 | **Progress & prediction** — `lib/journey-data.ts`, `lib/prediction-*.ts`, `/api/journey` | "am I on track for my goal weight", "how's my weight trending", "when will I hit 165 at this rate" |
| 13 | **Taste preferences** — `PatientDishPreference`, `/api/taste/*` | "I don't like salmon, stop suggesting it", "more Thai food please" |
| 14 | **Custom ingredients** — `PatientCustomIngredient` (premium) | "log 2 scoops of my protein powder" |
| 15 | **Body & goals** — `Patient.weight/goalWeight/weeklyGoal/physicalActivity/mealType` | "change my goal weight to 165", "I'm training 5× a week now" |
| 16 | **Orders / payments** — `Order`, `/api/orders`, Stripe | *(excluded — see §5)* |
| 17 | **Account / subscription / coupons** | *(excluded — see §5)* |
| 18 | **Admin & provider surfaces** | *(excluded — see §5)* |

---

## 3. The partition — Clara's skills, one per cycle

### C0 — Skill Runtime *(foundation, not a skill; blocks everything)*

The loop, the registry, and every cross-cutting rule. Ships with one deliberately tiny
pilot skill — **Profile (read-only)** — so the loop is proven end-to-end without any
write risk.

Delivers: tool-use loop inside the streaming route · skill registry + active-set
resolution · `CLARA_SKILLS` flag · shared timezone/date resolver ("two weeks ago") ·
tool-round budget and per-round model choice · confirm protocol + its prompt rules ·
freemium accounting for multi-round turns (402 before token spend survives) · stream
framing decision · typed `ToolResult` taxonomy · **the capability-gap ledger (§5)** ·
the loop integration-test harness (stubbed model) every later cycle reuses.

Answers open questions **Q1 (stream framing), Q2 (budget), Q5 (date semantics)**.

Also decides the **toolbox-size policy**: with 12 skills × 2–6 tools the always-on
toolbox grows past what belongs in every turn. C0 ships always-on (few skills exist yet)
and records the trigger: **when active tool definitions exceed ~15, add a selection
pass** (cheap router or keyword pre-selection) rather than growing the prompt.

| Cycle | Skill | Tools (shape, not final) | Why here in the order |
|---|---|---|---|
| **S1** | **Logs** (intake) | `logs_search(range/text)`, `logs_day_summary`, `logs_create` ✍️, `logs_update` ✍️, `logs_delete` ✍️ | The headline use case and the reason the feature exists. First write skill: it forces the confirm protocol, idempotency (`clientRequestId`) and the per-serving snapshot rules to be real. Answers **Q3** (source type for a Clara-logged meal; server pricing of free-text dishes). |
| **S2** | **Nutrition & targets** | `nutrition_remaining_today`, `nutrition_range_summary`, `nutrition_targets` | Read-only, no new writes, and it makes S1 conversational ("that leaves you 480 kcal"). Cheap cycle riding S1's date plumbing. |
| **S3** | **Meal plan** | `plan_get(day/week)`, `plan_mark_done` ✍️, `plan_rate` ✍️, `plan_swap_dish` ✍️ (via `/alternatives`) | Daily-driver surface; the completion/rating path already exists and is well-tested. **Excludes regeneration** — Clara links out. |
| **S4** | **Journal** | `journal_search`, `journal_get_day`, `journal_upsert_entry` ✍️ (mood/energy/activity/notes), `journal_log_weight` ✍️ | Self-contained domain, low blast radius, high "assistant feel". Weight writes stop at the journal row — they do **not** touch `Patient.goalWeight` (that's §5). |
| **S5** | **Supplements** | `supplements_list`, `supplements_adherence(range)`, `supplements_mark_taken` ✍️, `supplements_add` ✍️, `supplements_remove` ✍️ | Small, crisp domain with a clean unique key (`supplementId+date`) — the natural place to prove repeat/idempotent writes. |
| **S6** | **Dietary filters** | `filters_get`, `filters_add` ✍️, `filters_remove` ✍️, `filters_explain_ban` | **The riskiest skill** — writes feed the ban graph `lib/diet-match.ts` derives from, so a bad row silently changes every dish verdict and can stale the plan. Deliberately sequenced *after* the confirm protocol has shipped three times. Answers **Q4** (map free text like "shellfish" onto canonical `FoodAllergy`/`FoodToAvoid` rows). Must define plan-staleness behavior on write. |
| **S7** | **Grocery** | `grocery_get(window)`, `grocery_has_item`, `grocery_add_item` ✍️, `grocery_remove_item` ✍️ | Depends on S3's plan-window semantics; today's list is derived, so this cycle owns the "user-added item" storage question. |
| **S8** | **Restaurants** | `restaurants_search`, `restaurant_dishes_for_me`, `dish_verdict` | Read-only discovery; reuses `evaluateDishAgainstProfile` so verdicts match the Restaurants tab byte-for-byte. Handoff target for S10. |
| **S9** | **Fridge & cook** | `fridge_suggest(ingredients)`, `fridge_log_cooked` ✍️ | Answers **Q6** — this is the cycle where `/api/fridge` gets the toolbox (or is folded into the shared loop), not a C0 concern. |
| **S10** | **Plan exchanges** | `exchange_propose_restaurant` ✍️, `exchange_propose_fridge` ✍️, `exchange_status`, `exchange_cancel` ✍️ | Needs S3 (plan), S8 (restaurants) and S9 (fridge) to exist first; owns a status machine (`PlanExchangeStatus`) that only makes sense once both ends are conversational. |
| **S11** | **Progress & journey** | `progress_weight_trend`, `progress_prediction`, `progress_goal_eta` | Read-only synthesis over `lib/journey-data.ts` / `lib/prediction-*.ts`. Late because it's insight, not action. |
| **S12** | **Taste** | `taste_record_preference` ✍️ (like/dislike a dish or cuisine), `taste_get` | Writes `PatientDishPreference`, which steers future plans — low urgency, real long-tail value. |
| **S13** | **Custom ingredients** (premium) | `custom_ingredients_list`, `custom_ingredient_log` ✍️, `custom_ingredient_create` ✍️ | Premium-gated; extends S1 rather than standing alone conceptually, but its own cycle because the premium gate and unit math are separate machinery. |

✍️ = write tool, behind conversational confirm.

### Wave view (what to run when)

| Wave | Cycles | Theme | Parallelism |
|---|---|---|---|
| 0 | C0 | Runtime + pilot | Blocking — nothing runs beside it |
| 1 | S1 → S2 | "Clara knows and records what I eat" | S2 starts once S1's date/summary helpers land |
| 2 | S3, S4, S5 | Daily drivers | S4 and S5 are file-disjoint from S3 → parallel dispatch |
| 3 | S6, S7 | Profile + shopping writes | S6 solo (risk); S7 can pair with it |
| 4 | S8, S9 → S10 | Discovery, then exchanges | S8/S9 parallel; S10 after both |
| 5 | S11, S12, S13 | Insight & personalization | All three parallel |

Every wave boundary is a shippable product: after wave 1 Clara is a food diary that
talks; after wave 2 she runs your day; after wave 3 she maintains your profile.

---

## 4. How Clara recognizes which skill to use

There is no classifier and no intent parser. **Recognition is the model's native tool
selection**: every tool definition carried in a request (name + description + JSON
schema) is the recognition surface, and Clara picks by reading them. That means
recognition quality is a *writing* problem and a *shape* problem, not a new subsystem —
and both are owned by C0 with per-skill obligations.

### 4.1 The four layers

**Layer 1 — tool names and descriptions (does 90% of the work).**
Each skill's tool descriptions must state, in the description text itself: what the tool
is for, what it is *not* for, and which sibling tool owns the neighbouring case. Every
skill cycle writes these; reviewers check them against the tie-breaker table below.

**Layer 2 — the skill's prompt fragment.** Appended only when the skill is active. It
carries the domain's vocabulary ("intake" = what the user actually ate; "plan" = what was
scheduled) and the refusal edges, so Clara knows when the right move is to hand off
instead of reaching for a tool.

**Layer 3 — the boundary/tie-breaker table (C0, global).** This app has three different
places that all look like "meals" and two that look like "food I need". Without an
explicit rule Clara will pick by coin flip:

| The user says | Correct owner | Not |
|---|---|---|
| "what did I eat / how much protein today" | `logs_*` — `MealLog` is the intake truth | `journal_*`, `plan_*` |
| "what am I having for dinner / what's planned" | `plan_*` — `Menu` | `logs_*` |
| "I ate the planned dish / rate it" | `plan_mark_done` + `plan_rate` (S3) — writes the completion, intake follows | `logs_create` |
| "log that ramen" (unplanned) | `logs_create` (S1) | `plan_*` |
| "how did I feel / mood, energy, notes, weight" | `journal_*` (S4) | `logs_*`, `progress_*` |
| "am I trending toward my goal" | `progress_*` (S11) — derived synthesis | `journal_*` |
| "how many calories left" | `nutrition_remaining_today` (S2) — derived | `logs_search` then mental math |
| "do I need to buy X" | `grocery_*` (S7) | `fridge_*` |
| "what can I make with what I have" | `fridge_suggest` (S9) | `grocery_*`, `plan_*` |
| "can I eat X / is X OK for me" | no tool — Clara's native dish check against the prompt snapshot | `filters_*` |
| "stop suggesting X" | `taste_record_preference` (S12) if it's dislike; `filters_add` (S6) if it's allergy/avoid — **ask which** | guessing |

**Layer 4 — recovery, not prevention.** Wrong pick is a normal, cheap event: handlers
return typed `{ok:false, reason:"NOT_FOUND"|"AMBIGUOUS"|…}` (never exceptions), the model
sees the result and re-selects on the next round, bounded by C0's round budget. An
`AMBIGUOUS` result is Clara's cue to ask the user rather than guess — the same
conversational move the confirm protocol already relies on.

### 4.2 Which tools are in the request (the scaling question)

**Decision: static, always-on toolbox for as long as it holds.** The model recognizes
best when it can see everything, and — critically — a *stable* tools block is the top of
the prompt and therefore the most cacheable part of it. C0 adds `cache_control` to the
tools + system prefix (the route does not use prompt caching today), which makes the
always-on toolbox cost a fraction of its nominal tokens on every turn after the first.
Any scheme that varies the toolbox per turn **breaks that cache prefix** and is likely to
cost more than it saves until the toolbox is genuinely large.

Escalation path, in order, with the trigger that fires it:

| Stage | Mechanism | Fires when |
|---|---|---|
| **A (C0 default)** | All active skills' tools in every request; cached prefix | now — through ~15 tool defs |
| **B** | **Tiered disclosure**: a core always-on set (profile, logs, nutrition, plan — they cover most turns) + one `find_capability(query)` discovery tool that returns the matching skill's tool defs, which the loop then includes in the *next* round's request | active tool defs exceed ~15, or the recognition eval (§4.3) drops below its bar |
| **C** | Cheap router pass before the main call | only if B measurably fails — a router adds a round-trip of latency **and** a hard failure mode (misrouted turn = capability invisible to Clara, with no recovery round), which is why it is last, not first |

Because the loop builds each round's request itself, a per-round toolbox is implementable
without any client change — this is a cost/latency decision, not an architectural one.

### 4.3 Proving recognition works (per cycle, non-negotiable)

Each skill cycle contributes **10–20 real utterances** to a shared fixture
(`lib/clara/__fixtures__/routing.ts`), each mapped to the tool Clara is expected to
select — including the adversarial neighbours from the tie-breaker table ("what did I eat
Tuesday" must **not** hit `journal_search`).

**CORRECTION 2026-07-31:** this cannot be a unit test. Measuring selection requires real
model calls — slow, costly, and non-deterministic, so it does not belong in the suite that
gates every commit. It ships instead as an **opt-in script**, `npm run clara:routing-eval`,
run by the controller during the cycle's audit phase (cycle.md Phase 5). The score is
recorded in the cycle ledger and **is blocking for merge** — it is simply enforced by the
audit, not by CI. Bar: **≥90% top-1 selection** (C0).

This is the program's regression net: it catches the real hazard —
**adding S4 Journal silently degrading S1 Logs selection.** Every skill cycle re-runs the
*whole* accumulated fixture, not just its own slice, and a drop is a Critical finding.

## 5. The capability-gap ledger — demand decides the build order

**User directive (2026-07-31):** when a user asks Clara for something no skill covers,
Clara records it. The ledger is reported back to the product owner, and **the most
requested missing skill is built next.** The wave order in §3 is therefore a *default*,
not a commitment — it is overridden by measured demand from the second cycle onward.

The ledger is **runtime, not a skill** — it ships in C0, before any skill exists, because
that is exactly when demand data is most valuable (every unbuilt capability is still a
gap, so the first weeks of data rank the whole backlog).

### 5.1 How a gap is detected

**A dedicated always-on tool, `gap_report`.** Clara calls it when the user asks for
something none of her active tools can do; the call is silent (no user-visible framing),
and she then tells the user plainly that she can't do that yet — never promising a date.

Rejected: **inferring a gap from a turn with zero tool calls.** Most healthy turns use no
tools at all — dish checks, general nutrition questions, follow-ups, small talk — so that
signal is mostly noise. Rejected too: refusal-phrase matching on Clara's own output, which
is brittle and unfalsifiable.

`gap_report` arguments:

| Field | Meaning |
|---|---|
| `category` | A fixed enum seeded from **the planned-but-unshipped skills** (`LOGS`, `NUTRITION`, `MEAL_PLAN`, `JOURNAL`, `SUPPLEMENTS`, `FILTERS`, `GROCERY`, `RESTAURANTS`, `FRIDGE`, `EXCHANGES`, `PROGRESS`, `TASTE`, `CUSTOM_INGREDIENTS`, `BODY_GOALS`) plus `OTHER`. The enum is what makes the report actionable — it names the S-number to pull forward. |
| `summary` | One line, model-written **paraphrase** of what the user wanted (≤200 chars). |
| `reason` | `NOT_BUILT` · `FLAGGED_OFF` (skill exists but off for this account — an ops signal, not backlog) · `OUT_OF_SCOPE` (money, account, admin — tracked as policy pressure, **excluded from build ranking**) · `UNCLEAR`. |

Stored alongside: `patientId`, `surface` (web / iOS), `createdAt`. **No raw transcript is
stored** — the paraphrase is the record. Retention is bounded (see Q11).

New Prisma model `ClaraCapabilityRequest`, additive migration, per cycle.md §2.

### 5.2 Keeping the count honest

- **Dedupe:** unique on `(patientId, category, localDate)` — one user asking five times in
  a day counts once. Ranking is by **distinct users**, never raw rows, so a single heavy
  user cannot set the roadmap.
- **Abuse cap:** per-user daily cap on gap rows via the existing `lib/rate-limit.ts`; the
  tool returns `ok:true` regardless so a capped user's chat is unaffected.
- **Cold start:** before wave 1 ships, nearly everything is a gap — expect noise, and
  hold the first re-rank until there is a real sample (Q12).
- **Known blind spot:** Clara only reports gaps she *notices*. If she answers plausibly
  from general knowledge instead of admitting she can't act, nothing is logged. Mitigation
  is prompt-side, and the routing fixture (§4.3) carries **unsupported-ask utterances that
  assert `gap_report` was called** — the same regression net catches drift here.

### 5.3 The report

- `GET /api/admin/clara-gaps?from=&to=` — grouped by category: distinct-user count, row
  count, trend vs the prior window, and a handful of sample summaries.
- Admin page at `app/(dashboard)/admin/clara-gaps`, alongside the existing admin surfaces.
- `OUT_OF_SCOPE` and `FLAGGED_OFF` render in their own sections, visually separated from
  the buildable backlog so they can't accidentally drive the build order.

### 5.4 The feedback loop into this program

After each skill cycle merges, re-rank the remaining skills by distinct-user demand over
the trailing 30 days. The chosen next cycle and the ranking it came from are **recorded in
that cycle's plan doc** — so the build order stays auditable rather than vibes-based.

Two standing overrides on pure demand ranking, so the loop can't paint us into a corner:
dependency order still binds (S10 Exchanges cannot precede S3/S8/S9 however loud demand
is), and a skill's risk profile can justify holding it (S6 Filters stays after at least
three shipped write skills).

## 6. Rules every skill cycle inherits (from cycle.md + this program)

1. **Auth scope.** `patientId` comes from Clerk auth on the request. No tool parameter
   may identify a user, a patient, or another user's row. Reviewers verify this per tool.
2. **Filter writes flow through the graph.** Anything mutating dietary state goes through
   the same path `lib/diet-match.ts` derives bans from — server-enforced, food-surface
   sync rule.
3. **Freemium stays server-side.** `lib/freemium.ts` owns the gate; a multi-round
   tool turn is still **one** message against `CHAT_DAILY_FREE`, and the 402-before-
   token-spend ordering (`validate → gate → model call`) is preserved. Premium-only
   skills (S13) gate inside the handler too, returning `NEEDS_PREMIUM`, never a 500.
4. **Wire contract pinned.** The existing chat contract holds byte-for-byte for valid
   inputs. **Resolved 2026-07-31 (Q1): there is no stream framing at all** — tool activity
   surfaces as ordinary prose Clara writes before she looks something up ("Let me check
   your logs…"), streamed as plain `text/plain` like every other token. No skill may
   introduce a second stream format; a skill that thinks it needs one needs an amendment.
5. **iOS DTO dates stay `String`.**
6. **Confirm before write, always.** No skill may execute a write on the same turn the
   user first mentions it — the affirmative reply is the trigger.
7. **Refuse and hand off** rather than half-doing: meal-plan regeneration, money,
   account settings.
8. **One skill file + one registry line per cycle.** A skill cycle that edits
   `lib/clara/loop.ts` is a design smell and needs an amendment saying why.
9. **Recognition is measured.** Every skill cycle adds its utterances to the routing
   fixture and runs `clara:routing-eval` over the *whole* accumulated set at audit
   (§4.3). Below the bar → Critical.
10. **Tool rounds are budgeted, not free.** 2 rounds for free accounts, 5 for premium;
    one user message is always one credit. A skill needing more rounds than that for a
    routine ask is mis-scoped.

## 7. Out of scope — and why (recorded so it isn't re-litigated)

| Excluded | Reason |
|---|---|
| Orders & payments (`Order`, Stripe) | Money. A confirm-in-prose protocol is not an acceptable authorization boundary for spending. |
| Subscription / paywall / coupons | Same, plus it collides with the freemium gate Clara herself runs under. |
| Account settings, email, auth | Identity changes need a real UI and re-auth. |
| Admin & provider routes | Different role model entirely; Clara is a consumer surface. |
| **Meal-plan regeneration** | Complex pipeline with a status machine (`MealPlanStatus`, `activePlanVersion`); Clara links the user to the surface instead. |
| **Body & goals writes** (`goalWeight`, `weeklyGoal`, activity level) | Cascades into caloric targets *and* plan staleness. Revisit as a post-S6 cycle once filter writes have proven the staleness handling. Clara may *read* these and explain them from wave 1. |

## 8. Open questions — now owned by a cycle

**All C0-owned questions were resolved 2026-07-31** (user decisions on 1, 2, 5; defaults
accepted on the rest). Skill-owned questions stay open until their cycle.

| # | Question | Resolution / owner |
|---|---|---|
| 1 | Stream framing | **Resolved:** no framing. Clara narrates in prose before tool rounds; wire unchanged, both clients untouched. |
| 2 | Tool-round budget + credit accounting | **Resolved:** 1 message = 1 credit, gate checked once before the first model call. **2 rounds free · 5 premium.** All rounds `claude-sonnet-5`, thinking disabled, `max_tokens` 1024. |
| 3 | Meal-log write shape for a Clara-logged meal | Open — **S1** |
| 4 | Filter vocabulary mapping | Open — **S6** |
| 5 | Date semantics for "two weeks ago" | **Resolved:** optional `clientDate` + `tzOffsetMinutes` on the chat body (additive, matches `MealLog.localDate` precedent). Absent → server date + logged caveat. Web sends it in C0; iOS in S1. |
| 6 | Fridge/cook toolbox | Open — **S9** |
| 7 | Toolbox-size policy | **Resolved:** always-on + `cache_control` prefix; tiered disclosure at the §4.2 trigger. |
| 8 | Prompt-fragment assembly | **Resolved:** the system prompt is rebuilt per active skill set and cached; fragments live with their skill. |
| 9 | Recognition bar | **Resolved:** ≥90% top-1 on the routing fixture, enforced at audit via `clara:routing-eval`. |
| 10 | `OTHER` free text vs new enum values | **Resolved for now:** stays free text; the first re-rank decides whether a theme earns an enum value. |
| 11 | Gap-ledger retention / verbatim display | **Resolved:** 180-day retention; paraphrases only, visible only on the owner-only admin page. Never the raw transcript. |
| 12 | Minimum sample before demand overrides the wave order | **Resolved:** ≥14 days live **and** ≥20 distinct users in the window. |

## 9. Process

Per cycle.md, **each skill is a full cycle**: spec (this doc covers the program) → plan
doc `docs/superpowers/plans/YYYY-MM-DD-clara-<skill>.md` (contract of record) → engine
tasks in wondish_02 → surface tasks in Clara iOS → per-task reviews → final whole-branch
review → audit drill → merge. C0 must complete and merge before any skill cycle starts.
The iOS repo lives at `~/Desktop/BeTech/Clara` (cycle.md's `NewView` path is stale).
