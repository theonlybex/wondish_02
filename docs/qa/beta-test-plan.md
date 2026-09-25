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
