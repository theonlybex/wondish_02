# Rule-compliance simulation

Run 2026-10-08T05:38:15.985Z · snapshot 2026-10-07T20:58:25.960Z · 1001s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 3962 — 113 single rules, 3570 rule pairs, 17 real-user combinations, 11 hand-built heavy combinations, 250 random 3–8-rule combinations (seed 20261007), 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 65 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 3962 | 198047 | 0 | 0 | 968 |
| What to buy · By category | 3962 | 556114 | 0 | 0 | 1450 |
| What to buy · By cuisine | 3962 | 331346 | 0 | 0 | 963 |
| Taste · ingredient picker | 3962 | 297921 | 0 | 0 | 486 |
| Clara post-filter (cook-day · swap · fridge) | 3962 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 392 | 34078 | 0 | 0 | 473 |
| Taste · dish swiper | 392 | 43801 | 0 | 0 | 201 |
| Meal plan · week generation | 392 | 77615 | 0 | 0 | 311 |
| Meal plan · alternatives | 392 | 35968 | 0 | 0 | 145 |
| Meal plan · swap gate (whole library) | 392 | 4515554 | 0 | 0 | 4370 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, taste-dishes, meal-plan, alternatives, swap-gate | 1635 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 722 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate, alternatives | 613 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 537 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan, swap-gate | 366 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 350 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, swap-gate, taste-dishes, alternatives | 338 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan | 333 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, swap-gate, taste-dishes | 305 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, swap-gate, taste-dishes, meal-plan, alternatives | 283 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, buy-value, cookable | 278 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 207 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate, buy-value, cookable | 195 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate, cookable | 159 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 145 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate, cookable | 135 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 133 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate, meal-plan | 132 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate, cookable, buy-value | 126 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 120 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate, cookable | 117 |
| diet:Gluten-free | gluten | Gluten-free granola | taste-dishes, meal-plan, alternatives, swap-gate, cookable | 116 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate, buy-value, cookable, meal-plan | 115 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate, buy-value, cookable, meal-plan | 115 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 112 |
| diet:Gluten-free | gluten | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 106 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 106 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 106 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate, meal-plan | 106 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 99 |
| avoid:Alcohol | wine | Red wine vinegar | taste-dishes, swap-gate, cookable, meal-plan, alternatives | 94 |
| diet:Gluten-free | gluten | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 87 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 87 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 75 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 67 |
| diet:Pescatarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 65 |
| diet:Vegetarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 58 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan, buy-value | 46 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan, buy-value | 46 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate, meal-plan | 43 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 43 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 43 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate, buy-value | 42 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate | 42 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate, alternatives, buy-value | 38 |
| diet:Dairy-free | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 34 |
| diet:Gluten-free | gluten | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 24 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 24 |
| avoid:Red meat | beef | meatless beef strips | swap-gate, taste-dishes | 12 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 12 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 11 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 10 |
| diet:Gluten-free | gluten | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
| diet:Gluten-free | rotini | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
| diet:Mediterranean | butter | unsalted creamy peanut butter | swap-gate | 8 |
| diet:Gluten-free | gluten | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 7 |
| diet:Gluten-free | bread | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 7 |
| goal:Eat healthier | butter | unsalted creamy peanut butter | swap-gate | 7 |
| diet:High-protein | sugar | sugar-free granola | swap-gate | 6 |
| diet:Dairy-free | butter | unsalted creamy peanut butter | swap-gate | 4 |
| goal:Muscle Gain | sugar | sugar-free granola | swap-gate | 1 |

## Rules that ban no ingredient

These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: Alzheimer's Disease, Aspirin-Exacerbated Respiratory Disease (AERD), Autoimmune Diseases, Cancer – after treatment, Chronic Inflammatory Conditions, Constipation, Eczema, Foggy brain, GERD, Gastritis, Gut Candidiasis, Hair Shedding, IBD – in remission, IBS-C, IBS-D, IBS-M, Leaky Gut Syndrome, Migraine, Overweight, Recovering after illness/surgery, Respiratory Allergies, Rosacea, Seborrheic Dermatitis, Stroke, Lose weight + preserve muscle, Manage a health condition, Navigate my food restrictions, Save time on meal planning.

## Coverage notes (non-pair profiles)

Meal plans that could not fill every core slot from the library: 1.
- everything: 28 rows, core coverage 33%
