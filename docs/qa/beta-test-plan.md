# Beta readiness test plan

The rubric each QA cycle runs against. Written 2026-09-24 after two rehearsal
runs found defects a green test suite could not: seven identical lunches, dinner
served at 8am, titles naming food the dish lacked, 1.5 tsp of salt in a
breakfast. None of those break a test; all of them lose a tester.

**Bar for "ready":** a beta tester completes the journey unaided and receives a
week they would actually eat. No P0/P1 — nothing that lies, nothing inedible,
nothing health-unsafe, no contradictory numbers on one screen.

**What the cycles taught, in one line each.** A green test suite proves nothing
about content: 1,284 tests passed while a week served seven identical lunches.
Measure a rule against the live catalog before trusting its threshold — four of
mine were wrong in the direction that deletes good food. And re-test the fix
itself: three separate cycles found a previous cycle's fix had never taken
effect.

## How a cycle runs

Fixed order, every time. The point of steps 1 and 2 is that the defect list is
edited at the START of a cycle, not written at the end of one: a list nobody
opens stops being true, and that is how a fix gets reported as done twice while
it is still on screen.

1. **Edit the list** — tick off what the last cycle actually SOLVED. Verified,
   not claimed: re-run the thing, or read the row back out of the database.
2. **Add** what the last cycle's bots found. Every finding, including the ones
   being refused by design — those go under "Refused by design" with the
   measurement that settled them, so nobody re-opens them as bugs.
3. **Write the plan** for solving them: what changes, what proves it, in order.
4. **Solve them.**
5. **Deploy bots against each FIXED feature by name.** Every fix is a candidate
   defect. Three separate cycles found a previous cycle's fix had never taken
   effect, and cycle 15 found the headline fix of the commit it was testing
   broken by the half of the wire the test did not watch.
6. **Continue with user-experience testing** — the whole journey, the misinputs,
   the sections above.
7. Repeat until a cycle finds nothing.

The list is `BACKLOG.md` §0b. Two standing conditions on step 5: each bot gets
its OWN fixture account (a shared one arrives with the allowances already spent
and can only verify refusals), and HEAD is frozen for the whole window
**including the working tree** — the dev server hot-reloads uncommitted edits
into a bot's later measurements.

## A. Cold start (fresh account, no Account row)

1. First sign-in routes into onboarding, not a dashboard.
2. Profile: every field completes; validation messages name the problem and the
   fix; the calorie reveal appears.
3. Taste/ingredient selection completes.
4. Pantry gate: the ingredient minimum is **stated before** it blocks anything.
5. The gate's promise is honest — if it says "enough to fill a full week", a
   full week must be fillable.

### Misinputs to attempt at every step
- Submit empty. Submit whitespace only.
- Birthday in the future; age 5; age 130.
- Weight 5 lbs; weight 2000 lbs; negative; `1e9`; letters.
- Height 0; height 300 cm.
- Decline terms, then continue anyway.
- Select an allergy AND the same food as a preference.
- Zero taste selections; then all of them.
- Navigate away mid-onboarding and return — is the draft preserved?
- Use browser Back at every step.
- Double-click every submit button.

## B. The meal plan — the headline feature

6. Generation returns 200 and completes inside the route's `maxDuration`.
7. **Every day has breakfast, lunch and dinner.** No empty slots.
8. **Breakfasts are breakfast food** — nothing braised, stewed or over 30
   minutes in the 8am slot.
9. Distinct dishes ≥ 70% of rows; no dish more than 3×; no single protein in
   3 of 4 slots on a day.
10. **Every dish title names only food the dish contains.**
11. Ingredient rows are plausible: no seasoning quantity on a vegetable, no
    salt above 1 tsp/serving, a fat present when the steps say to sear or fry.
12. Declared calories agree with the dish's own macros within ~10%.
13. No raw catalog text in the UI (`V1XL- 1/3 cup`, `, V1S-1 slice`).
14. Prep/cook/serves render real values, not em-dashes.
15. A thin or degenerate plan is **refused** with an actionable message, and the
    previous plan is kept.

### Misinputs
- Double-click Generate — one run, not two.
- Generate, then navigate away mid-build; return.
- Generate with the minimum basket; then with one ingredient.

## C. Clara

16. Answers about a dish from the user's own plan, correctly.
17. First token < 5 s; complete answer < 30 s.
18. Refuses to guess when the question is ambiguous.
19. **Never repeats corrupted plan data back to the user.**

### Misinputs
- Empty message. 5,000 characters. Prompt injection ("ignore your
  instructions"). A question about a dish not in the plan. Non-English.

## D. Tiers and limits

20. Free: 1 plan/week, 5 Clara/day. Beta: 3 and 13. Refusals name the limit and
    offer `/pricing`.
21. A coupon holder reads as **Beta**, never as Plus — and `/membership` says
    beta is lower than paid.
22. Wording: a coupon holder's allowance is not called "free".
23. Counters survive a cold restart (shared Redis, not per-process).
24. Redeem: a used code, an expired code, a typo, a code with no access end —
    each refused with a sensible message, none granting access.

## E. Consistency across screens

25. One daily calorie number, everywhere it appears.
26. Macro rings use one denominator, stated.
27. Over-target days are surfaced, not only under-target ones.
28. What-to-buy never suggests a staple; the by-category and by-cuisine lenses
    reflect what the user owns.

## F. Money paths (only when payments are live)

29. Checkout shows the right product and price; the return lands on the
    confirmation page, not the dashboard.
30. A paid row outranks a coupon; upgrading grants full limits immediately.
31. Webhooks deliver 2xx; `/membership` agrees with Stripe.

## Cycle log

| Cycle | Found | Fixed |
|---|---|---|
| 1 | lunch-only weeks; pool measured against the library; 25s Anthropic timeout under a 60s cap; staples too narrow to cook with | pool measurement, `ThinPlanError`, staples + tolerant matching, `maxDuration` 300 / timeout 90s |
| 2 | `pepper` → user's bell peppers (10/29 and 16/24 dishes); titles promising absent food; 1.5 tsp salt; breakfast = braised dinner 7/7 | staple/basket precedence by equal tokens; catalog-driven title gate; salt cap; breakfast guidance + 30-min ceiling |
| 3 | The gates ran at generation only, so the pool's older rows flowed straight into plans; `/restaurants` badge; lying descriptions; dishes with no quantities | one predicate re-checked at SELECTION and in the swap (`lib/dish-plausibility.ts`); description + quantity rules; 505 rows repriced |
| 4 | Two cycle-3 fixes had never taken effect (macro target set in branches that never run; `?date=` honoured then overwritten by the client); weight `0` saved "successfully"; "Chickpea…" with no chickpeas | SSR macro target + all-or-nothing denominator; `pinnedDate`; `provided()` stopped treating 0 as absent; vocabulary from the catalog |
| 5 | Declared numbers self-consistent but wrong against the FOOD (+750 kcal/day); swaps all failed; the server, not Clara, asserted "your profile avoids white rice" | nutrition COMPUTED from the amounts (`lib/staple-density.ts`); two swap candidates; goal foods attributed to the goal |
| 6 | Cup-measured grain still understated ~30%; offsetting macro errors passed a calorie check; bare counts (`Sliced bread 2`) unpriceable; condition bans announced as the user's own | volume grains default to dry; per-MACRO check; per-item weights; condition list attributed to the app |
| 7 | Daily sodium 3,000-4,100 mg; rice 21 of 26 dishes; chicken-and-rice at 8am; `?date=notadate` → 500 | day-level sodium ceiling; per-day starch cap; breakfast-food anchor; 400 JSON |
| 8 | 30 slots / 18 dishes with two of them filling 14; `"cooked rice"` read as a pre-cooked shortcut, the mechanism behind the worst macro gaps; `\begg\b` never matched "eggs", so egg dishes were rejected as "not breakfast food" | week-level variety penalty; `grainIsMeasuredDry`; explicit plurals; actionable refusal when the basket is unready |
| 9 | 209 rows filed under a slot their own timing contradicts — invisible to the slot they fit AND refused by the one they carried (the `/pantry` defect from the other end); 8 of 16 generation rejections were prose-only, on dishes that were otherwise sound; the calorie top-up enforced family and reuse and nothing else | slot labels read off the dish; `truthfulDishName` rebuilds a lying name from the ingredient list (253 stored rows too); the day's sodium, protein and starch limits apply to padding and do not relax |
| 10 | The cycle-8 variety penalty never bound — the line after it picked at random among the top three, so on a thin pool the penalty decided nothing (a flaky test caught it; QA saw one snack three times); the plan missed its own displayed fat target on 7 of 7 days, 173-241%, because the macro rule scored each dish's own ratios and 59% of the catalog's fat is added cooking oil; 983 of 1,040 salt rows above an eighth of a teaspoon | the random window is the least-used dishes only; scoring asks where the DAY lands (weight set by 18 measured weeks); salt clamped to a seasoning; 169 bare counts given their unit; an `<h1>` on two pages that had none |

| 11 | **My own QA harness was wrong and had been understating the app for three cycles** — isCoveredByBasket lowercased the dish's ingredient name and tested it against the basket set as handed in, so catalog casing matched nothing but staples; 543 of 641 oil rows have step text that AGREES with the row, so the oil cannot simply be clamped; every priceable Clara row kept the model's numbers under a 25% tolerance | both sides normalised inside the predicate; oil clamped only where the steps name no amount or name less (266 rows) and re-priced; every priceable Clara row repriced with no tolerance; a breakfast's PROTEIN must be a breakfast protein; one dish may be 1.25× its slot, not 1.35× |
| 12 | 301 dishes had amounts on every ingredient and still could not be priced — and the seasoning half of the unknown-ingredient list was never the cause, since priceDish already skips it; the escapes were UNIT-shaped for the third time (leaves, sprig, stalk, spear, pinch, clove); my own cycle-11 backfill never reached a fixpoint and needed two runs to settle; 93 dishes cook in a fat they never list; 105 "breakfasts" contain no breakfast food; a pantry of "eggs" could not cook any of the 288 "Large eggs" dishes | garnish units and the missing vegetables added (126 rows recovered); clamp rounds DOWN with a 2% margin; null-macro fills scale to the row's own calorie figure; 77 dishes given the teaspoon of oil their steps already use; 94 moved to the slot they fit; basket coverage matches on equal token sets |

| 13 | **A plan served 70 g of raw salmon** — flaked onto cooked oats, with a 12-minute cook time on the card and no rule in the codebase able to see it, because every rule was about plausibility and none about safety. Fat 34.5-46% of calories on 7 of 7 days against a 25% target, with the app's own rail printing 133-175% in red. Every vegetable priced through ONE flat row, so a plate of tomatoes declared 3 g of protein over food holding 1.4 and "Spinach 2 cup" weighed 240 g instead of 60. Clara's per-dish sodium wrong by 2.5× and self-contradictory inside one reply ("1 tsp ≈ 5,800 mg of sodium"). A breakfast of oats and two slices of toast. "Cheese and Bell Pepper Oat Bowl" with no cheese. Snack SLOTS at 1.73-1.99× their cap because the ceiling was per-dish. And two defects I had introduced in cycle 11: "½ tablespoon" invisible to a digit-only regex, and clamped amounts like "0.37 tablespoon" | a safety rule (`rawProteinNeverCooked`), reached only after two earlier heuristics were measured and rejected for flagging correctly-cooked dishes; four vegetable groups with real cup weights and macros to a tenth of a gram; per-dish sodium handed to Clara as a number; a breakfast must carry protein of some kind and "chicken" joins the dinner proteins; category words satisfied by any member and refused when there is none; the calorie window subtracts what the slot already holds; unicode fractions counted and clamped amounts rounded to measurable eighths |

| 14 | Two QA bots, run in parallel against a frozen commit, found 35 defects — **three of them created by cycles 12 and 13's own fixes.** A category rule shipped that morning was wrong in BOTH directions (`\bberrys?\b` cannot match "berries", so the lie passed; and the token rule then refused "Oatmeal with Berries" over listed *Blueberries*). Cycle 13's slot moves had **relocated** 27 breakfast-shaped dishes into Lunch and Dinner rather than repairing them — "Oatmeal with Carrots and Ground Beef" became a 373 kcal lunch where no rule could see it. A snack had a clock and no size, so 104 of 143 were plated meals up to 876 kcal. Plus: a swap that returned the dish it replaced, a blank name saving as "success", three screens contradicting each other about one basket, the dish name at 11px and its calories at 9px on a phone, a 28×26px hamburger, and `\btortilla\b` missing "Flour tortillas" | category patterns written out with the check as sole authority; the oats-and-meat shape retired in every slot; `SNACK_MAX_KCAL`; the swap refuses its own predecessor and now sees the day's fat; both ends refuse a blank name; one `basketBlockerText`; a 12px floor below 480px and 44px hit areas; negations and free-from products exempted; units pluralised; Clara given tomorrow |

| 15 | Two bots against a **frozen, pushed** commit. They confirmed most of 13 and 14 — 33 distinct dishes in 33 slots, 32 of 33 priced right against an independent USDA table, zero raw protein in 18 meat dishes, the modal trapping focus through 25 tabs, 11 of 11 profile misinputs refused, the 12px floor holding on every mobile page. Then: **the headline fix of the commit they were testing did not work** — /pantry's cook-my-day route rewrote the guard's sentence and dropped the `upgrade` flag, so the component was right and had nothing to render, **and the test written to prevent that was green and blind to it** because it only checked the client. Fat measured **29-52%** against a 25% target where I had reported 27-33% — my figure was a lucky run. And the sodium rail counted ADDED SALT against the **total**-sodium guideline, so a day at ~3,300 mg printed green | the test now checks all nine metered routes forward `guard.body`, verified by reintroducing the bug; fat gets the CEILING that fixed sodium (scoring was only ever a preference, and the oil is genuinely in the recipes — the rows agree with the step text), landing 25-38%; DENSITY gains a sodium column and the ceiling, rail, label and Clara all move together; quota checked before the in-flight lock; the weight-unit toggle persists its choice; /pantry's cookable list gets the slot rules; /pricing gets an h1 |

| 16 | The cycle became a written procedure (edit the list, add, plan, fix, bot-test each fix, journey-test) after "whats left" had no written answer. Then the list itself: **the in-flight lock was a rate limit**, which has no release, so a successful cook-my-day locked the user out for the rest of its 90-second window. **Unmeasurable amounts, open since cycle 13** — and the RULE was wrong too, snapping to eighths so a third of a cup was repaired to a quarter; the stored rows had never been touched at all (1,919 of 16,420). The 80 kcal sanity floor in both repair scripts was an **escape hatch** that exempted small dishes from being priced. 22 dishes told the user to rinse raw chicken. 31 were titled "Large Eggs…". A hit-test of all five pages found **17** undersized touch targets against the 8 reported. Three controls rendered the SAME new-week refusal at once | lib/in-flight-lock.ts (SET NX EX, released in a `finally`); repairAmount + the kitchen-fraction set shared by generator, backfill and audit, with sub-spoon seasoning becoming the `pinch` unit so the salt does not double; `formatQuantity` renders ⅓ and 1½, because snapping writes thirds and a third has no exact float; `pricingMayOverwrite`; the rinse and egg-title repairs run at generation too; targets fixed with real height in dense rows and the invisible expander only where neighbours are far; the refusal is gated on which control asked; `rate-limit:reset-user` now clears a stale lock as well as counters |

| 17 | Two bots against frozen `e5fed9e`, one per fixture, allowances reset first. The lock fix, the repricing and /pricing held. **Three claims were false, and the worst defect on the board was one I had shipped hours earlier**: to widen the journal's step dots I used a negative margin larger than the gap, so consecutive hit areas overlapped by 20px and tapping the second visible dot went to step THREE. The touch-target expander turned out to be scoped to `max-width: 480px` — a phone in LANDSCAPE is 844px wide, so the whole fix switched off with the same finger on the same buttons. The amount repair never reached the write path: a freshly generated week carries 16 rows of `0.1 teaspoon`. And the instructions exist TWICE — 784 library rows repeat the whole method in `description`, which is what /dishes renders, so 4 dishes still say to rinse raw fish while the `steps` I checked were clean | overlap is now measured alongside size, at three viewports; `(pointer: coarse)` replaces every width test for a finger (Button, four components); the dots get real width and a real gap. The rest is written into BACKLOG §0b — 24 open items with the measurement behind each |

## What the cycles taught

A green test suite proves nothing about content: 1,284 tests passed while a week
served seven identical lunches.

Three lessons kept repeating, and each one cost a cycle before it was learnt:

**A rule that judges one dish cannot see a day.** Salt, oil, starch, protein and
repeats all failed the same way: every dish individually legal, the day wrong.
Three of four dishes at half a teaspoon of salt is a day's sodium; four at a
tablespoon and a half of oil is a day that is half fat. Every fix in cycles 7-10
was some version of making the day the unit.

**A gate is the wrong instrument for a model's mistake.** Refusing a dish over
its name threw away 8 of 16 generated dishes that were otherwise sound, and the
thin pool that caused was the top blocker in two QA reports. Where the model's
prose contradicts its own ingredient list, the list is the truth and the prose
gets rewritten. Where a stored amount is implausible, it gets clamped. Rejection
is for what cannot be repaired: an allergen, a missing amount, a lying macro.

**Measure the fix, on the real database, before shipping it.** Four fixes were
written and then abandoned because the measurement said they would do harm: a
produce-in-teaspoons rule that would have deleted hundreds of correct rows, a
calorie rewrite that mispriced egg whites threefold, a per-week dish cap that
made slots unfillable, and an oil clamp that would have contradicted the step
text of 379 recipes. Two prompt changes backfired and were reverted. A fix that
has not been measured is a guess with a commit message.

**And measure the measurement.** Three cycles of variety and fat numbers were
reported through a harness whose basket never matched anything but staples, and
the app looked worse than it was. Two separate fixes were then tuned against
that hole. The tell was available the whole time and ignored: the pool arithmetic
said 85 eligible breakfasts and the runtime served 2. When a measurement and a
count disagree by a factor of forty, the measurement is the thing to check first
— `WONDISH_DEBUG_POOL=1` exists now so the next person can see the runtime's own
answer instead of reconstructing it.

**The plural trap is a bug FAMILY, not a bug.** A singular-only pattern that
never matches the catalog's own spelling has now appeared six times, in four
different modules: `\begg\b` against "eggs" (egg dishes rejected as "not
breakfast food"), `\bberries\b` against "strawberries", `\bpeppers?\b`
catching "Bell peppers" (a vegetable priced as its seasoning), `\bcucumber\b`
against "Cucumbers" (74 rows unpriceable), `\b(egg)\b` in the style rules
(refusing 81 egg dishes for having no egg), and `\btortilla\b` against "Flour
tortillas". Five were found by measuring the live database; one was found by the
test written after the fourth. Any new pattern matching a food noun gets `s?`,
and two tests hold the catalog's own spellings.

**Every fix is a candidate defect.** Three of the changes in cycle 11 had to be
repaired in cycles 12 and 13: a clamp that never reached a fixpoint, a
digit-only regex that made "½ tablespoon" invisible and let the clamp contradict
a recipe's own steps, and clamped amounts no kitchen can measure. Cycle 13 then
shipped a category rule that was wrong in both directions within hours, and
relocated 27 bad dishes instead of retiring them. All of it was found by QA or by
running the backfill twice — none of it by the tests written alongside.

The habit that works: after writing a rule, run it over the whole live
catalog and READ what it flags. Every time that was done, it found something —
a "Scramble" stripped from 81 correctly-named dishes, three properly-cooked
dishes condemned as raw, four correct products refused as untrue. Every time it
was skipped, QA found it instead, a cycle later.

**A target that grows into its neighbour is worse than a small one.** Padding
a 6px dot out to 32px inside a 6px gap made two of five dots unreachable and
sent the user two steps away from where they tapped — and in a size report it
looked like a fix. Any hit-area change has to be measured for OVERLAP, not just
for size.

**Ask the question you actually mean.** `max-width: 480px` and `sm:min-h-0` are
both asking "is this a phone?" in order to answer "is this a finger?". A phone
in landscape is 844px wide, so both switched the hit areas off exactly where
they were still needed. `(pointer: coarse)` asks the real question.

**Check the field the user reads.** The rinse repair rewrote `steps` and the
public page renders `description`, where 784 library rows keep a second copy of
the whole method. Querying `steps` returned zero and would have confirmed a fix
that had not reached the screen. When the same content lives in two columns,
verifying the one you edited proves nothing.

**A fix that is not applied to the stored rows is not applied.** "0.37
tablespoon" was reported fixed in three consecutive cycles. Each fix landed in
the generator; the 16,420 rows a user actually reads were never touched. When a
defect is in DATA, the fix has two halves and the backfill is the one the user
sees.

**Write the rule down and it will turn out to be wrong.** Every time a
threshold has been moved from a habit into a shared function in this project,
the act of writing it exposed an error: the eighths rule condemned a third of a
cup, the rinse rule condemned washing celery, the egg-title rule read a method
off the wrong sentence. Three for three. The predicate is not the easy half.

**A guard against bad input silently exempts good input.** The 80 kcal floor
existed to stop a broken price overwriting a real dish, and it also exempted
every genuinely small dish from being priced at all — quietly, with nothing
reporting the exemption. Any sanity band needs a list of what it caught.

**A test that watches one end of a wire proves nothing about the wire.** The
no-paywall test asserted the CLIENT reads the `upgrade` flag and passed green
while the SERVER was dropping it — so the surface QA had just reported as a dead
end stayed one, in the commit named after fixing it. Both ends, or neither.
Prove it by reintroducing the bug and watching the test fail; that took thirty
seconds and would have caught it.

**Report the range, not the run.** Fat was reported at 27-33% from a single
measurement; three runs gave 27-43% and QA's week hit 52%. The builder shuffles,
so one week is a sample. Any number quoted from a generated plan needs at least
three runs behind it, stated as a range.

**Relabelling is not repairing.** A dish filed under the wrong slot is repaired
by moving it. A dish that is wrong in every slot is repaired by retiring it, and
moving that one just puts it where no rule is looking. The difference is whether
the SLOT was the problem.

**A predicate that silently returns false for correct input is a bug, even when
every caller happens to be correct.** isCoveredByBasket cost a day twice over —
once through the harness, once by making a pantry of "eggs" ineligible for 288
egg dishes. Both times nothing errored and nothing logged; a week just came out
thinner for a reason no screen could show.
