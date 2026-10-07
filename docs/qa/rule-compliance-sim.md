# Rule-compliance simulation

Run 2026-10-07T19:37:43.183Z · snapshot 2026-10-07T19:05:40.659Z · 115s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 134 — 105 single rules, 0 rule pairs, 17 real-user combinations, 11 hand-built heavy combinations, 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 64 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 134 | 6662 | 0 | 0 | 26 |
| What to buy · By category | 134 | 19081 | 0 | 0 | 44 |
| What to buy · By cuisine | 134 | 11345 | 0 | 0 | 33 |
| Taste · ingredient picker | 134 | 10208 | 0 | 0 | 10 |
| Clara post-filter (cook-day · swap · fridge) | 134 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 134 | 11036 | 0 | 0 | 75 |
| Taste · dish swiper | 134 | 17774 | 0 | 0 | 33 |
| Meal plan · week generation | 134 | 26247 | 0 | 0 | 53 |
| Meal plan · alternatives | 134 | 13814 | 0 | 0 | 25 |
| Meal plan · swap gate (whole library) | 134 | 2137234 | 0 | 0 | 618 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 71 |
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 61 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate | 56 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate | 52 |
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, taste-dishes, alternatives, swap-gate, meal-plan | 47 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, taste-dishes, swap-gate, alternatives | 44 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 36 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, alternatives, swap-gate, cookable, meal-plan | 31 |
| diet:Gluten-free | gluten | Gluten-free granola | taste-dishes, meal-plan, alternatives, swap-gate | 30 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate, cookable | 30 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 28 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate | 25 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, alternatives, swap-gate | 24 |
| avoid:Alcohol | wine | Red wine vinegar | taste-dishes, swap-gate, cookable, meal-plan, alternatives | 22 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, meal-plan, swap-gate | 22 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate | 21 |
| diet:Pescatarian | beef | meatless beef strips | alternatives, swap-gate, meal-plan | 19 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate | 18 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate | 18 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, meal-plan | 16 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan | 15 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate | 14 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, swap-gate, taste-dishes | 11 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate | 10 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 9 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 9 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 8 |
| diet:Gluten-free | gluten | Gluten-free chickpeas orzo pasta | swap-gate | 8 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate | 8 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate | 8 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 8 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate | 7 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate | 7 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate | 7 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 7 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 7 |
| diet:Gluten-free | gluten | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 6 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 6 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate | 6 |
| diet:Vegetarian | beef | meatless beef strips | alternatives, swap-gate | 6 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 6 |
| avoid:Red meat | beef | meatless beef strips | swap-gate | 5 |
| diet:Dairy-free | butter | Almond butter | cookable, taste-dishes, alternatives, swap-gate | 5 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate | 5 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 5 |
| goal:Eat healthier | butter | unsalted creamy peanut butter | swap-gate | 5 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate | 4 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 4 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 4 |
| diet:Gluten-free | gluten | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 4 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 4 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate | 4 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 4 |
| diet:Gluten-free | gluten | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 3 |
| diet:Gluten-free | bread | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 3 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 3 |
| diet:Gluten-free | gluten | Gluten-free chickpeas rotini pasta | swap-gate | 2 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate | 2 |
| diet:Gluten-free | rotini | Gluten-free chickpeas rotini pasta | swap-gate | 2 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 1 |
| diet:Dairy-free | butter | unsalted creamy peanut butter | swap-gate | 1 |
| diet:High-protein | sugar | sugar-free granola | swap-gate | 1 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 1 |
| diet:Mediterranean | butter | unsalted creamy peanut butter | swap-gate | 1 |

## Rules that ban no ingredient

These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: Alzheimer's Disease, Aspirin-Exacerbated Respiratory Disease (AERD), Autoimmune Diseases, Cancer – after treatment, Cancer – during treatment, Chronic Diarrhea, Chronic Inflammatory Conditions, Constipation, Eczema, Foggy brain, GERD, Gastritis, Gut Candidiasis, Hair Shedding, IBD – active, IBD – in remission, IBS-C, IBS-D, IBS-M, Leaky Gut Syndrome, Migraine, Overweight, Recovering after illness/surgery, Respiratory Allergies, Rosacea, Seborrheic Dermatitis, Stroke, Lose weight + preserve muscle, Manage a health condition, Navigate my food restrictions, Save time on meal planning.

## Coverage notes (non-pair profiles)

Meal plans that could not fill every core slot from the library: 1.
- everything: 28 rows, core coverage 33%
