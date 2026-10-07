# Rule-compliance simulation

Run 2026-10-07T21:28:56.043Z · snapshot 2026-10-07T20:58:25.960Z · 981s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 3388 — 106 single rules, 3003 rule pairs, 17 real-user combinations, 11 hand-built heavy combinations, 250 random 3–8-rule combinations (seed 20261007), 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 65 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 3388 | 169358 | 0 | 0 | 896 |
| What to buy · By category | 3388 | 473348 | 0 | 0 | 1323 |
| What to buy · By cuisine | 3388 | 283100 | 0 | 0 | 879 |
| Taste · ingredient picker | 3388 | 253171 | 0 | 0 | 444 |
| Clara post-filter (cook-day · swap · fridge) | 3388 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 385 | 33517 | 0 | 0 | 438 |
| Taste · dish swiper | 385 | 44376 | 0 | 0 | 196 |
| Meal plan · week generation | 385 | 77405 | 0 | 0 | 298 |
| Meal plan · alternatives | 385 | 36082 | 0 | 0 | 147 |
| Meal plan · swap gate (whole library) | 385 | 4658224 | 0 | 0 | 4667 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, meal-plan, alternatives, swap-gate, taste-dishes, cookable | 1721 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 660 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 618 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, meal-plan, swap-gate, taste-dishes, alternatives | 451 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan, buy-value | 378 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate, alternatives, meal-plan | 309 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan, swap-gate | 305 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 294 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate | 284 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, swap-gate, taste-dishes, meal-plan, alternatives | 283 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 279 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, buy-value, cookable | 204 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate | 180 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate, cookable | 164 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 163 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate | 141 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate | 141 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate | 130 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate | 128 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate | 128 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 125 |
| diet:Gluten-free | gluten | Gluten-free granola | taste-dishes, alternatives, swap-gate, meal-plan, cookable | 114 |
| avoid:Alcohol | wine | Red wine vinegar | taste-dishes, swap-gate, cookable, meal-plan, alternatives, buy-value | 111 |
| diet:Gluten-free | gluten | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 111 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 111 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate | 109 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 105 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 104 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate | 101 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 95 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate | 95 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 90 |
| diet:Gluten-free | gluten | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 81 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 81 |
| diet:Pescatarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 63 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 59 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate, alternatives | 54 |
| diet:Vegetarian | beef | meatless beef strips | taste-dishes, alternatives, swap-gate, meal-plan | 51 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 51 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 44 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 44 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate | 42 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 42 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 42 |
| avoid:Red meat | beef | meatless beef strips | taste-dishes, swap-gate, alternatives | 41 |
| diet:Gluten-free | gluten | Gluten-free chickpeas orzo pasta | meal-plan, swap-gate | 39 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | meal-plan, swap-gate | 39 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | meal-plan, swap-gate | 39 |
| diet:Dairy-free | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 38 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 30 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 30 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate, alternatives | 25 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 14 |
| diet:Gluten-free | gluten | Gluten-free chickpeas rotini pasta | swap-gate, meal-plan | 11 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate, meal-plan | 11 |
| diet:Gluten-free | rotini | Gluten-free chickpeas rotini pasta | swap-gate, meal-plan | 11 |
| goal:Eat healthier | butter | unsalted creamy peanut butter | swap-gate | 11 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 11 |
| diet:High-protein | sugar | sugar-free granola | swap-gate | 10 |
| diet:Dairy-free | butter | unsalted creamy peanut butter | swap-gate, meal-plan | 9 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 9 |
| diet:Gluten-free | gluten | gluten-free multiple whole grain bread mix | alternatives, taste-dishes | 9 |
| diet:Gluten-free | bread | gluten-free multiple whole grain bread mix | alternatives, taste-dishes | 9 |
| diet:Mediterranean | butter | unsalted creamy peanut butter | swap-gate | 5 |
| goal:Muscle Gain | sugar | sugar-free granola | swap-gate | 1 |

## Rules that ban no ingredient

These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: Alzheimer's Disease, Aspirin-Exacerbated Respiratory Disease (AERD), Autoimmune Diseases, Cancer – after treatment, Chronic Inflammatory Conditions, Constipation, Eczema, Foggy brain, GERD, Gastritis, Gut Candidiasis, Hair Shedding, IBD – in remission, IBS-C, IBS-D, IBS-M, Leaky Gut Syndrome, Migraine, Overweight, Recovering after illness/surgery, Respiratory Allergies, Rosacea, Seborrheic Dermatitis, Stroke, Lose weight + preserve muscle, Manage a health condition, Navigate my food restrictions, Save time on meal planning.

## Coverage notes (non-pair profiles)

Meal plans that could not fill every core slot from the library: 1.
- everything: 28 rows, core coverage 33%
