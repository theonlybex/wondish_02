# Rule-compliance simulation

Run 2026-10-11T17:40:12.043Z · snapshot 2026-10-07T20:58:25.960Z · 996s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 3962 — 113 single rules, 3570 rule pairs, 17 real-user combinations, 11 hand-built heavy combinations, 250 random 3–8-rule combinations (seed 20261007), 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 65 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 3962 | 198048 | 0 | 0 | 966 |
| What to buy · By category | 3962 | 556114 | 0 | 0 | 1450 |
| What to buy · By cuisine | 3962 | 331346 | 0 | 0 | 963 |
| Taste · ingredient picker | 3962 | 297921 | 0 | 0 | 486 |
| Clara post-filter (cook-day · swap · fridge) | 3962 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 392 | 34078 | 0 | 0 | 473 |
| Taste · dish swiper | 392 | 44273 | 0 | 0 | 208 |
| Meal plan · week generation | 392 | 77592 | 0 | 0 | 332 |
| Meal plan · alternatives | 392 | 35968 | 0 | 0 | 145 |
| Meal plan · swap gate (whole library) | 392 | 4515554 | 0 | 0 | 4370 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, taste-dishes, meal-plan, alternatives, swap-gate | 1645 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 727 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate, alternatives | 607 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 538 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, meal-plan, swap-gate, buy-value | 367 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 351 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate, meal-plan, alternatives | 339 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan | 334 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate | 300 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, swap-gate, meal-plan, alternatives, taste-dishes | 284 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, alternatives, swap-gate, buy-value, cookable, meal-plan | 279 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 207 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate, buy-value, cookable | 196 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate, cookable | 159 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 145 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate, cookable | 135 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 133 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate, meal-plan | 132 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate, cookable, buy-value | 126 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 120 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate, cookable | 117 |
| diet:Gluten-free | gluten | Gluten-free granola | taste-dishes, meal-plan, alternatives, swap-gate, cookable | 117 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate, buy-value, cookable, meal-plan | 114 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate, buy-value, cookable, meal-plan | 114 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 112 |
| diet:Gluten-free | gluten | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 106 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 106 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 106 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate, meal-plan | 106 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 99 |
| avoid:Alcohol | wine | Red wine vinegar | swap-gate, cookable, meal-plan, taste-dishes, alternatives | 95 |
| diet:Gluten-free | gluten | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 87 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 87 |
| diet:Mediterranean | butter | Almond butter | cookable, taste-dishes, alternatives, swap-gate | 75 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 67 |
| diet:Pescatarian | beef | meatless beef strips | taste-dishes, alternatives, swap-gate, meal-plan | 66 |
| diet:Vegetarian | beef | meatless beef strips | taste-dishes, alternatives, swap-gate, meal-plan | 60 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan, buy-value | 47 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan, buy-value | 47 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate, meal-plan | 43 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 43 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 43 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate, buy-value | 42 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate | 42 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate, alternatives, buy-value | 38 |
| diet:Dairy-free | butter | Almond butter | cookable, taste-dishes, alternatives, swap-gate | 36 |
| diet:Gluten-free | gluten | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 24 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 24 |
| avoid:Red meat | beef | meatless beef strips | swap-gate, taste-dishes | 13 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 12 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 11 |
| diet:Gluten-free | gluten | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 10 |
| diet:Gluten-free | bread | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 10 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 10 |
| diet:Gluten-free | gluten | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
| diet:Gluten-free | rotini | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
| diet:Mediterranean | butter | unsalted creamy peanut butter | swap-gate | 8 |
| goal:Eat healthier | butter | unsalted creamy peanut butter | swap-gate | 7 |
| diet:High-protein | sugar | sugar-free granola | swap-gate | 6 |
| diet:Dairy-free | butter | unsalted creamy peanut butter | swap-gate | 4 |
| goal:Muscle Gain | sugar | sugar-free granola | swap-gate | 1 |

## Rules that ban no ingredient

These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: Alzheimer's Disease, Aspirin-Exacerbated Respiratory Disease (AERD), Autoimmune Diseases, Cancer – after treatment, Chronic Inflammatory Conditions, Constipation, Eczema, Foggy brain, GERD, Gastritis, Gut Candidiasis, Hair Shedding, IBD – in remission, IBS-C, IBS-D, IBS-M, Leaky Gut Syndrome, Migraine, Overweight, Recovering after illness/surgery, Respiratory Allergies, Rosacea, Seborrheic Dermatitis, Stroke, Lose weight + preserve muscle, Manage a health condition, Navigate my food restrictions, Save time on meal planning.

## Coverage notes (non-pair profiles)

Meal plans that could not fill every core slot from the library: 1.
- everything: 28 rows, core coverage 33%
