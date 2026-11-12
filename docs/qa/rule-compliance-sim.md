# Rule-compliance simulation

Run 2026-11-12T20:29:42.959Z · snapshot 2026-11-12T19:35:12.195Z · 549s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 394 — 113 single rules, 0 rule pairs, 19 real-user combinations, 11 hand-built heavy combinations, 250 random 3–8-rule combinations (seed 20261007), 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 57 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 394 | 19649 | 0 | 0 | 151 |
| What to buy · By category | 394 | 52100 | 0 | 0 | 307 |
| What to buy · By cuisine | 394 | 31614 | 0 | 0 | 212 |
| Taste · ingredient picker | 394 | 27482 | 0 | 0 | 93 |
| Clara post-filter (cook-day · swap · fridge) | 394 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 394 | 32615 | 0 | 0 | 467 |
| Taste · dish swiper | 394 | 43988 | 0 | 0 | 176 |
| Meal plan · week generation | 394 | 75793 | 0 | 0 | 275 |
| Meal plan · alternatives | 394 | 36167 | 0 | 0 | 124 |
| Meal plan · swap gate (whole library) | 394 | 4689055 | 0 | 0 | 4346 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, cookable | 1582 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 492 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate, alternatives | 367 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, alternatives, swap-gate, meal-plan | 296 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, taste-dishes, swap-gate, alternatives, meal-plan | 217 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, cookable, buy-value | 195 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 193 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate, buy-value | 193 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate | 164 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 156 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate, meal-plan | 139 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 117 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate, meal-plan | 113 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, buy-value, meal-plan | 112 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, meal-plan, swap-gate, taste-dishes, alternatives | 112 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | alternatives, swap-gate, meal-plan | 110 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | alternatives, swap-gate, meal-plan | 110 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 92 |
| avoid:Alcohol | wine | Red wine vinegar | taste-dishes, swap-gate, alternatives, meal-plan | 90 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 84 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate | 80 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, swap-gate, taste-dishes | 79 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 77 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 67 |
| diet:Pescatarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 64 |
| diet:Vegetarian | beef | meatless beef strips | alternatives, swap-gate, taste-dishes, meal-plan | 57 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate | 53 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate | 45 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate, buy-value | 44 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | meal-plan, swap-gate | 44 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | meal-plan, swap-gate | 44 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate, meal-plan | 43 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate, buy-value, cookable | 41 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate, alternatives, buy-value | 38 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, meal-plan | 38 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, meal-plan | 38 |
| diet:Dairy-free | butter | Almond butter | cookable, alternatives, swap-gate, taste-dishes | 36 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate | 35 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate | 30 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 30 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 26 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 24 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 24 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 23 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 17 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 12 |
| avoid:Red meat | beef | meatless beef strips | swap-gate | 11 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 11 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 11 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 11 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate | 8 |
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
