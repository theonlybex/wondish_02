# Rule-compliance simulation

Run 2026-11-28T05:20:45.057Z · snapshot 2026-11-12T19:35:12.195Z · 1130s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 3964 — 113 single rules, 3570 rule pairs, 19 real-user combinations, 11 hand-built heavy combinations, 250 random 3–8-rule combinations (seed 20261007), 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 57 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 3964 | 198149 | 0 | 0 | 787 |
| What to buy · By category | 3964 | 556370 | 0 | 0 | 1455 |
| What to buy · By cuisine | 3964 | 331601 | 0 | 0 | 965 |
| Taste · ingredient picker | 3964 | 298062 | 0 | 0 | 488 |
| Clara post-filter (cook-day · swap · fridge) | 3964 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 394 | 32615 | 0 | 0 | 467 |
| Taste · dish swiper | 394 | 44070 | 0 | 0 | 194 |
| Meal plan · week generation | 394 | 75141 | 0 | 0 | 263 |
| Meal plan · alternatives | 394 | 36167 | 0 | 0 | 124 |
| Meal plan · swap gate (whole library) | 394 | 4689055 | 0 | 0 | 4346 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, meal-plan, alternatives, swap-gate, taste-dishes, cookable | 1670 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 725 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate, alternatives | 608 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, alternatives, swap-gate, meal-plan | 541 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan, buy-value | 366 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 346 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate, alternatives, meal-plan | 337 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan | 333 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, swap-gate, meal-plan, alternatives, taste-dishes | 305 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, swap-gate, taste-dishes | 302 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, buy-value, cookable | 277 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate, buy-value | 196 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 194 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 168 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate | 164 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 154 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate, meal-plan | 138 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate | 136 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate, buy-value, cookable | 124 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate | 118 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 117 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate, meal-plan | 113 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate, meal-plan | 113 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 113 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate, meal-plan | 113 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 106 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 106 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 100 |
| avoid:Alcohol | wine | Red wine vinegar | taste-dishes, swap-gate, alternatives, meal-plan | 96 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, meal-plan, swap-gate | 86 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 76 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 67 |
| diet:Pescatarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 64 |
| diet:Vegetarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 58 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate | 45 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate, buy-value | 44 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | meal-plan, swap-gate | 44 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | meal-plan, swap-gate | 44 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate, meal-plan | 43 |
| diet:Dairy-free | butter | Almond butter | cookable, taste-dishes, alternatives, swap-gate | 38 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate, alternatives, buy-value | 38 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, meal-plan | 36 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, meal-plan | 36 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate, meal-plan | 31 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate, meal-plan | 31 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 24 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 24 |
| avoid:Red meat | beef | meatless beef strips | swap-gate, taste-dishes | 12 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 12 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 11 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 11 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate, meal-plan | 9 |
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
