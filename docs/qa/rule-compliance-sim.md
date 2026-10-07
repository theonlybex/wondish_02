# Rule-compliance simulation

Run 2026-10-07T22:31:19.936Z · snapshot 2026-10-07T20:58:25.960Z · 995s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 3877 — 112 single rules, 3486 rule pairs, 17 real-user combinations, 11 hand-built heavy combinations, 250 random 3–8-rule combinations (seed 20261007), 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 65 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 3877 | 193811 | 0 | 0 | 934 |
| What to buy · By category | 3877 | 544110 | 0 | 0 | 1400 |
| What to buy · By cuisine | 3877 | 324165 | 0 | 0 | 943 |
| Taste · ingredient picker | 3877 | 291643 | 0 | 0 | 465 |
| Clara post-filter (cook-day · swap · fridge) | 3877 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 391 | 34203 | 0 | 0 | 441 |
| Taste · dish swiper | 391 | 43634 | 0 | 0 | 163 |
| Meal plan · week generation | 391 | 78049 | 0 | 0 | 296 |
| Meal plan · alternatives | 391 | 35826 | 0 | 0 | 124 |
| Meal plan · swap gate (whole library) | 391 | 4511741 | 0 | 0 | 3685 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, cookable | 1247 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 696 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, alternatives, swap-gate, meal-plan | 491 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate | 491 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan, buy-value | 382 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan, swap-gate | 344 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 327 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, swap-gate, taste-dishes, meal-plan, alternatives | 318 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate, meal-plan | 305 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate, cookable | 295 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate, meal-plan | 280 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, alternatives, swap-gate, buy-value, cookable, meal-plan | 243 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, buy-value, meal-plan | 169 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate | 147 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate, cookable | 138 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 128 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate, cookable | 125 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate | 119 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate, meal-plan | 113 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate, cookable | 112 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 109 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 106 |
| diet:Gluten-free | gluten | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 101 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 101 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 99 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 98 |
| diet:Gluten-free | gluten | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 84 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 84 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate | 84 |
| avoid:Alcohol | wine | Red wine vinegar | taste-dishes, swap-gate, cookable, meal-plan, alternatives | 78 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | alternatives, swap-gate, meal-plan, taste-dishes | 75 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | alternatives, swap-gate, meal-plan, taste-dishes | 75 |
| diet:Gluten-free | gluten | Gluten-free granola | taste-dishes, meal-plan, alternatives, swap-gate, cookable | 73 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate | 71 |
| diet:Pescatarian | beef | meatless beef strips | taste-dishes, alternatives, swap-gate, buy-value, meal-plan | 68 |
| diet:Vegetarian | beef | meatless beef strips | meal-plan, alternatives, swap-gate, buy-value, taste-dishes | 51 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 46 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate, alternatives | 45 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 43 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 42 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 42 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 40 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 40 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate | 38 |
| diet:Dairy-free | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 34 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate, alternatives | 31 |
| diet:Gluten-free | gluten | Gluten-free chickpeas orzo pasta | swap-gate | 26 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate | 26 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate | 26 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 24 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 24 |
| avoid:Red meat | beef | meatless beef strips | swap-gate, meal-plan | 22 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 10 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 9 |
| diet:Gluten-free | gluten | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 7 |
| diet:Gluten-free | bread | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 7 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 7 |
| goal:Eat healthier | butter | unsalted creamy peanut butter | swap-gate | 7 |
| diet:Dairy-free | butter | unsalted creamy peanut butter | swap-gate, meal-plan | 6 |
| diet:High-protein | sugar | sugar-free granola | swap-gate | 6 |
| diet:Gluten-free | gluten | Gluten-free chickpeas rotini pasta | swap-gate | 4 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate | 4 |
| diet:Gluten-free | rotini | Gluten-free chickpeas rotini pasta | swap-gate | 4 |
| diet:Mediterranean | butter | unsalted creamy peanut butter | swap-gate | 3 |
| goal:Muscle Gain | sugar | sugar-free granola | swap-gate | 1 |

## Rules that ban no ingredient

These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: Alzheimer's Disease, Aspirin-Exacerbated Respiratory Disease (AERD), Autoimmune Diseases, Cancer – after treatment, Chronic Inflammatory Conditions, Constipation, Eczema, Foggy brain, GERD, Gastritis, Gut Candidiasis, Hair Shedding, IBD – in remission, IBS-C, IBS-D, IBS-M, Leaky Gut Syndrome, Migraine, Overweight, Recovering after illness/surgery, Respiratory Allergies, Rosacea, Seborrheic Dermatitis, Stroke, Lose weight + preserve muscle, Manage a health condition, Navigate my food restrictions, Save time on meal planning.

## Coverage notes (non-pair profiles)

Meal plans that could not fill every core slot from the library: 1.
- everything: 28 rows, core coverage 33%
