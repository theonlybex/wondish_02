# Health-condition rules audit — 2026-09-11

Question: for each of the 35 health conditions a user can pick, does the system
actually change what it serves? Checked three things per condition: which
rules exist in our data, where the code enforces them, and what those rules do
against the real catalog (1,200 public recipes on the shared DB today).

## How a condition can act on the plan (the four levers)

| Lever | Where it is enforced | Which conditions use it |
|---|---|---|
| **Banned ingredients** (`HealthCondition.bannedIngredients`, name match on the dish's ingredient list) | Library pool filter, Clara top-up post-filter, swap validation, What-to-buy, cookable, taste deck | 7 of 35 |
| **Macro profile** (`resolveMacroProfile`) | Daily macro targets, dish scoring, Clara generation and swap prompts | Any name containing "diabet": Type 2 Diabetes, Prediabetes → 35/45/20 |
| **Prompt guidance** (`CONDITION_GUIDANCE`, added 2026-09-11) | Clara chat, fridge suggestions, Clara profile skill — **not** week generation, **not** swap | 9 of 35 |
| **Workbook 03 rules** (4,708 rows) | Not imported | 0 |

Two enforcement gaps that apply to every condition:

1. **Week generation and Clara swap never learn the condition.** Their prompts
   receive only the flat ban list (`bannedNames`) and the macro split. A user
   with GERD, IBS or PCOS is generated for as if they had no condition, because
   those conditions have no bans. Passing the food-map text (or at least the
   condition names + guidance) into both prompts is a one-line change in
   `lib/meal-plan.ts` / `lib/clara/recipe-generation.ts` and the swap route.
2. **Only the ingredient *name* is matched.** The Big-9 component groups from
   workbook 01/03 are used for allergies only. Celiac is the condition that
   needs them (see below).

## Group A — conditions with ingredient rules (7)

Pool = library recipes a user with only this condition can be served, by meal
type. False positive = a ban that removes food it should not. Dead = a ban
that matches no ingredient any recipe uses (harmless, but gives false comfort).

| Condition | Pool (of 1,200) | Working bans | False positives | Dead bans | Gaps |
|---|---|---|---|---|---|
| **Celiac Disease** | 996 · dinners 62 | soy sauce, all-purpose flour, barley, bulgur, couscous, rolled oats | **"gluten" bans every gluten-free product** (7 products, ~35 recipes); "pasta" and "crackers" only hit gluten-free ones; "flour" hits almond flour; "oats" hits oat milk | 18 of 28 (wheat, panko, rye, spelt…) | **Bread, tortillas, English muffins and regular pasta are NOT excluded** — no recipe ingredient is literally named "wheat". Fix: give Celiac the BIG9-WHEAT component group (89 ingredients already carry groups) and drop the "gluten" row. Workbook 03 has 38 APPROVED AVOID rows + 24 "allow if verified GF" rows for Celiac, deployable today |
| **Heart Disease** | 1,026 · dinners 67 | soy sauce, fish sauce, whole milk, brown sugar | "butter" also bans almond and peanut butter; "sugar" bans sugar-free granola; "cream cheese" hits low-fat cream cheese | 27 of 33 (lard, bacon, ham, ice cream…) | Sodium is guidance-only since the salt row was removed; workbook has a 1,500 mg/day sodium budget (REVIEW_REQUIRED) that needs per-recipe sodium — we have it on 50 recipes |
| **High Cholesterol** | 1,071 · dinners 69 | whole milk, sour cream, cream cheese | "butter" → nut butters; "kidney" → kidney beans; "cream cheese" → low-fat cream cheese | 22 of 28 (egg yolks — recipes say "Large eggs"; fried chicken; french fries…) | Egg-yolk rule is dead because eggs are one ingredient; saturated-fat budget not possible without nutrient data |
| **Hypertension** | 1,079 · dinners 65 | soy sauce, fish/oyster/Worcestershire sauce, chicken/beef broth, olives, cheddar, feta | none after the olive-oil fix | 17 of 26 | Sodium budget as above; "low-sodium" products (low-sodium chicken broth) are still banned by the broth rule |
| **Kidney Disease stage 1-2** | **426 · dinners 32** | banana, orange, potato, tomato, spinach, squash, beets, raisins, cheese, yogurt, whole milk, seeds, lentils, beans, soy/fish sauce | **"beans" bans the plant-based egg (41 recipes) and green beans**; "yogurt" bans almond-milk yogurt; "potato" bans potato-starch crackers | "nuts" misses walnuts/almonds/peanuts (word boundary); dairy milk, tomato paste, bran, cola… | This is the most restrictive profile in the app and the one most likely to produce a thin week; the potassium/phosphorus rules are correct in spirit but need per-ingredient nutrient data (workbook 03: 233 NUTRIENT_BUDGET rows, REVIEW_REQUIRED) |
| **Thyroid Disorder** | 1,137 · dinners 67 | tofu | "sugar" → sugar-free granola | **23 of 25** — every "raw broccoli / raw kale / …" row is dead because no ingredient carries "raw"; soy milk, tempeh, seaweed, iodized salt, "fried foods", "alcohol" never match | Effectively the rule is "no tofu". The raw-cruciferous intent can only be expressed as a *preparation* rule, which the data model does not have |
| **Type 2 Diabetes** | 1,118 · dinners 68 | brown sugar, maple syrup, honey, all-purpose flour | "sugar" → sugar-free granola | 23 of 28 — **"white rice" misses Jasmine/Basmati rice, "white bread" misses Sliced bread, "fruit juice" misses orange/tomato juice** | Macro shift to 35/45/20 works. The carbohydrate-budget rows in workbook 03 (43 + 5 deployable corrections) are the real mechanism and are not imported |

Common causes behind the false positives: bare "sugar" and "butter" are
substring-style phrase bans, and product names like "Sugar-free granola" or
"Almond butter" contain the word. The fix is the same as the olive-oil case:
either make the rows specific ("white sugar", "dairy butter") or teach
`exactBanPattern` a small exemption list ("sugar-free", "nut butter").

## Group B — macro only (2)

- **Prediabetes** — no bans, but the "diabet" substring gives it the diabetic
  macro split. Nothing tells Clara generation about it.
- **Type 2 Diabetes** — see above.

## Group C — name only (26)

These conditions exist in onboarding and settings and change **nothing** in
the plan. The only place the name appears is Clara's chat prompt (and, since
2026-09-11, the guidance line for the six marked *g*):

Acne · Alzheimer's Disease · Cancer – during treatment · Cancer – after
treatment · Candidiasis · Chronic Diarrhea · Chronic Inflammatory Conditions ·
Chronic kidney disease – stage 3 *(g)* · Constipation · Eczema · Fatty Liver
Disease (NAFLD) *(g)* · Foggy brain · GERD *(g)* · Gastritis · Hair Shedding ·
IBD – active · IBD – in remission · IBS-C · IBS-D · Migraine · Overweight ·
PCOS · Recovering after illness/surgery · Respiratory Allergies · Rosacea ·
Seborrheic Dermatitis · Stroke.

The onboarding card already tells the user which conditions "change your plan
today" (the dot) and that the rest are "recorded so Clara can take them into
account" — that copy is accurate. What is *not* accurate today is the second
half for week generation, because generation never sees the condition.

## What workbook 03 offers per condition

4,708 health-restriction rows across 26 profile factors. Only **231 are
DEPLOYABLE**; 4,477 are `REVIEW_REQUIRED` (proposed clinical review). The
workbook uses numeric profile ids without names, so mapping to our 35 names
is a manual step (Celiac = 7 and Hypertension = 6 are certain from their
dedicated sheets; the rest need the client to confirm). Deployable today:

- Celiac: 38 AVOID + 10 ALLOW + 24 ALLOW_IF_VERIFIED_GF — directly usable with
  the form ids we already imported.
- Diabetes-type factor (pf 4): 13 DO_NOT_AUTO_INCLUDE, 5 PORTION_LIMIT,
  5 CARBOHYDRATE_BUDGET corrections.
- Three other factors (pf 12, 56, 340/352): 37 + 37 + 14 DO_NOT_AUTO_INCLUDE
  rows.
- Everything else (sodium/potassium/phosphorus budgets, temporary
  eliminations for IBS/IBD/GERD-type factors, symptom monitoring) needs either
  per-recipe nutrient data (`AUTO_ENFORCE_IF_NUTRIENT_DATA`, 1,305 rows) or a
  clinician sign-off.

## Verdict

- **Enforced and correct:** Hypertension (after today's fixes), the diabetic
  macro split, allergies (component-based).
- **Enforced but partly wrong:** Celiac (misses bread, bans gluten-free
  products), Kidney (bans the plant-based egg and green beans), Heart / High
  Cholesterol / Diabetes / Thyroid ("sugar", "butter" false positives; most
  rows dead; key products like white rice and sliced bread slip through).
- **Not enforced at all:** 26 conditions, plus every condition during week
  generation and swap.

## Fixes applied (same day, `feat/workbooks-tier1`)

1. **Generation and swap prompts now carry the diner's profile** (food-map
   text: allergies, diets, foods to avoid, conditions and their guidance).
   Live check: a Celiac + GERD + High Cholesterol profile generated 21 dishes,
   16 accepted, 0 wheat ingredients in the 22-menu week.
2. **Celiac uses the BIG9-WHEAT component group** (`CONDITION_GROUPS`;
   violations report source "condition"). Sliced bread, tortillas, penne,
   spaghetti, all-purpose flour and bulgur are excluded through their
   components; the 26 recipes built on gluten-free products are allowed
   again. The 18 deployable workbook-03 Celiac AVOID rows that resolve to
   ingredients in use are all covered by the group, so no separate import.
3. **Ban lists cleaned** (`scripts/condition-rules-2026-09-11.ts`, 13 rows
   removed, 47 added): bare "sugar"/"butter"/"beans"/"nuts"/"yogurt"/"kidney"
   replaced by the specific products; catalog names added where rules were
   dead (Jasmine/Basmati rice, Sliced bread, Flour tortillas, orange/apple
   juice, walnuts, almonds…).

Pools after the fixes (of 1,200): Celiac 885 (60 dinners, 0 bread leaks) ·
Heart 1,043 · High Cholesterol 1,081 · Hypertension 1,079 · Kidney 394 (31
dinners — inherent to a potassium/phosphorus rule set until nutrient data
exists) · Thyroid 1,150 · Type 2 Diabetes 1,010.

Still open: the 26 rule-less conditions now reach Clara in every prompt, but
have no deterministic rules; workbook-03 mapping for them and the nutrient
budgets remain a client/clinician decision (BACKLOG Tier 2).

## Recommended fixes, in order of value (original list)

1. Pass condition names + `CONDITION_GUIDANCE` into the generation and swap
   prompts (small code change, no data).
2. Map Celiac to the BIG9-WHEAT component group; delete its "gluten",
   "pasta", "crackers" rows; import the 38 deployable AVOID rows from
   workbook 03.
3. Data clean-up of the seven ban lists: make "sugar"/"butter" specific, retire
   the 130 dead rows or replace them with names the catalog actually uses
   (Jasmine/Basmati rice, Sliced bread, Flour tortillas, orange juice, walnuts,
   almonds), fix Kidney "beans" → black/white/kidney/lima beans.
4. Decide with the client which workbook 03 factor ids map to our 26
   rule-less conditions and which REVIEW_REQUIRED rules a clinician will sign
   off; nutrient budgets wait on sodium/potassium data for the catalog.
